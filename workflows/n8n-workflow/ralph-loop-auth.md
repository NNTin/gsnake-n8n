---
implementation_status: implemented
tool_type: "n8n-workflow"
tool_location: "tools/n8n-flows/ralph-loop-auth.json"
workflow_id: "ralph-loop-auth"
last_updated: "2026-02-21"
dependencies: []
tags: ["ralph", "auth", "gateway", "security", "webhook"]
---

# Ralph Loop Auth

Authentication gateway for the Ralph Loop. All external traffic into the Ralph system —
both human-initiated starts and bridge-sent callbacks — enters through this workflow.
Validates a shared bearer token then forwards the payload to the internal `ralph-loop`
workflow via Execute Workflow.

## Objective

- **What**: An n8n webhook workflow that validates incoming requests against a shared bearer
  token before passing them to the `ralph-loop` workflow via Execute Workflow.
- **Why**: Separating auth from orchestration keeps each workflow focused. Centralizing the
  entry point ensures no unauthenticated request can reach the Ralph state machine — including
  spoofed `action: "done"` callbacks that would advance the loop without real work completing.
- **When**: This is the single external entry point for all Ralph traffic. Do not call the
  `ralph-loop` workflow directly via HTTP. Both human operators and the bridge service send
  requests to this workflow's webhook URL.

---

## Prerequisites

**n8n Variable (one-time setup in n8n UI → Settings → Variables):**

| Variable | Example value | Purpose |
|----------|---------------|---------|
| `RALPH_WEBHOOK_TOKEN` | `<256-bit hex string>` | Shared secret for bearer token validation |

Generate a secure token:
```bash
openssl rand -hex 32
```

**Bridge environment variable** (add to the ralph-bridge systemd `EnvironmentFile` or unit):

```bash
RALPH_WEBHOOK_TOKEN=<same-value-as-n8n-variable>
```

The bridge includes `Authorization: Bearer <RALPH_WEBHOOK_TOKEN>` in every outbound callback
POST to the ralph-loop-auth webhook.

---

## Implementation Details

**Tool Type**: n8n webhook workflow

**Location**: `tools/n8n-flows/ralph-loop-auth.json`

**Workflow ID**: `ralph-loop-auth`

**Response mode**: `responseNode` — allows explicit `Respond to Webhook` nodes to return HTTP 202 on success and 401 on failure.

---

## Usage

### Endpoint URLs

- **Production endpoint** (active workflow):  
  `POST https://n8n.labs.lair.nntin.xyz/webhook/ralph`
- **Test endpoint** (editor test mode only):  
  `POST https://n8n.labs.lair.nntin.xyz/webhook-test/ralph`
  - Requires clicking **Execute workflow** in the editor before each request.
  - Valid for one request per click.

All Ralph traffic uses the production endpoint and authentication header:

```bash
# Human-initiated start
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <RALPH_WEBHOOK_TOKEN>' \
  -d '{"action":"start","tool":"claude","maxIterations":20}'

# Bridge-sent callback (sent automatically by ralph-bridge.js on CLI exit)
# POST https://n8n.labs.lair.nntin.xyz/webhook/ralph
# Authorization: Bearer <RALPH_WEBHOOK_TOKEN>
# { "action": "done", "jobId": "...", "success": true, "iteration": 3, ... }
```

**Response codes:**
- `202 Accepted` — token valid; payload forwarded to `ralph-loop` workflow
- `401 Unauthorized` — missing or invalid token; request rejected

---

## Technical Specifications

### n8n Workflow Structure

**Nodes:**

1. **Webhook** (`n8n-nodes-base.webhook`)
   - Path: `/webhook/ralph`
   - Method: POST
   - Response mode: `responseNode` (response is produced by dedicated Respond to Webhook nodes)
   - n8n-level authentication: none (token checked manually in Code node)

2. **Code: validate auth** (`n8n-nodes-base.code`)
   - Extracts the `Authorization` header and compares it against the n8n Variable using
     `crypto.timingSafeEqual` to resist timing attacks.
   - Fails closed when `RALPH_WEBHOOK_TOKEN` is unset.
   - Returns `{ valid: true, body: ... }` on success, `{ valid: false }` on failure.
   ```js
   const crypto = require('crypto');
   const headers = $input.first().json.headers;
   const authHeader = headers['authorization'] ?? '';
   const token = $vars.RALPH_WEBHOOK_TOKEN;
   if (typeof token !== 'string' || token.length === 0) {
     return [{ json: { valid: false, body: $input.first().json.body } }];
   }
   const expected = 'Bearer ' + token;
   // timingSafeEqual requires equal-length buffers; compare lengths first
   const a = Buffer.from(authHeader);
   const b = Buffer.from(expected);
   const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
   return [{ json: { valid, body: $input.first().json.body } }];
   ```

3. **If: auth valid?** (`n8n-nodes-base.if`)
   - Condition: `$json.valid === true`
   - True → forward to ralph-loop
   - False → return 401

4. **Execute Workflow: ralph-loop** (`n8n-nodes-base.executeWorkflow`)
   - Workflow: `ralph-loop`
   - `waitForSubWorkflow: false` — fire-and-forget; ralph-loop is long-running and async
   - `alwaysOutputData: true` + `continueOnFail: true` so the HTTP 202 response path always continues even if sub-workflow dispatch fails
   - Input data: `$json.body` (the original request payload stripped of auth header)

5. **Respond: 202 Accepted** (`n8n-nodes-base.respondToWebhook`)
   - HTTP status: 202
   - Body: `{ "status": "accepted" }`
   - Connected from: Execute Workflow output

6. **Respond: 401 Unauthorized** (`n8n-nodes-base.respondToWebhook`)
   - HTTP status: 401
   - Body: `{ "error": "unauthorized", "message": "Invalid or missing bearer token." }`
   - Connected from: If node False branch

**Node connections:**
```
Webhook → Code(validate auth) → If(valid?)
  true  → Execute Workflow(ralph-loop) → Respond 202
  false → Respond 401
```

---

## Security Considerations

**Token storage:**
- Stored in n8n Variables (UI → Settings → Variables) — not in workflow JSON or `.env`
- Bridge reads token from env var injected via systemd `EnvironmentFile`
- Do not log or expose the token value in Code node `console.log()` calls

**Timing-safe comparison:**
- Use `crypto.timingSafeEqual` (see Code node above) to avoid leaking token length or
  content via response timing

**Token rotation procedure:**
1. Generate new token: `openssl rand -hex 32`
2. Update n8n Variable `RALPH_WEBHOOK_TOKEN` in n8n UI
3. Update bridge env var `RALPH_WEBHOOK_TOKEN` and restart: `sudo systemctl restart ralph-bridge.service`
4. Old token is immediately invalid on both sides

**Webhook exposure:**
- The `/webhook/ralph` path is reachable via the public n8n URL
- Any POST without the correct token is rejected with 401 before reaching ralph-loop logic
- Failed auth attempts are visible in n8n execution logs

---

## Testing

### Test Case 1: Valid token — start action
```bash
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat .ralph-token)" \
  -d '{"action":"start","tool":"claude","maxIterations":1}'
# Expected: HTTP 202 { "status": "accepted" }
# Verify: ralph-loop workflow execution appears in n8n history
```

### Test Case 2: Invalid token
```bash
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer wrong-token' \
  -d '{"action":"start","tool":"claude","maxIterations":1}'
# Expected: HTTP 401 { "error": "unauthorized", ... }
```

### Test Case 3: Missing Authorization header
```bash
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph \
  -H 'Content-Type: application/json' \
  -d '{"action":"start","tool":"claude","maxIterations":1}'
# Expected: HTTP 401 { "error": "unauthorized", ... }
```

### Test Case 3b: Test endpoint behavior (editor mode)
```bash
# 1) In n8n editor, open ralph-loop-auth and click "Execute workflow"
# 2) Immediately run:
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook-test/ralph \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer wrong-token' \
  -d '{"action":"start"}'
# Expected: HTTP 401
#
# Note: webhook-test endpoint is one-shot; click Execute workflow again before each test call.
```

### Test Case 4: Simulated bridge callback
```bash
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/ralph \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat .ralph-token)" \
  -d '{"action":"done","jobId":"test-uuid","success":true,"iteration":1,"tool":"claude","exitCode":0,"timedOut":false,"aborted":false}'
# Expected: HTTP 202 { "status": "accepted" }
# Verify: ralph-loop "done" branch executes in n8n history
```

---

## Error Handling

### Error: n8n Variable `RALPH_WEBHOOK_TOKEN` not set

**Symptom:** All requests return 401 even with a correct token.

**Resolution:** Set the variable in n8n UI → Settings → Variables → Add Variable.

### Error: Bridge callback rejected with 401

**Symptom:** Bridge log shows `401` on callback POST; n8n loop stalls (no "done" event arrives).

**Resolution:**
1. Verify `RALPH_WEBHOOK_TOKEN` is set in bridge systemd unit
2. Compare values: `systemctl show ralph-bridge.service -p Environment` vs n8n Variable
3. Restart bridge: `sudo systemctl restart ralph-bridge.service`

### Error: Workflow not activated

**Symptom:** n8n returns 404 on webhook path.

**Resolution:** Activate `ralph-loop-auth` in n8n UI (toggle → Active).

---

## Integration Points

**Upstream:** Human operator (curl / automation) and ralph-bridge.js (callback POSTs)

**Downstream:** `ralph-loop` workflow (via Execute Workflow — internal, no HTTP)

---

## Related Documentation

- **Ralph Loop SOP**: `workflows/n8n-workflow/ralph-loop.md`
- **Bridge API spec**: `tools/scripts/ralph-bridge.openapi.yaml`
- **Architecture diagram**: `gsnake-specs/ralph-loop/architecture.md`

---

## Changelog

**2026-02-21**: Initial SOP created

---

## Implementation Checklist

- [ ] Generate `RALPH_WEBHOOK_TOKEN`: `openssl rand -hex 32`
- [ ] Set `RALPH_WEBHOOK_TOKEN` in n8n Variables (UI → Settings → Variables)
- [ ] Add `RALPH_WEBHOOK_TOKEN` to bridge systemd `EnvironmentFile` and restart service
- [ ] Create `tools/n8n-flows/ralph-loop-auth.json`
- [ ] Import workflow: `./tools/scripts/sync-workflows.sh import`
- [ ] Activate `ralph-loop-auth` in n8n UI
- [ ] Test Cases 1–4 from Testing section pass
- [ ] Update `CLAUDE.md` SOP mapping table
- [ ] Set `implementation_status: implemented` in this file's frontmatter
