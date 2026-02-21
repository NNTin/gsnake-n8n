---
implementation_status: not_started
tool_type: "n8n-workflow (Execute Workflow Trigger)"
tool_location: "tools/n8n-flows/ralph-loop.json + tools/scripts/ralph-bridge.js"
workflow_id: "ralph-loop"
last_updated: "2026-02-21"
dependencies:
  - "workflows/infra/n8n-sync.md"
  - "workflows/n8n-workflow/notify.md"
  - "workflows/n8n-workflow/ralph-loop-auth.md"
tags: ["ralph", "ai-agent", "claude", "codex", "loop", "prd", "autonomous"]
---

# Ralph Loop

Autonomous AI coding agent loop driven by n8n. n8n orchestrates the iteration cycle
(reset → check PRD → run AI agent → callback → repeat) while a host-side HTTP bridge
service spawns `claude`/`codex` CLIs that cannot run inside the n8n container.

This workflow is internal — it is never triggered by an external webhook directly.
All traffic enters through the `ralph-loop-auth` gateway workflow (see
`workflows/n8n-workflow/ralph-loop-auth.md`).

## Objective

- **What**: An n8n workflow that iteratively calls an AI agent (claude/codex) to
  implement user stories from `scripts/ralph/prd.json`, looping until all stories pass or
  max iterations is reached.
- **Why**: Moving the loop controller to n8n gives visibility into iteration state,
  Discord notifications, and integration with the existing CI orchestration layer.
- **When**: Triggered via Execute Workflow by the `ralph-loop-auth` gateway. Only one
  iteration runs at a time; concurrent starts are rejected.

---

## Prerequisites

**Environment Variables (bridge service):**
```bash
RALPH_BRIDGE_PORT=8765                                        # Port the bridge listens on
RALPH_REPO_PATH=/home/nntin/git/gSnake                       # Absolute path to gSnake repo root
RALPH_N8N_PATH=/home/nntin/git/gSnake/gsnake-n8n             # Absolute path to gsnake-n8n submodule
RALPH_CLAUDE_MD=scripts/ralph/CLAUDE.md                      # Relative to RALPH_REPO_PATH
RALPH_PRD_JSON=scripts/ralph/prd.json                        # Relative to RALPH_REPO_PATH
RALPH_ARCHIVE_DIR=scripts/ralph/archive                      # Relative to RALPH_REPO_PATH
RALPH_STATE_FILE=tools/scripts/ralph-bridge.state.json       # Relative to RALPH_N8N_PATH
RALPH_ITERATION_TIMEOUT=18000                                 # Seconds per iteration (5 hours)
RALPH_WEBHOOK_TOKEN=<same-value-as-n8n-RALPH_WEBHOOK_TOKEN>  # Bearer token for n8n callbacks
```

> **Note:** `ralph-bridge.state.json` is runtime state and must not be git-tracked.
> It is listed in `gsnake-n8n/.gitignore`. Path: `$RALPH_N8N_PATH/tools/scripts/ralph-bridge.state.json`.

> **Note:** `RALPH_ITERATION_TIMEOUT` is in **seconds** (matching the POSIX `timeout`
> command). The bridge implementation must multiply by 1000 when passing to `setTimeout`.

**Host prerequisites:**
- `node` ≥ 18 available on the host
- `claude` CLI installed and authenticated on the host
- `codex` CLI installed and authenticated on the host (optional)
- Port `8765` open/reachable from the n8n container on the host's Docker bridge IP

**n8n docker-compose change (one-time setup):**

Add to the `n8n` service in
`~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/docker-compose.yml`:
```yaml
extra_hosts:
  - "host-gateway:host-gateway"
```
Then apply: `docker compose down && docker compose up -d`

**n8n Variables (one-time setup in n8n UI → Settings → Variables):**

| Variable | Purpose |
|----------|---------|
| `RALPH_WEBHOOK_TOKEN` | Shared bearer token — must match bridge `RALPH_WEBHOOK_TOKEN` env var |

**n8n workflow dependencies:**
- `ralph-loop-auth` workflow must be imported and active (see `ralph-loop-auth.md`)
- `notify` workflow must be imported and active (see `notify.md`)

---

## Implementation Details

**Tool Type**: n8n internal workflow (Execute Workflow Trigger — not a public webhook)

**Locations**:
- Bridge: `tools/scripts/ralph-bridge.js`
- Bridge OpenAPI spec: `tools/scripts/ralph-bridge.openapi.yaml`
- systemd unit: `tools/scripts/ralph-bridge.service`
- n8n workflow: `tools/n8n-flows/ralph-loop.json`

**Key Technologies**: Node.js stdlib only (no npm deps), n8n Execute Workflow Trigger,
HTTP Request nodes, Execute Workflow node (calls `notify`)

---

## Usage

### Start the bridge service

```bash
# One-time: install as systemd service
sudo cp $RALPH_N8N_PATH/tools/scripts/ralph-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ralph-bridge.service

# Or run manually (development)
node $RALPH_N8N_PATH/tools/scripts/ralph-bridge.js
```

### Start a ralph loop

All requests go through the `ralph-loop-auth` gateway:

```bash
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <RALPH_WEBHOOK_TOKEN>' \
  -d '{
    "action": "start",
    "tool": "claude",
    "maxIterations": 20
  }'
```

**Parameters (in request body):**
- `action`: `"start"` — initiates a new campaign (resets iteration counter, then runs)
- `tool`: `"claude"` | `"codex"` — which CLI to invoke
- `maxIterations`: integer (default 10) — hard cap on iterations for this campaign

**What it does (step-by-step):**
1. Auth gateway validates bearer token; forwards to ralph-loop via Execute Workflow
2. ralph-loop receives payload, reads `action: "start"`
3. Calls bridge `GET /status` — if `running: true`, sends "already running" info notification and stops
4. Calls bridge `GET /prd.json` — if all `passes: true`, sends "nothing to do" notification and stops
5. Calls bridge `POST /reset` — resets iteration counter to 0 for the new campaign
6. Calls bridge `POST /run-ralph` with `{tool, maxIterations, callbackUrl}`
7. Bridge checks state: if `iteration >= maxIterations`, returns `{status: "max_iterations_reached"}`
8. Bridge spawns the AI agent CLI asynchronously, returns `{status: "started", jobId}`
9. n8n sends "Ralph started" info notification; execution ends — loop is now "in flight"
10. When CLI exits, bridge POSTs to `callbackUrl` (auth gateway URL) with `{action: "done", ...}`
11. Auth gateway validates token; forwards to ralph-loop via Execute Workflow
12. ralph-loop reads `action: "done"`, repeats from step 3 (skipping the reset)

### Check loop status

```bash
curl http://localhost:8765/status
```

```json
{
  "running": true,
  "jobId": "uuid-here",
  "iteration": 3,
  "maxIterations": 20,
  "startedAt": "2026-02-20T10:00:00.000Z",
  "tool": "claude",
  "callbackUrl": "https://n8n.labs.lair.nntin.xyz/webhook/ralph"
}
```

### Abort a running iteration

```bash
curl -X POST http://localhost:8765/abort
# Expected: { "status": "aborting", "jobId": "uuid-here" }
# Bridge sends callback with { success: false, aborted: true } after process exits
```

---

## Technical Specifications

### Bridge HTTP API

Full spec: `tools/scripts/ralph-bridge.openapi.yaml`

#### `GET /status`

Returns current bridge state including `callbackUrl` (persisted for crash recovery).

#### `GET /prd.json`

Returns parsed `scripts/ralph/prd.json`.

#### `POST /run-ralph`

Starts one iteration asynchronously.

**Request body:**
```json
{
  "tool": "claude",
  "callbackUrl": "https://n8n.labs.lair.nntin.xyz/webhook/ralph",
  "maxIterations": 20
}
```

**Responses:**
```json
{ "status": "started", "jobId": "uuid" }
{ "status": "already_running", "jobId": "uuid" }
{ "status": "max_iterations_reached", "iteration": 20, "maxIterations": 20 }
```

Bridge behavior on start:
- Updates `state.maxIterations` from request body
- Increments `state.iteration`, sets `state.running = true`, persists `callbackUrl` to state
- Reads prompt from `$RALPH_REPO_PATH/$RALPH_CLAUDE_MD`
- Spawns CLI (see Tool Invocation below)
- Streams stdout+stderr to archive log at `$RALPH_ARCHIVE_DIR/iteration_N_YYYYMMDD_HHMMSS.log`
- On exit: sets `state.running = false`, saves state, POSTs callback

#### `POST /reset`

Resets `iteration` to 0 and clears all job metadata. Returns `409` if currently running
(call `POST /abort` first). n8n calls this at the start of every new campaign.

**Response:**
```json
{ "status": "reset" }
```

#### `POST /abort`

Sends SIGTERM (then SIGKILL after 5 s) to the in-flight CLI process. Bridge POSTs
callback with `{success: false, aborted: true}` once the process exits. Idempotent
when nothing is running (`{status: "idle"}`).

**Response (while running):**
```json
{ "status": "aborting", "jobId": "uuid" }
```

### Bridge Tool Invocation

```bash
# claude
claude --dangerously-skip-permissions --no-session-persistence --print "$PROMPT_CONTENT" </dev/null

# codex
codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT_CONTENT" </dev/null
```

Bridge reads `$RALPH_REPO_PATH/$RALPH_CLAUDE_MD` into a variable at iteration start and passes it
as a CLI argument. Prompt file changes take effect on the next iteration.

### Bridge State File (`state.json`)

Persisted to `$RALPH_STATE_FILE` on every state transition. Survives bridge restarts.

```json
{
  "running": false,
  "jobId": null,
  "iteration": 0,
  "maxIterations": 10,
  "startedAt": null,
  "tool": null,
  "callbackUrl": null
}
```

> **`callbackUrl` must be persisted.** If the bridge crashes mid-iteration and restarts,
> it must detect the orphaned process (via stored PID — see Edge Case 2) and POST the
> callback to the stored `callbackUrl` with `{success: false}`.

### Callback Payload (bridge → n8n auth gateway)

Bridge POSTs to `callbackUrl` with `Authorization: Bearer <RALPH_WEBHOOK_TOKEN>`:

```json
{
  "action": "done",
  "jobId": "uuid",
  "iteration": 3,
  "tool": "claude",
  "success": true,
  "exitCode": 0,
  "timedOut": false,
  "aborted": false,
  "logFile": "scripts/ralph/archive/iteration_3_20260221_100000.log"
}
```

On timeout:
```json
{
  "action": "done",
  "jobId": "uuid",
  "iteration": 3,
  "tool": "claude",
  "success": false,
  "timedOut": true,
  "aborted": false,
  "exitCode": 124
}
```

On abort (`POST /abort`):
```json
{
  "action": "done",
  "jobId": "uuid",
  "iteration": 3,
  "tool": "claude",
  "success": false,
  "timedOut": false,
  "aborted": true,
  "exitCode": null
}
```

### n8n Workflow Structure

**Workflow ID**: `ralph-loop`

**Entry point**: Execute Workflow Trigger (not a webhook — triggered by `ralph-loop-auth`)

**Nodes:**

1. **Execute Workflow Trigger** (`n8n-nodes-base.executeWorkflowTrigger`)
   - Receives payload forwarded by `ralph-loop-auth`
   - Input: original request body (`{action, tool, maxIterations, ...}`)

2. **Switch: action** (`n8n-nodes-base.switch`)
   - Route on `$json.action`
   - Cases: `"start"` | `"done"` | default → error handler

3. **HTTP: GET /status** (`n8n-nodes-base.httpRequest`)
   - URL: `http://host-gateway:8765/status`
   - Used on both `"start"` and `"done"` paths
   - On error: continue (bridge may be restarting — route to error notification)

4. **If: already running** (`n8n-nodes-base.if`)
   - Condition: `$json.running === true`
   - True → **Execute Workflow: notify** (`info`, "Ralph already running") → stop
   - False → continue

5. **HTTP: GET /prd.json** (`n8n-nodes-base.httpRequest`)
   - URL: `http://host-gateway:8765/prd.json`

6. **Code: check remaining stories** (`n8n-nodes-base.code`)
   - Parses `userStories`, counts `passes === false`
   - Returns `{remaining: N, nextStory: {id, title}}`

7. **If: all done** (`n8n-nodes-base.if`)
   - Condition: `$json.remaining === 0`
   - True → **Execute Workflow: notify** (`success`, "nothing to do" or "all complete") → stop
   - False → continue

8. **HTTP: POST /reset** (`n8n-nodes-base.httpRequest`) ← **start path only**
   - URL: `http://host-gateway:8765/reset`
   - Method: POST
   - Only on the `"start"` action path (not called on `"done"` path)
   - Resets iteration counter to 0 for the new campaign
   - On error: route to error notification

9. **HTTP: POST /run-ralph** (`n8n-nodes-base.httpRequest`)
   - URL: `http://host-gateway:8765/run-ralph`
   - Body: `{ tool, maxIterations, callbackUrl: "https://n8n.labs.lair.nntin.xyz/webhook/ralph" }`
   - `tool` and `maxIterations` are threaded across hops (see State Threading below)

10. **Switch: run-ralph status** (`n8n-nodes-base.switch`) ← replaces the old If node
    - Route on `$json.status`
    - `"started"` → **Execute Workflow: notify** (`info`, "Ralph started · N remaining") → WAIT
    - `"max_iterations_reached"` → **Execute Workflow: notify** (`warning`, "Max iterations reached") → stop
    - `"already_running"` → **Execute Workflow: notify** (`info`, "Ralph already running") → stop
    - default → **Execute Workflow: notify** (`error`, "Ralph error") → stop

11. **Execute Workflow: notify** (`n8n-nodes-base.executeWorkflow`)
    - Workflow: `notify`
    - `waitForWorkflow: false` (fire-and-forget — notification failure must not block the loop)
    - Payload shape: `{ title, body, level, source: "ralph", context: {...} }`
    - One Execute Workflow node per terminal event:

    | Event | level | title example |
    |-------|-------|---------------|
    | already running (status check) | `info` | "Ralph already running" |
    | nothing to do (PRD check) | `success` | "Nothing to do" |
    | started | `info` | "Ralph started — N stories remaining" |
    | iteration done | `info` | "Iteration N done — M remaining" |
    | all complete | `success` | "All stories complete!" |
    | max iterations reached | `warning` | "Max iterations (N) reached" |
    | already_running (bridge guard) | `info` | "Ralph already running" |
    | iteration failed | `error` | "Iteration N failed (exitCode=X)" |
    | aborted | `warning` | "Iteration N aborted" |
    | bridge/network error | `error` | "Ralph error" |

**Node connections:**
```
Execute Workflow Trigger → Switch(action)

  "start" → GET /status → If(running?)
               running=true  → Notify(already-running, info) → stop
               running=false → GET /prd.json → Code(remaining) → If(allDone?)
                                 allDone  → Notify(nothing-to-do, success) → stop
                                 notDone  → POST /reset → POST /run-ralph → Switch(status)
                                              "started"              → Notify(started, info) → WAIT
                                              "max_iterations_reached" → Notify(max-hit, warning) → stop
                                              "already_running"      → Notify(busy, info) → stop
                                              default                → Notify(error, error) → stop

  "done"  → If(success?)
               failed → Notify(iteration-failed, error) → stop  [exitCode/timedOut/aborted]
               success → GET /prd.json → Code(remaining) → If(allDone?)
                           allDone  → Notify(all-complete, success) → stop
                           notDone  → POST /run-ralph → Switch(status)
                                        "started"              → Notify(iteration-done, info) → WAIT
                                        "max_iterations_reached" → Notify(max-hit, warning) → stop
                                        "already_running"      → Notify(busy, info) → stop
                                        default                → Notify(error, error) → stop

  default → Notify(error, error) → stop
```

> **WAIT** — n8n execution ends. Bridge holds state. Bridge POSTs `{action:"done"}` callback
> to the auth gateway when the CLI exits.

**State threading**: `tool` and `maxIterations` must travel across the async gap. Bridge
echoes them back in the callback payload; n8n extracts them from `$json` on each `"done"`
call to pass to the next `/run-ralph` POST. The `"start"` path reads them from `$json`
(original human input).

---

## Security Considerations

See `workflows/n8n-workflow/ralph-loop-auth.md` for the authentication model.

**Data Handling:**
- The CLAUDE.md prompt may contain repo-specific paths and instructions — not sensitive
- Archive logs written to `scripts/ralph/archive/` — do not contain secrets
- The `claude`/`codex` process runs with `--dangerously-skip-permissions` — ensure the
  host user account has appropriate filesystem boundaries

**Rate limiting:**
- The bridge's `already_running` guard prevents concurrent iterations
- `maxIterations` provides a hard cap to prevent runaway loops
- `RALPH_ITERATION_TIMEOUT` limits each iteration's wall-clock time

---

## Testing

### Test Case 1: Bridge startup and status
```bash
node $RALPH_N8N_PATH/tools/scripts/ralph-bridge.js &
curl http://localhost:8765/status
# Expected: { running: false, iteration: 0, callbackUrl: null, ... }

curl http://localhost:8765/prd.json | jq '.userStories | length'
# Expected: 14 (or current count)
```

### Test Case 2: Reset clears iteration counter
```bash
# Manually set state to simulate post-campaign state
echo '{"running":false,"jobId":null,"iteration":20,"maxIterations":20}' \
  > $RALPH_N8N_PATH/tools/scripts/ralph-bridge.state.json

curl -X POST http://localhost:8765/reset
# Expected: { "status": "reset" }

curl http://localhost:8765/status
# Expected: { "running": false, "iteration": 0, ... }
```

### Test Case 3: Reset rejected when running
```bash
# Start an iteration first (see test case for /run-ralph)
curl -X POST http://localhost:8765/reset
# Expected: 409 { "error": "conflict", "message": "Cannot reset while running..." }
```

### Test Case 4: Abort in-flight iteration
```bash
curl -X POST http://localhost:8765/run-ralph -H 'Content-Type: application/json' \
  -d '{"tool":"claude","callbackUrl":"http://localhost:9000/done","maxIterations":1}'
# Expected: { "status": "started", "jobId": "..." }

curl -X POST http://localhost:8765/abort
# Expected: { "status": "aborting", "jobId": "..." }
# Then: callback arrives at localhost:9000/done with { success: false, aborted: true }
```

### Test Case 5: Start rejection when running
```bash
curl -X POST http://localhost:8765/run-ralph -H 'Content-Type: application/json' \
  -d '{"tool":"claude","callbackUrl":"http://localhost:9000/done","maxIterations":1}' &
curl -X POST http://localhost:8765/run-ralph -H 'Content-Type: application/json' \
  -d '{"tool":"claude","callbackUrl":"http://localhost:9000/done","maxIterations":1}'
# Second call expected: { status: "already_running", jobId: "..." }
```

### Test Case 6: Max iterations guard
```bash
# After 20 iterations (or manually set in state):
curl http://localhost:8765/status  # confirm iteration == maxIterations
curl -X POST http://localhost:8765/run-ralph -H 'Content-Type: application/json' \
  -d '{"tool":"claude","callbackUrl":"http://localhost:9000/done","maxIterations":20}'
# Expected: { status: "max_iterations_reached", iteration: 20, maxIterations: 20 }
```

### Test Case 7: Full n8n end-to-end (start → done loop)
```bash
# 1. Import and activate workflows
$RALPH_N8N_PATH/tools/scripts/sync-workflows.sh import
# Activate ralph-loop-auth and ralph-loop in n8n UI

# 2. Start a loop (via auth gateway)
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <RALPH_WEBHOOK_TOKEN>" \
  -d '{"action":"start","tool":"claude","maxIterations":1}'
# Expected: HTTP 202

# 3. Monitor bridge logs and n8n execution history

# 4. After iteration completes:
curl http://localhost:8765/status
# Expected: { running: false, iteration: 1 }

ls scripts/ralph/archive/
# Expected: new iteration_1_*.log file

# 5. Verify Discord notification received
```

---

## Error Handling

### Error: Bridge not reachable from n8n container

**Symptom:** HTTP Request node to `http://host-gateway:8765/status` fails with connection refused

**Resolution:**
```bash
# 1. Verify docker-compose has extra_hosts
grep -A2 extra_hosts ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/docker-compose.yml

# 2. Verify bridge is running and binding to 0.0.0.0
ss -tlnp | grep 8765

# 3. From inside n8n container, test reachability
docker exec n8n curl -s http://host-gateway:8765/status
```

### Error: claude/codex not found when bridge spawns

**Symptom:** Archive log shows `command not found`; callback received with `exitCode: 127`

**Resolution:** In `ralph-bridge.js`, inherit the full user PATH:
```js
const proc = spawn(tool, [...args], {
  env: { ...process.env },  // inherit full env including PATH
  stdio: ['pipe', outputStream, outputStream]
});
```

### Error: Callback rejected with 401

**Symptom:** Bridge log shows `401` on callback POST; n8n loop stalls

**Resolution:** See `ralph-loop-auth.md` error handling section.

### Error: State file corruption after crash

**Symptom:** Bridge starts with `running: true` and non-null `jobId` but no process active

**Resolution:** On startup, bridge checks if the stored PID is still alive (`kill -0 <pid>`).
If not, it resets `running: false` and POSTs callback with `{success: false}` to `callbackUrl`.
For manual recovery:
```bash
curl -X POST http://localhost:8765/reset  # if not running
# or manually edit:
echo '{"running":false,"jobId":null,"iteration":0,"maxIterations":10,"startedAt":null,"tool":null,"callbackUrl":null}' \
  > $RALPH_N8N_PATH/tools/scripts/ralph-bridge.state.json
```

---

## Edge Cases

**Edge Case 1: n8n restarts while iteration is in flight**
- Bridge completes, POSTs callback to auth gateway; a fresh n8n execution picks up
  at the `"done"` branch normally. n8n webhooks are persistent (not tied to a specific
  execution), so the callback always lands correctly.

**Edge Case 2: Bridge restarts while iteration is in flight**
- State file persists `running: true`, `callbackUrl`, and `childPid`.
- On startup, bridge runs `kill -0 <childPid>` to check liveness.
  - If process is dead: reset `running: false`, POST callback to `callbackUrl` with
    `{success: false, exitCode: null}` (bridge cannot determine actual exit code).
  - If process is alive: re-attach output streaming and resume monitoring.
- **Implementation requirement**: `childPid` must be persisted in `state.json`.

**Edge Case 3: All stories pass when loop is started**
- n8n reads PRD after status check, finds 0 remaining, sends "nothing to do"
  notification and stops. No iteration is started; `POST /reset` is not called.

**Edge Case 4: `max_iterations_reached` on start path**
- n8n's Switch(status) node routes to "warning" notification, not "error".
  Operator should call `POST /reset` and restart with a higher `maxIterations`.

**Edge Case 5: Abort during n8n execution gap**
- Operator calls `POST /abort` while the CLI is running. Bridge sends SIGTERM,
  then POSTs callback with `{success: false, aborted: true}`. n8n's "done" path
  routes `success: false` to the "iteration failed / aborted" notification and stops.

---

## Integration Points

**Upstream:**
- `ralph-loop-auth` workflow (via Execute Workflow) — all external traffic

**Downstream:**
- Bridge reads `scripts/ralph/CLAUDE.md` as the AI prompt (`$RALPH_CLAUDE_MD`)
- Bridge writes iteration logs to `scripts/ralph/archive/`
- AI agent commits to the gSnake repo (pushing story completions via git)
- `notify` workflow called on each terminal event

---

## Rollback Procedure

```bash
# 1. Abort any in-flight iteration
curl -X POST http://localhost:8765/abort

# 2. Stop the bridge
sudo systemctl stop ralph-bridge.service

# 3. Deactivate n8n workflows
# In n8n UI: ralph-loop-auth → toggle inactive; ralph-loop → toggle inactive

# 4. Reset state for next use
curl -X POST http://localhost:8765/reset
# or manually:
echo '{"running":false,"jobId":null,"iteration":0,"maxIterations":10,"startedAt":null,"tool":null,"callbackUrl":null}' \
  > $RALPH_N8N_PATH/tools/scripts/ralph-bridge.state.json
```

---

## Related Documentation

- **Auth gateway**: `workflows/n8n-workflow/ralph-loop-auth.md`
- **Notification workflow**: `workflows/n8n-workflow/notify.md`
- **Bridge OpenAPI spec**: `tools/scripts/ralph-bridge.openapi.yaml`
- **Agent prompt**: `scripts/ralph/CLAUDE.md`
- **PRD format**: `scripts/ralph/prd.json`
- **Architecture diagrams**: `gsnake-specs/ralph-loop/architecture.md`

---

## Changelog

**2026-02-21**: Major revision — auth delegated to ralph-loop-auth gateway; entry point
changed to Execute Workflow Trigger; added /reset and /abort bridge endpoints; callbackUrl
persisted to state.json; node 9 changed to Switch for proper status routing; "already
running" changed from no-op to info notification; amp support removed (claude + codex only);
added RALPH_N8N_PATH env var for submodule path; RALPH_ITERATION_TIMEOUT unit contract documented.

**2026-02-20**: Initial SOP created

---

## Implementation Checklist

- [ ] Create `tools/scripts/ralph-bridge.openapi.yaml` (OpenAPI 3.0 spec — see file)
- [ ] Create `tools/scripts/ralph-bridge.js` (Node.js ESM, stdlib only)
  - [ ] GET /status, GET /prd.json, POST /run-ralph
  - [ ] POST /reset (iteration counter reset)
  - [ ] POST /abort (SIGTERM → SIGKILL, async callback)
  - [ ] Persist `callbackUrl` and `childPid` in state.json
  - [ ] On startup: PID liveness check + orphan recovery callback
  - [ ] Callback POSTs include `Authorization: Bearer $RALPH_WEBHOOK_TOKEN` header
  - [ ] RALPH_ITERATION_TIMEOUT in seconds × 1000 for Node.js setTimeout
  - [ ] claude uses `$RALPH_CLAUDE_MD` via `--print`; codex uses `$RALPH_CLAUDE_MD` via exec argument
- [ ] Create `tools/scripts/ralph-bridge.service` (systemd unit with EnvironmentFile)
- [ ] Add `tools/scripts/ralph-bridge.state.json` to `gsnake-n8n/.gitignore`
- [ ] Create `tools/n8n-flows/ralph-loop.json` (Execute Workflow Trigger entry)
- [ ] Add `extra_hosts: - "host-gateway:host-gateway"` to n8n docker-compose
- [ ] Deploy docker-compose change: `docker compose down && docker compose up -d`
- [ ] Complete `ralph-loop-auth` implementation checklist first
- [ ] Start bridge and verify `GET /status` responds
- [ ] Import workflows: `./tools/scripts/sync-workflows.sh import`
- [ ] Activate `ralph-loop` in n8n UI
- [ ] Test Cases 1–7 from Testing section pass
- [ ] Update `CLAUDE.md` SOP mapping table
- [ ] Set `implementation_status: implemented` in this file's frontmatter
