---
implementation_status: implemented
tool_type: "n8n-workflow"
tool_location: "tools/n8n-flows/notify.json"
workflow_id: "notify"
last_updated: "2026-02-21"
dependencies: []
tags: ["notification", "discord", "messaging", "fan-out"]
---

# Notify

Generic notification fan-out workflow. Accepts a normalized message payload and
delivers it to all configured channels. Currently routes to Discord; designed to
extend to WhatsApp, Telegram, email, or any other channel without callers needing
to change.

## Objective

- **What**: An internal n8n workflow that receives a structured notification payload
  and delivers it to one or more messaging channels.
- **Why**: Centralizes all notification delivery in one place so callers (ralph-loop,
  CI suite, etc.) stay decoupled from channel-specific APIs, credentials, and
  formatting logic. Adding a new channel only requires updating this workflow.
- **When**: Called via **Execute Workflow** by any n8n workflow that needs to send
  a notification to humans. Never triggered externally via webhook.

---

## Prerequisites

**Credentials (required):**
- `discordWebhookApi` — existing credential; `webhookUri` must point to the target
  Discord channel webhook URL.

**Future credentials (not yet required):**
- `whatsappApi` — for WhatsApp Business API delivery
- `telegramApi` — for Telegram Bot API delivery

---

## Implementation Details

**Tool Type**: n8n workflow (Execute Workflow trigger + Manual Trigger for testing)

**Location**: `tools/n8n-flows/notify.json`

**Workflow ID**: `notify`

**Key Technologies**: n8n Execute Workflow Trigger, n8n Discord node
(`discordWebhookApi`), n8n Switch node for channel routing

---

## Usage

This workflow is never called directly via HTTP.

Production callers use the **Execute Workflow** node in n8n:

```
Execute Workflow node
  workflowId: "notify"
  waitForWorkflow: false   ← fire-and-forget; don't block caller
  inputData:
    title: "Ralph started"
    body: "3 stories remaining. tool=claude, maxIterations=20"
    level: "info"
    source: "ralph"
    context: { iteration: 1, remaining: 3, tool: "claude" }
```

**`waitForWorkflow: false`** is the recommended setting for all callers so that a
slow or failed notification never blocks the main workflow.

Manual verification can run from the **Manual Trigger** path, which injects a
predefined test payload and sends it through the same formatter/router/Discord path.

---

## Technical Specifications

### Input Format

All fields except `title` are optional but recommended.

```json
{
  "title": "Short human-readable headline (required)",
  "body":  "Optional multi-line detail text",
  "level": "info | success | warning | error",
  "channel": "discord (optional, defaults to discord)",
  "source": "ralph | ci | manual | other",
  "context": {
    "any": "caller-specific key/value pairs for debugging or rich formatting"
  }
}
```

**`level` → Discord embed color mapping:**

| level   | color (hex) | meaning                      |
|---------|-------------|------------------------------|
| info    | `#5865F2`   | neutral / in-progress        |
| success | `#57F287`   | completed successfully       |
| warning | `#FEE75C`   | partial success / limit hit  |
| error   | `#ED4245`   | failure / unexpected error   |

### n8n Workflow Structure

**Nodes:**

1. **Execute Workflow Trigger** (`n8n-nodes-base.executeWorkflowTrigger`)
   - Receives the normalized payload from calling workflows.

2. **Manual Trigger** (`n8n-nodes-base.manualTrigger`)
   - Used for one-click manual validation in n8n editor.

3. **Code: manual test payload** (`n8n-nodes-base.code`)
   - Builds a predefined payload for manual trigger runs.

4. **Code: format message** (`n8n-nodes-base.code`)
   - Maps `level` → embed color.
   - Constructs the channel-agnostic message object:
     ```json
     {
       "title": "...",
       "body": "...",
       "color": 5765298,
       "channel": "discord",
       "source": "ralph",
       "context": {}
     }
     ```

5. **Switch: channel routing** (`n8n-nodes-base.switch`)
   - Routes by `channel` field (`discord` currently supported).
   - `Code: format message` sets `channel = "discord"` when omitted, so existing
     callers continue working without changes.
   - Current active output: `discord`
   - Future outputs: `whatsapp`, `telegram` (inactive placeholder branches)
   - When future channels are added, additional rules can route by `channel`
     or by per-`source` policy.

6. **Discord: send notification** (`n8n-nodes-base.discord`)
   - Credential: `discordWebhookApi`
   - Sends an embed with `title`, `description` (body), and `color`.
   - `continueOnFail: true` so a Discord outage does not propagate errors
     back to the caller.

5. *(Future)* **WhatsApp / Telegram / etc. nodes**
   - Each channel gets its own branch off the Switch node.
   - Channel-specific credential and formatting live entirely within this
     workflow.

**Node connections:**
```
Execute Workflow Trigger → Code (format message)
Manual Trigger → Code (manual test payload) → Code (format message)
  → Switch (channel routing)
      "discord"   → Discord node → ● done
      "whatsapp"  → (future)
      "telegram"  → (future)
```

**Credentials used:**
- `discordWebhookApi` — Discord delivery

---

## Security Considerations

**Authentication:**
- Not externally accessible (Execute Workflow trigger only, no webhook path).
- No authentication required between n8n workflows.

**Data Handling:**
- Notification payloads may contain iteration counts, story IDs, or exit codes —
  none of which are secrets.
- Do not pass API keys or credentials in the `context` field.

---

## Testing

### Test Case 1: info-level notification

In n8n UI, use **Test Workflow** with input:

```json
{
  "title": "Test notification",
  "body": "This is a test message from the notify workflow.",
  "level": "info",
  "source": "manual"
}
```

Expected: Discord message appears with blue embed.

### Test Case 2: error-level notification

```json
{
  "title": "Iteration failed",
  "body": "Iteration 3 failed. exitCode=1, timedOut=false.",
  "level": "error",
  "source": "ralph",
  "context": { "iteration": 3, "exitCode": 1, "timedOut": false }
}
```

Expected: Discord message appears with red embed.

### Test Case 3: called from another workflow

Add an Execute Workflow node to any test workflow pointing at `notify`, pass
the payload, and verify Discord delivery without errors propagating back to
the caller.

---

## Error Handling

### Error: Discord delivery fails

**Symptom:** Discord node fails (invalid credential, rate limit, API outage).

**Behavior:** `continueOnFail: true` on the Discord node prevents the error from
propagating back to the caller. The failure is visible in n8n execution logs.

**Resolution:**
1. Check `discordWebhookApi` credential (`webhookUri` valid and not rotated).
2. Test Discord webhook directly:
   ```bash
   curl -X POST "$(n8n_discord_webhook_url)" \
     -H "Content-Type: application/json" \
     -d '{"content": "test"}'
   ```
3. Regenerate the Discord webhook in channel settings and update the n8n credential.

---

## Edge Cases

**Edge Case 1: `level` field missing or unknown**
- Condition: Caller omits `level` or passes an unrecognized value.
- Behavior: Code node defaults to `info` color (`#5865F2`).

**Edge Case 2: `body` field missing**
- Condition: Caller passes only `title`.
- Behavior: Discord embed is sent with title only; no description field.

**Edge Case 3: `context` field contains deeply nested objects**
- Condition: Caller passes large or complex `context`.
- Behavior: Context is available for logging / debugging in n8n execution history
  but is not rendered in the Discord embed unless the Code node explicitly formats it.

---

## Future Improvements

- [ ] Add WhatsApp Business API channel
- [ ] Add Telegram Bot API channel
- [ ] Support per-`source` channel routing (e.g., ralph → #ralph channel, CI → #ci channel)
- [ ] Add n8n execution logging node for audit trail
- [ ] Support `@mention` or `role ping` on `error`-level messages

---

## Integration Points

**Callers (upstream):**
- `workflows/n8n-workflow/ralph-loop.md` — notification on each loop event
- `workflows/n8n-workflow/dispatch-multi-repo-ci-suite-and-capture-results.md` — CI result notifications (future)

**Downstream:**
- Discord channel (active)
- WhatsApp / Telegram (future)

---

## Related Documentation

- **Architecture diagram**: `gsnake-specs/ralph-loop/architecture.md` §8
- **Ralph loop SOP**: `workflows/n8n-workflow/ralph-loop.md`
- **Discord credential**: `discordWebhookApi` in n8n credential manager
- **WAT Framework**: `gsnake-n8n/CLAUDE.md`

---

## Changelog

**2026-02-20**: Initial SOP created

---

## Implementation Checklist

- [ ] Create `tools/n8n-flows/notify.json` (n8n workflow JSON)
- [ ] Import workflow: `./tools/scripts/sync-workflows.sh import`
- [ ] Bind `discordWebhookApi` credential in n8n UI
- [ ] Test Case 1–3 from Testing section pass
- [ ] Update `CLAUDE.md` SOP mapping table
- [ ] Set `implementation_status: implemented` in this file's frontmatter
