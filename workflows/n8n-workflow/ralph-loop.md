---
implementation_status: not_started
tool_type: "n8n-webhook + shell-script"
tool_location: "tools/n8n-flows/ralph-loop.json + tools/scripts/ralph-bridge.js"
workflow_id: "ralph-loop"
last_updated: "2026-02-20"
dependencies:
  - "workflows/infra/n8n-sync.md"
  - "workflows/n8n-workflow/notify.md"
tags: ["ralph", "ai-agent", "claude", "codex", "loop", "prd", "autonomous"]
---

# Ralph Loop

Replicate `scripts/ralph/ralph.sh` as an n8n-orchestrated workflow. n8n drives the
iteration loop (check PRD → run AI agent → callback → repeat) while a host-side HTTP
bridge service spawns `claude`/`codex` CLIs that cannot run inside the n8n container.

## Objective

- **What**: An n8n workflow that iteratively calls an AI agent (claude/codex) to implement
  user stories from `scripts/ralph/prd.json`, looping until all stories pass or max
  iterations is reached.
- **Why**: Moving the loop controller to n8n gives visibility into iteration state,
  Discord notifications, and integration with the existing CI orchestration layer.
- **When**: Triggered manually (or via webhook) whenever a new PRD is ready and autonomous
  implementation should begin. Only one iteration runs at a time; concurrent starts are
  rejected.

---

## Prerequisites

**Environment Variables (bridge service):**
```bash
RALPH_BRIDGE_PORT=8765                                       # Port the bridge listens on
RALPH_REPO_PATH=/home/nntin/git/gSnake                      # Absolute path to gSnake repo
RALPH_CLAUDE_MD=scripts/ralph/CLAUDE.md                     # Relative to RALPH_REPO_PATH
RALPH_PRD_JSON=scripts/ralph/prd.json                       # Relative to RALPH_REPO_PATH
RALPH_ARCHIVE_DIR=scripts/ralph/archive                     # Relative to RALPH_REPO_PATH
RALPH_STATE_FILE=gsnake-n8n/tools/scripts/ralph-bridge.state.json  # Relative to RALPH_REPO_PATH
RALPH_ITERATION_TIMEOUT=18000                                # Seconds per iteration (5h)
```

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

This makes `host-gateway` resolve to the host machine's IP from inside the container.

**n8n workflow dependencies:**
- `notify` workflow must be imported and active (see `workflows/n8n-workflow/notify.md`)

---

## Implementation Details

**Tool Type**: n8n webhook workflow + host-side Node.js bridge service

**Locations**:
- Bridge: `tools/scripts/ralph-bridge.js`
- Bridge OpenAPI spec: `tools/scripts/ralph-bridge.openapi.yaml`
- systemd unit: `tools/scripts/ralph-bridge.service`
- n8n workflow: `tools/n8n-flows/ralph-loop.json`

**Key Technologies**: Node.js stdlib only (no npm deps), n8n webhook trigger, HTTP Request
nodes, Execute Workflow node (calls `notify`)

---

## Usage

### Start the bridge service

```bash
# One-time: install as systemd service
sudo cp gsnake-n8n/tools/scripts/ralph-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ralph-bridge.service

# Or run manually (development)
node gsnake-n8n/tools/scripts/ralph-bridge.js
```

### Start a ralph loop

```bash
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph-loop \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "start",
    "tool": "claude",
    "maxIterations": 20
  }'
```

**Parameters (in webhook body):**
- `action`: `"start"` — initiates the loop (if already running, n8n no-ops)
- `tool`: `"claude"` | `"codex"` | `"amp"` — which CLI to invoke
- `maxIterations`: integer (default 10) — hard limit on iterations

**When to use:**
- After creating or updating a `prd.json` with new stories to implement
- After a previous loop completed or stalled and you want to re-run

**What it does (step-by-step):**
1. n8n receives webhook, reads `action: "start"`
2. n8n calls bridge `GET /status` — if `running: true`, responds and stops (no-op)
3. n8n calls bridge `GET /prd.json` — if all `passes: true`, notifies notification service "nothing to do" and stops
4. n8n calls bridge `POST /run-ralph` with `{tool, maxIterations, callbackUrl}`
5. Bridge checks state: if `iteration >= maxIterations`, returns `{status: "max_iterations_reached"}`
6. Bridge spawns the AI agent CLI asynchronously, returns `{status: "started", jobId}`
7. n8n responds 200, execution ends — loop is now "in flight"
8. When CLI exits, bridge POSTs to `callbackUrl` (`/webhook/ralph-loop`) with `{action: "done", ...}`
9. n8n receives the callback, repeats from step 2

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
  "tool": "claude"
}
```

---

## Technical Specifications

### Bridge HTTP API

Full spec: `tools/scripts/ralph-bridge.openapi.yaml`

#### `POST /run-ralph`

Starts one ralph iteration asynchronously.

**Request body:**
```json
{
  "tool": "claude",
  "callbackUrl": "https://n8n.labs.lair.nntin.xyz/webhook/ralph-loop",
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
- Sets `state.running = true`, increments `state.iteration`, saves state to disk
- Reads prompt from `$RALPH_REPO_PATH/$RALPH_CLAUDE_MD`
- Spawns CLI (see Tool Invocation below)
- Streams stdout+stderr to archive log at `$RALPH_ARCHIVE_DIR/iteration_N_YYYYMMDD_HHMMSS.log`
- On exit: sets `state.running = false`, saves state, POSTs callback

#### `GET /prd.json`

Returns the parsed PRD file.

**Response:** Raw JSON of `scripts/ralph/prd.json`

#### `GET /status`

Returns current loop state.

**Response:**
```json
{
  "running": false,
  "jobId": null,
  "iteration": 5,
  "maxIterations": 20,
  "startedAt": null,
  "tool": "claude"
}
```

### Bridge Tool Invocation

Mirrors `ralph.sh` exactly:

```bash
# claude
claude --dangerously-skip-permissions --no-session-persistence --print "$PROMPT_CONTENT" </dev/null

# codex
codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT_CONTENT" </dev/null

# amp
amp --dangerously-allow-all < "$CLAUDE_MD_PATH"
```

CLAUDE.md content is read at iteration start time (so changes take effect next iteration).

### Callback Payload (bridge → n8n)

Bridge POSTs to `callbackUrl` on completion:
```json
{
  "action": "done",
  "jobId": "uuid",
  "iteration": 3,
  "tool": "claude",
  "success": true,
  "exitCode": 0,
  "timedOut": false,
  "logFile": "scripts/ralph/archive/iteration_3_20260220_100000.log"
}
```

On timeout (`RALPH_ITERATION_TIMEOUT` exceeded):
```json
{
  "action": "done",
  "jobId": "uuid",
  "iteration": 3,
  "success": false,
  "timedOut": true,
  "exitCode": 124
}
```

### n8n Workflow Structure

**Workflow ID**: `ralph-loop`

**Nodes:**

1. **Webhook** (`n8n-nodes-base.webhook`)
   - Path: `/webhook/ralph-loop`
   - Method: POST
   - Authentication: none (internal use only, not public-facing)
   - Response mode: `onReceived` (async — 200 OK immediately)

2. **Switch: action** (`n8n-nodes-base.switch`)
   - Route on `$json.body.action`
   - Cases: `"start"` | `"done"` | default → error handler

3. **HTTP: GET /status** (`n8n-nodes-base.httpRequest`)
   - URL: `http://host-gateway:8765/status`
   - On error: continue (bridge may not be running yet)

4. **If: already running** (`n8n-nodes-base.if`)
   - Condition: `$json.running === true`
   - True → no-op (stop execution), False → continue

5. **HTTP: GET /prd.json** (`n8n-nodes-base.httpRequest`)
   - URL: `http://host-gateway:8765/prd.json`

6. **Code: check remaining stories** (`n8n-nodes-base.code`)
   - Parses `userStories`, finds `passes == false` count
   - Returns `{remaining: N, nextStory: {id, title}}`

7. **If: all done** (`n8n-nodes-base.if`)
   - Condition: `$json.remaining === 0`
   - True → Notification "complete" → stop, False → continue

8. **HTTP: POST /run-ralph** (`n8n-nodes-base.httpRequest`)
   - URL: `http://host-gateway:8765/run-ralph`
   - Body: `{ tool, maxIterations, callbackUrl: "https://n8n.labs.lair.nntin.xyz/webhook/ralph-loop" }`
   - The `tool` and `maxIterations` values must be **passed through every hop** — on the
     `"start"` path they come from `$json.body`; on the `"done"` callback path the bridge
     echoes them back in the callback payload so n8n can forward them to the next iteration.

9. **If: bridge rejected start** (`n8n-nodes-base.if`)
   - Condition: `$json.status !== "started"`
   - True → Notification error notification → stop

10. **Execute Workflow: notify** (`n8n-nodes-base.executeWorkflow`)
    - Workflow: `notify` (see `workflows/n8n-workflow/notify.md`)
    - `waitForWorkflow: false` (fire-and-forget — notification failure must not
      block the loop)
    - Payload shape: `{ title, body, level, source: "ralph", context: {...} }`
    - One Execute Workflow node per terminal event; each sets appropriate
      `level` and message text:

    | Event | level | title example |
    |-------|-------|---------------|
    | already busy (no-op) | `info` | "Ralph already running" |
    | nothing to do | `success` | "Nothing to do" |
    | started | `info` | "Ralph started — N stories remaining" |
    | iteration done | `info` | "Iteration N done — M remaining" |
    | all complete | `success` | "All stories complete!" |
    | max iterations reached | `warning` | "Max iterations (N) reached" |
    | iteration failed | `error` | "Iteration N failed (exitCode=X)" |
    | bridge/network error | `error` | "Ralph error" |

**Node connections:**
```
Webhook → Switch(action)
  "start" → GET /status → If(running?) → GET /prd.json → Code(remaining) → If(allDone?)
               allDone → Notify(nothing-to-do)                  │
               notDone → POST /run-ralph → If(rejected?) → Notify(started)
  "done"  → If(success?) → GET /prd.json → Code(remaining) → If(allDone?)
               allDone  → Notify(complete)
               notDone  → POST /run-ralph → If(rejected?) → Notify(iteration-done)
               failed   → Notify(iteration-failed)
```

**State threading**: The `tool` and `maxIterations` parameters must travel across the async
gap. Bridge echoes them back in the callback payload; n8n extracts them from `$json.body`
on each `"done"` webhook call to pass them to the next `/run-ralph` POST.

**Workflow dependencies:**
- `notify` workflow must be imported and active before this workflow is used.

---

## Security Considerations

**Authentication:**
- Bridge binds on `0.0.0.0:8765` but is only reachable from the Docker bridge network
  (no public firewall exposure needed)
- n8n webhook `/webhook/ralph-loop` has no auth — it's intended for internal use; the
  bridge is the only caller after the initial human-triggered start

**Data Handling:**
- The CLAUDE.md prompt may contain repo-specific paths and instructions — not sensitive
- Archive logs written to git-tracked `scripts/ralph/archive/` — do not contain secrets
- The `claude`/`codex` process runs with `--dangerously-skip-permissions` — ensure the
  host user account has appropriate filesystem boundaries

**Rate limiting:**
- The bridge's `already_running` guard prevents concurrent iterations
- `maxIterations` provides a hard cap to prevent runaway loops

---

## Testing

### Test Case 1: Bridge startup and status
```bash
node gsnake-n8n/tools/scripts/ralph-bridge.js &
curl http://localhost:8765/status
# Expected: { running: false, iteration: 0, ... }

curl http://localhost:8765/prd.json | jq '.userStories | length'
# Expected: 14 (or current count)
```

### Test Case 2: Start rejection when running
```bash
# POST to /run-ralph twice quickly
curl -X POST http://localhost:8765/run-ralph -H 'Content-Type: application/json' \
  -d '{"tool":"claude","callbackUrl":"http://localhost:9000/done","maxIterations":1}' &
curl -X POST http://localhost:8765/run-ralph -H 'Content-Type: application/json' \
  -d '{"tool":"claude","callbackUrl":"http://localhost:9000/done","maxIterations":1}'
# Second call expected: { status: "already_running", jobId: "..." }
```

### Test Case 3: Max iterations guard
```bash
# Set iteration = maxIterations in state, then try to start
curl http://localhost:8765/status  # check iteration count
# If iteration >= maxIterations:
# Expected: { status: "max_iterations_reached", ... }
```

### Test Case 4: n8n webhook start → done loop (end-to-end)
```bash
# 1. Import and activate workflow
./gsnake-n8n/tools/scripts/sync-workflows.sh import
# Activate ralph-loop in n8n UI

# 2. Start the loop
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph-loop \
  -H 'Content-Type: application/json' \
  -d '{"action":"start","tool":"claude","maxIterations":1}'

# 3. Monitor bridge log output
# 4. After iteration, verify:
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

**Cause:** `host-gateway` not configured in docker-compose, or bridge not running, or
bridge bound to `127.0.0.1` only

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

**Symptom:** Archive log shows `command not found` or similar; callback received with `exitCode: 127`

**Cause:** Bridge spawns with a minimal PATH that doesn't include the CLI binary location

**Resolution:** In `ralph-bridge.js`, inherit the full user PATH:
```js
const proc = spawn(tool, [...args], {
  env: { ...process.env },  // inherit full env including PATH
  stdio: ['pipe', outputStream, outputStream]
});
```

### Error: Callback never received by n8n

**Symptom:** Bridge log shows iteration completed, but n8n never receives the `/webhook/ralph-loop` POST

**Cause:** n8n webhook not active, or network routing from host → n8n container fails

**Resolution:**
```bash
# Verify webhook is active in n8n
curl https://n8n.labs.lair.nntin.xyz/webhook/ralph-loop  # Should return 404 or 200, not connection refused

# Test bridge callback manually
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph-loop \
  -H 'Content-Type: application/json' \
  -d '{"action":"done","jobId":"test","success":true,"iteration":1,"tool":"claude"}'
```

### Error: State file corruption after crash

**Symptom:** Bridge starts with `running: true` even though no process is active

**Resolution:**
```bash
# Reset state file
echo '{"running":false,"jobId":null,"iteration":0,"maxIterations":10,"startedAt":null,"tool":"claude"}' \
  > gsnake-n8n/tools/scripts/ralph-bridge.state.json
```

---

## Edge Cases

**Edge Case 1: n8n restarts while iteration in flight**
- Condition: Bridge is running claude/codex; n8n restarts
- Behavior: Bridge completes, POSTs callback to `/webhook/ralph-loop`; the persistent webhook
  endpoint triggers a fresh n8n execution that picks up at the `"done"` branch normally
- Rationale: n8n webhooks are persistent (not tied to a specific execution), so the callback
  always lands correctly

**Edge Case 2: Bridge restarts while iteration in flight**
- Condition: Bridge process dies mid-iteration (crash, systemd restart)
- Behavior: State file persists `running: true`; bridge restores state on startup and sees
  orphaned `running: true` with no active process; it should detect this (check if the
  child PID is still alive) and reset `running: false`, then POST callback with `success: false`
- Implementation note: Store child PID in state file; on startup, `kill -0 pid` to check liveness

**Edge Case 3: All stories already pass when loop is started**
- Condition: `prd.json` has all `passes: true`
- Behavior: n8n checks PRD after status check, finds 0 remaining, sends notification "nothing to do" and stops
- No iteration is started

**Edge Case 4: Bridge returns `max_iterations_reached`**
- Condition: `state.iteration >= state.maxIterations`
- Behavior: n8n receives `{status: "max_iterations_reached"}`, sends notification
  with remaining story count, stops the loop

---

## Integration Points

**Upstream:**
- Human (or automation) POSTs to `/webhook/ralph-loop` with `{action:"start"}`
- Existing n8n CI suite can optionally trigger ralph after all CI checks pass

**Downstream:**
- Bridge reads `scripts/ralph/CLAUDE.md` as the AI prompt
- Bridge writes iteration logs to `scripts/ralph/archive/`
- AI agent commits to the gSnake repo (pushing story completions)
- n8n calls the `notify` workflow on each phase (which routes to Discord and future channels)

**Data flow:**
```
Human → POST /webhook/ralph-loop (start)
  → n8n → POST host:8765/run-ralph
  → bridge spawns claude
  → claude commits code, sets passes:true in prd.json, git pushes
  → claude exits
  → bridge POST /webhook/ralph-loop (done)
  → n8n checks prd.json via GET host:8765/prd.json
  → n8n → POST host:8765/run-ralph (next iteration)
  → ... repeat until all passes:true or maxIterations
  → n8n notification service
```

---

## Rollback Procedure

```bash
# 1. Stop the bridge
sudo systemctl stop ralph-bridge.service
# or kill the manual process

# 2. Reset state
echo '{"running":false,"jobId":null,"iteration":0,"maxIterations":10,"startedAt":null,"tool":"claude"}' \
  > gsnake-n8n/tools/scripts/ralph-bridge.state.json

# 3. Deactivate n8n workflow
# In n8n UI: ralph-loop → toggle inactive

# 4. Fall back to manual ralph.sh
./scripts/ralph/ralph.sh --tool claude 5
```

---

## Related Documentation

- **ralph.sh source of truth**: `scripts/ralph/ralph.sh`
- **Agent prompt**: `scripts/ralph/CLAUDE.md`
- **PRD format**: `scripts/ralph/prd.json`
- **CI orchestration**: `workflows/n8n-workflow/dispatch-multi-repo-ci-suite-and-capture-results.md`
- **n8n infrastructure**: `FINDINGS.md`
- **n8n sync**: `workflows/infra/n8n-sync.md`

---

## Changelog

**2026-02-20**: Initial SOP created

---

## Implementation Checklist

- [ ] Create `tools/scripts/ralph-bridge.openapi.yaml` (OpenAPI 3.0 spec for bridge API)
- [ ] Create `tools/scripts/ralph-bridge.js` (Node.js ESM, stdlib only, implements all 3 endpoints)
- [ ] Create `tools/scripts/ralph-bridge.service` (systemd unit template)
- [ ] Create `tools/n8n-flows/ralph-loop.json` (n8n workflow JSON)
- [ ] Add `extra_hosts: - "host-gateway:host-gateway"` to n8n docker-compose
- [ ] Deploy docker-compose change: `docker compose down && docker compose up -d`
- [ ] Start bridge and verify `GET /status` responds
- [ ] Import workflow: `./tools/scripts/sync-workflows.sh import`
- [ ] Activate `ralph-loop` in n8n UI
- [ ] Test Case 1–4 from Testing section pass
- [ ] Update `CLAUDE.md` SOP mapping table
- [ ] Set `implementation_status: implemented` in this file's frontmatter
