# Implementing n8n Workflows: Complete Guide

This document captures critical learnings from implementing the GitHub → Discord webhook workflow. Use this as a reference when implementing future n8n workflows from SOPs.

**⚠️ SECURITY NOTE**: This document contains NO secrets. All credentials, passwords, and API keys are stored in `.env` files which are git-ignored. When you see references to `$N8N_EMAIL`, `$N8N_PASSWORD`, `$N8N_WEBHOOK_SECRET`, etc., these values must be loaded from:
- `~/git/gSnake/gsnake-n8n/.env` (local testing credentials)
- `~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/.env` (production n8n configuration)

**NEVER commit secrets to git!**

---

## Table of Contents

1. [Environment Setup & Access](#environment-setup--access)
2. [n8n Security Model](#n8n-security-model)
3. [Workflow Development Cycle](#workflow-development-cycle)
4. [HMAC Signature Validation](#hmac-signature-validation)
5. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
6. [Testing Strategies](#testing-strategies)
7. [Debugging with Browser Automation](#debugging-with-browser-automation)
8. [Production Deployment Checklist](#production-deployment-checklist)

---

## Environment Setup & Access

### n8n Instance Location

**Self-hosted n8n configuration:**
- **docker-compose.yml**: `~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/docker-compose.yml`
- **.env file**: `~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/.env`
- **Container name**: `n8n`
- **Network**: `nntin-labs-network`
- **Version**: 2.4.6 (as of 2026-02-08)

**IMPORTANT**: The local `.env` at `~/git/gSnake/gsnake-n8n/.env` is **only for local testing** and contains:
- `N8N_EMAIL` - For agent-browser authentication
- `N8N_PASSWORD` - For agent-browser authentication
- `GITHUB_TOKEN` - For triggering GitHub Actions
- Reference comments pointing to actual n8n service configuration

### Accessing the n8n Container

```bash
# Connect to running container
docker exec -it n8n sh

# View logs
docker logs n8n -f

# Check environment variables
docker exec n8n env | grep -E "NODE_FUNCTION|N8N_"

# Restart container (picks up docker-compose changes)
cd ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n
docker compose restart

# Full restart (picks up .env changes)
docker compose down && docker compose up -d
```

**CRITICAL**: Simple `docker compose restart` does NOT pick up `.env` changes. Must use `down && up -d`.

### Accessing n8n UI

**Via Browser Automation:**
```bash
# Load credentials from .env first
source ~/git/gSnake/gsnake-n8n/.env

# Open n8n in agent-browser
agent-browser open "https://n8n.labs.lair.nntin.xyz/"

# Take snapshot to see current state
agent-browser snapshot

# Login (if needed)
agent-browser fill @e1 "$N8N_EMAIL"
agent-browser fill @e2 "$N8N_PASSWORD"
agent-browser click @e3
```

**Credentials:**
- Email: `nguyen.ngoctindaniel@gmail.com` (stored in `N8N_EMAIL`)
- Password: See `.env` file (stored in `N8N_PASSWORD`)

---

## n8n Security Model

### Built-in Module Access

**Default**: All Node.js built-in modules are **BLOCKED** in Code nodes.

**Required Environment Variable:**
```bash
# In ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/.env
NODE_FUNCTION_ALLOW_BUILTIN=crypto

# Or allow all:
NODE_FUNCTION_ALLOW_BUILTIN=*
```

**Common built-in modules needed:**
- `crypto` - For HMAC validation, hashing
- `fs` - For file operations (if needed)
- `path` - For path manipulation

**How to verify it's set:**
```bash
docker exec n8n env | grep NODE_FUNCTION_ALLOW_BUILTIN
# Should output: NODE_FUNCTION_ALLOW_BUILTIN=crypto
```

### Environment Variable Access

**Default in n8n v2.0+**: Environment variables are **BLOCKED** in Code nodes (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true` by default).

**Required Environment Variable:**
```bash
# In ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/.env
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

**How to verify:**
```bash
docker exec n8n env | grep N8N_BLOCK_ENV_ACCESS
# Should output: N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

**Usage in Code nodes:**
```javascript
// Access environment variables
const secret = $env.N8N_WEBHOOK_SECRET;
const discordUrl = $env.DISCORD_WEBHOOKURL;

// Always check if variable exists
if (!secret) {
  throw new Error('N8N_WEBHOOK_SECRET not set');
}
```

### Environment Variable Alternatives

If you prefer NOT to disable the security block, use **n8n Credentials** instead:

1. **Create credential in n8n UI**: Settings → Credentials → Add Credential → Generic Credential
2. **Store your secret** in the credential
3. **Reference in Code node**:
   ```javascript
   // NOTE: This approach requires different n8n node configuration
   // Not tested in current implementation
   const secret = $credentials.github_webhook_secret;
   ```

**Recommendation**: For webhook secrets, `$env` with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is simpler and sufficient for self-hosted instances.

### Complete Security Configuration

**Minimal required configuration for crypto + env access:**
```bash
# In ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/.env
NODE_FUNCTION_ALLOW_BUILTIN=crypto
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

**After adding to .env, update docker-compose.yml:**
```yaml
# In ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/docker-compose.yml
environment:
  - NODE_FUNCTION_ALLOW_BUILTIN=${NODE_FUNCTION_ALLOW_BUILTIN}
  - N8N_BLOCK_ENV_ACCESS_IN_NODE=${N8N_BLOCK_ENV_ACCESS_IN_NODE}
```

**Then restart:**
```bash
cd ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n
docker compose down && docker compose up -d
```

---

## Workflow Development Cycle

### 1. Create Workflow JSON

**Option A: Manual Creation**
- Create JSON file in `tools/n8n-flows/`
- Use existing workflow as template
- Workflow ID should match filename: `tools/n8n-flows/github-discord-notify.json` → ID: `github-discord-notify`

**Option B: Create in n8n UI, then export**
```bash
./tools/scripts/sync-workflows.sh export
# Workflow appears in tools/n8n-flows/ with ID as filename
```

### 2. Import Workflow to n8n

```bash
cd ~/git/gSnake/gsnake-n8n
./tools/scripts/sync-workflows.sh import
```

**What happens:**
- All JSON files in `tools/n8n-flows/` are uploaded to n8n
- Workflows are **deactivated by default** after import
- Workflow IDs from JSON are preserved (idempotent)
- Reimporting same ID updates workflow in place

**Output:**
```
Importing 2 workflows...
Deactivating workflow "GitHub to Discord Notification". Remember to activate later.
Successfully imported 2 workflows.
```

### 3. Activate Workflow

**Option A: Via n8n UI** (recommended for first-time activation)
```bash
# Open workflow in browser
agent-browser open "https://n8n.labs.lair.nntin.xyz/workflow/github-discord-notify"

# Login if needed
agent-browser fill @e1 "$N8N_EMAIL"
agent-browser fill @e2 "$N8N_PASSWORD"
agent-browser click @e3

# Click Publish button
agent-browser click @e2  # Publish button
sleep 2
agent-browser click @e65  # Confirm publish in dialog
```

**Option B: Via n8n API** (programmatic, but more complex)
```bash
# See n8n REST API documentation
# Requires authentication cookie handling
```

**Verification:**
```bash
# Check if workflow is activated
docker logs n8n --tail 20 | grep -i "activated.*github"
# Should show: Activated workflow "GitHub to Discord Notification" (ID: github-discord-notify)
```

### 4. Test Workflow

**Webhook workflows:**
```bash
# Test endpoint (should return 200 or execute workflow)
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/github-discord \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

**Check execution status:**
- Open n8n UI → Workflow → Executions tab
- Or use agent-browser to view execution history

### 5. Debug Failed Executions

See [Debugging with Browser Automation](#debugging-with-browser-automation) section below.

### 6. Export Changes

After modifying workflow in n8n UI:
```bash
./tools/scripts/sync-workflows.sh export
git diff tools/n8n-flows/github-discord-notify.json
git add tools/n8n-flows/
git commit -m "feat: update workflow logic"
```

---

## HMAC Signature Validation

### The Critical Problem

**GitHub calculates HMAC on raw request bytes**. If you re-stringify the parsed JSON, the signature won't match due to:
- Different whitespace
- Different key ordering
- Different escaping

### ❌ WRONG Implementation

```javascript
// This will FAIL signature validation
const body = firstItem.json.body;  // Parsed JSON object
const hmac = crypto
  .createHmac('sha256', secret)
  .update(JSON.stringify(body))  // Re-stringified - won't match original!
  .digest('hex');
```

**Why it fails:**
```javascript
// Original GitHub request:
{"ref":"refs/heads/main","commits":[...]}

// After JSON.stringify():
{"ref": "refs/heads/main", "commits": [...]}
//      ^^^ extra spaces added - signature mismatch!
```

### ✅ CORRECT Implementation

```javascript
// Access raw body from webhook node's binary data
const rawBodyBuffer = firstItem.binary?.data?.data;
if (!rawBodyBuffer) {
  throw new Error('Raw body not available - ensure webhook node has rawBody: true');
}

// Decode base64 to get original request body
const rawBody = Buffer.from(rawBodyBuffer, 'base64').toString('utf8');

// Calculate HMAC on raw body (same as GitHub does)
const hmac = crypto
  .createHmac('sha256', secret)
  .update(rawBody)  // Original raw body
  .digest('hex');

const expectedSignature = `sha256=${hmac}`;
```

### Webhook Node Configuration

**CRITICAL**: Webhook node must have `rawBody: true` option:

```json
{
  "parameters": {
    "httpMethod": "POST",
    "path": "github-discord",
    "responseMode": "onReceived",
    "options": {
      "rawBody": true  // ← REQUIRED for HMAC validation
    }
  },
  "type": "n8n-nodes-base.webhook"
}
```

**What `rawBody: true` does:**
- Stores original request body as base64 in `firstItem.binary.data.data`
- Still parses JSON into `firstItem.json.body` for convenience
- Allows both structured access and raw body signature validation

### Complete Validation Code

```javascript
const crypto = require('crypto');

const items = $input.all();
const firstItem = items[0];
const headers = firstItem.json.headers || {};

// Localhost bypass (optional for testing)
const host = headers['host'] || '';
if (host.includes('localhost') || host.includes('127.0.0.1')) {
  console.log('Localhost request - skipping signature validation');
  return items;
}

// Get secret and signature
const secret = $env.N8N_WEBHOOK_SECRET;
const signature = headers['x-hub-signature-256'];

if (!signature) {
  throw new Error('Missing X-Hub-Signature-256 header');
}

if (!secret) {
  throw new Error('N8N_WEBHOOK_SECRET environment variable not set');
}

// Get raw body
const rawBodyBuffer = firstItem.binary?.data?.data;
if (!rawBodyBuffer) {
  throw new Error('Raw body not available - ensure webhook node has rawBody: true');
}

const rawBody = Buffer.from(rawBodyBuffer, 'base64').toString('utf8');

// Validate signature
const hmac = crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');

const expectedSignature = `sha256=${hmac}`;

if (signature !== expectedSignature) {
  console.log('Signature mismatch:');
  console.log('  Expected:', expectedSignature);
  console.log('  Received:', signature);
  throw new Error('Invalid GitHub signature');
}

console.log('✓ Signature validated successfully');
return items;
```

---

## Common Pitfalls & Solutions

### 1. Workflow Not Registered After Activation

**Symptom:**
```bash
curl https://n8n.labs.lair.nntin.xyz/webhook/github-discord
# Returns: 404 - webhook not registered
```

**Causes:**
- Workflow was imported but not activated
- n8n restarted and workflow wasn't auto-activated
- Webhook path mismatch

**Solution:**
```bash
# Check if workflow is active
docker logs n8n --tail 50 | grep -i "activated"

# If not activated, use n8n UI to activate
agent-browser open "https://n8n.labs.lair.nntin.xyz/workflow/github-discord-notify"
# Click Publish button

# Verify webhook is registered
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/github-discord \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
# Should return 200, not 404
```

### 2. Container ID Changes After Restart

**Symptom:**
```bash
./tools/scripts/sync-workflows.sh import
# Error: Container 440742681e58... not found
```

**Cause:** Sync script had hardcoded container ID, which changes on restart.

**Solution:**
```bash
# Update sync script to use container name instead
# In tools/scripts/sync-workflows.sh:
CONTAINER_ID="n8n"  # Not the hex ID

# Container name is stable across restarts
```

### 3. Environment Variable Changes Not Picked Up

**Symptom:**
```bash
# Added new variable to .env
docker compose restart
docker exec n8n env | grep NEW_VAR
# Variable not found!
```

**Cause:** `docker compose restart` doesn't reload `.env` file.

**Solution:**
```bash
# Must use down && up to pick up .env changes
docker compose down && docker compose up -d

# Verify
docker exec n8n env | grep NEW_VAR
```

### 4. Code Node Execution Errors Not Visible

**Symptom:**
- Workflow fails
- n8n UI shows "Error" but no details
- `console.log()` output not in docker logs

**Cause:** Console logs from Code nodes don't always appear in docker logs.

**Solution:**
```bash
# Use n8n UI to debug
agent-browser open "https://n8n.labs.lair.nntin.xyz/workflow/github-discord-notify"
agent-browser click @e7  # Click Executions tab

# Click on failed execution
# Click "Debug in editor"
# Open logs panel to see error details
```

### 5. Webhook Receives Request But Returns Wrong Status

**Symptom:**
- GitHub shows webhook delivered (200 OK)
- But workflow failed internally
- Discord notification not sent

**Cause:** Webhook `responseMode: "onReceived"` returns 200 immediately, before workflow completes.

**Solution:**
- Use `responseMode: "lastNode"` if you want response to reflect workflow success/failure
- Or check n8n execution history to see actual workflow status
- Current implementation uses "onReceived" for async processing (fire-and-forget)

---

## Testing Strategies

### Local Testing (Bypass Signature)

**Localhost requests skip HMAC validation** (by design):

```bash
# Test from localhost - no signature needed
curl -X POST http://localhost:5678/webhook/github-discord \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -d @test-payload.json
```

**Advantage:** Fast iteration, no need to calculate signatures.

### Production Testing (With Signature)

**Generate valid HMAC signature:**

```bash
#!/bin/bash
# Load secret from .env
source ~/git/gSnake/gsnake-n8n/.env
SECRET="$N8N_WEBHOOK_SECRET"

PAYLOAD=$(cat test-payload.json)

# Calculate signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

# Send request with signature
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/github-discord \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

**CRITICAL:** Use `-n` flag with echo to avoid adding newline, which would break signature.

### GitHub Actions Testing

**Trigger real GitHub webhook:**

```bash
# Export GitHub token
export GITHUB_TOKEN="ghp_..."

# Run trigger script
./tools/scripts/trigger-github-push-event.sh
```

**Advantage:** Tests real GitHub → n8n integration with authentic signatures.

### Execution Status Check

**Via n8n API:**
```bash
# Load credentials from .env
source ~/git/gSnake/gsnake-n8n/.env

export N8N_HOST="https://n8n.labs.lair.nntin.xyz"

COOKIE_FILE=$(mktemp)
curl -s -c "$COOKIE_FILE" -X POST "${N8N_HOST}/rest/login" \
  -H "Content-Type: application/json" \
  -d "{\"emailOrLdapLoginId\":\"$N8N_EMAIL\",\"password\":\"$N8N_PASSWORD\"}" > /dev/null

# Get recent executions
curl -s -b "$COOKIE_FILE" "${N8N_HOST}/rest/executions?workflowId=github-discord-notify&limit=5" | \
  jq '.data.results[] | {id, status, startedAt}'

rm -f "$COOKIE_FILE"
```

**Expected output:**
```json
{
  "id": "17",
  "status": "success",
  "startedAt": "2026-02-08T11:10:44.279Z"
}
```

---

## Debugging with Browser Automation

### Opening n8n UI

```bash
# Load credentials
source ~/git/gSnake/gsnake-n8n/.env

# Open in background (doesn't block terminal)
agent-browser open "https://n8n.labs.lair.nntin.xyz/" &

# Or run in background with task tracking
agent-browser open "https://n8n.labs.lair.nntin.xyz/"
# (runs in background automatically)
```

### Login Flow

```bash
# Load credentials from .env first
source ~/git/gSnake/gsnake-n8n/.env

# Take snapshot to see current page
agent-browser snapshot | head -20

# If login page, fill credentials
agent-browser fill @e1 "$N8N_EMAIL"
agent-browser fill @e2 "$N8N_PASSWORD"
agent-browser click @e3  # Sign in button

# Wait for page load
sleep 3
```

### Navigating to Workflow

```bash
# Direct URL to workflow
agent-browser open "https://n8n.labs.lair.nntin.xyz/workflow/github-discord-notify"

# Or navigate via UI
agent-browser snapshot | grep -i "workflow"  # Find workflow link
agent-browser click @eX  # Click the link
```

### Viewing Executions

```bash
# Click Executions tab
agent-browser snapshot | grep -i "executions"  # Find tab reference
agent-browser click @e7  # Executions tab (typical ref)

sleep 2

# View execution list
agent-browser snapshot | head -100

# Click on specific execution
agent-browser click @e23  # First execution (adjust ref)

# Open debug view
agent-browser snapshot | grep -i "debug"
agent-browser click @e46  # "Debug in editor" button
```

### Reading Error Messages

```bash
# After opening execution in debug mode
sleep 2
agent-browser snapshot | grep -i -A 10 "error"

# Look for:
# - "Output X item Error message [line Y]"
# - Node that failed (highlighted)
# - Error stack trace

# Common pattern for finding error:
agent-browser snapshot | tail -100 | grep -E "Error|error|failed"
```

### Activating Workflow

```bash
# Find Publish button
agent-browser snapshot | grep -i "publish"

# Click Publish
agent-browser click @e2  # Main Publish button

sleep 2

# Confirm in dialog
agent-browser snapshot | grep -A 10 "dialog"
agent-browser click @e65  # Publish button in dialog

sleep 3

# Close browser
agent-browser close
```

### Common Browser Patterns

```bash
# Pattern 1: Search for element
agent-browser snapshot | grep -i "keyword"

# Pattern 2: Interactive exploration
agent-browser snapshot -i  # Shows element references

# Pattern 3: Wait and retry
sleep 2 && agent-browser snapshot

# Pattern 4: Get last N lines (bottom of page)
agent-browser snapshot | tail -50

# Pattern 5: Get first N lines (top of page)
agent-browser snapshot | head -50
```

---

## Production Deployment Checklist

### Pre-Deployment

- [ ] **Workflow JSON created** in `tools/n8n-flows/`
- [ ] **Environment variables set** in `~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/.env`
  - [ ] `NODE_FUNCTION_ALLOW_BUILTIN` (if using crypto/fs/path)
  - [ ] `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (if using $env)
  - [ ] Workflow-specific variables (secrets, URLs)
- [ ] **Docker compose updated** to pass environment variables
- [ ] **Webhook node has `rawBody: true`** (if doing HMAC validation)
- [ ] **HMAC validation uses raw body** (not re-stringified JSON)
- [ ] **Local testing passed** (localhost bypass)
- [ ] **Signature testing passed** (production URL with HMAC)

### Deployment

```bash
# 1. Import workflow
cd ~/git/gSnake/gsnake-n8n
./tools/scripts/sync-workflows.sh import

# 2. Restart n8n if environment variables changed
cd ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n
docker compose down && docker compose up -d
sleep 8

# 3. Activate workflow via UI
source ~/git/gSnake/gsnake-n8n/.env
agent-browser open "https://n8n.labs.lair.nntin.xyz/workflow/WORKFLOW-ID"
# Login and click Publish

# 4. Verify activation
docker logs n8n --tail 20 | grep -i "activated"

# 5. Test webhook endpoint
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/YOUR-PATH \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
```

### Post-Deployment

- [ ] **Workflow activated** (visible in n8n UI, logs show "Activated workflow...")
- [ ] **Webhook endpoint responds** (200 OK, not 404)
- [ ] **End-to-end test passed** (real GitHub event → Discord notification)
- [ ] **Error handling tested** (invalid signature rejected, missing headers handled)
- [ ] **Execution history checked** (status: "success" in n8n UI)
- [ ] **Documentation updated**:
  - [ ] SOP frontmatter: `implementation_status: implemented`
  - [ ] SOP frontmatter: `last_updated` timestamp
  - [ ] CLAUDE.md: SOP mapping table status
  - [ ] FINDINGS.md: New learnings documented
- [ ] **Changes committed** to git
  - [ ] Workflow JSON
  - [ ] Environment config (document, don't commit .env!)
  - [ ] SOP updates
  - [ ] Sync script fixes (if any)

### Rollback Plan

```bash
# If workflow causes issues:

# 1. Deactivate in n8n UI
agent-browser open "https://n8n.labs.lair.nntin.xyz/workflow/WORKFLOW-ID"
# Click to deactivate

# 2. Or revert git changes
git log --oneline tools/n8n-flows/WORKFLOW-ID.json
git checkout PREVIOUS-COMMIT tools/n8n-flows/WORKFLOW-ID.json
./tools/scripts/sync-workflows.sh import

# 3. Or delete workflow entirely
# In n8n UI: Delete workflow
# In git: rm tools/n8n-flows/WORKFLOW-ID.json
```

---

## Quick Reference Commands

### Essential n8n Operations

```bash
# Restart n8n (with env changes)
cd ~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n
docker compose down && docker compose up -d

# Check environment variables
docker exec n8n env | grep -E "NODE_FUNCTION|N8N_BLOCK|N8N_WEBHOOK"

# View logs
docker logs n8n -f
docker logs n8n --tail 50 --since 5m

# Import workflows
cd ~/git/gSnake/gsnake-n8n
./tools/scripts/sync-workflows.sh import

# Export workflows
./tools/scripts/sync-workflows.sh export
```

### Debugging

```bash
# Open n8n UI
source ~/git/gSnake/gsnake-n8n/.env
agent-browser open "https://n8n.labs.lair.nntin.xyz/workflow/WORKFLOW-ID"

# Test webhook
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/PATH \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'

# Check recent executions
source ~/git/gSnake/gsnake-n8n/.env  # Load N8N_EMAIL and N8N_PASSWORD
# Use n8n API to query executions (see Testing Strategies section)
```

### File Locations

```bash
# n8n instance config
~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/docker-compose.yml
~/git/lair.nntin.xyz/projects/nntin-labs/services/n8n/.env

# Workflow files
~/git/gSnake/gsnake-n8n/tools/n8n-flows/

# SOPs
~/git/gSnake/gsnake-n8n/workflows/

# Sync script
~/git/gSnake/gsnake-n8n/tools/scripts/sync-workflows.sh
```

---

## Success Criteria

A workflow is considered **successfully implemented** when:

1. ✅ **Workflow JSON** exists in `tools/n8n-flows/` and is committed to git
2. ✅ **Environment variables** are configured in n8n service .env
3. ✅ **Imported and activated** in n8n instance
4. ✅ **Webhook endpoint** responds (if webhook workflow)
5. ✅ **End-to-end test passes** with real data
6. ✅ **Error handling works** (rejects invalid input, logs errors)
7. ✅ **Execution status is "success"** in n8n execution history
8. ✅ **Documentation updated** (SOP marked as implemented, CLAUDE.md updated)
9. ✅ **Changes committed** to git (workflow + docs)

**Example successful execution:**
```json
{
  "id": "17",
  "status": "success",
  "finished": true,
  "startedAt": "2026-02-08T11:10:44.279Z",
  "stoppedAt": "2026-02-08T11:10:44.786Z"
}
```

---

## Key Takeaways

1. **Environment variable access requires explicit enablement** - n8n v2.0+ blocks $env by default
2. **HMAC validation MUST use raw body** - JSON.stringify() will break signatures
3. **Webhook node needs `rawBody: true`** for signature validation
4. **Container restarts need `down && up`** to pick up .env changes
5. **Workflows import as inactive** - must activate via UI after import
6. **Use container name, not ID** in scripts - IDs change on restart
7. **Browser automation is essential** for debugging executions
8. **Test locally first** (localhost bypass), then with signatures
9. **Check execution history** in n8n UI for actual status
10. **Document everything** - future agents will thank you

---

## Related Resources

- **n8n Documentation**: https://docs.n8n.io/
- **n8n Security Environment Variables**: https://docs.n8n.io/hosting/configuration/environment-variables/security/
- **n8n v2.0 Breaking Changes**: https://docs.n8n.io/2-0-breaking-changes/
- **GitHub Webhook Validation**: https://docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries
- **WAT Framework**: See `CLAUDE.md` for architecture overview
- **Workflow Template**: `workflows/template.md`

---

**Last Updated**: 2026-02-08T11:30:00Z
**Session**: GitHub Discord Webhook Implementation
**Status**: ✅ Complete and Production-Ready
