---
implementation_status: deployed
tool_type: n8n-webhook
tool_location: tools/n8n-flows/github-discord-notify.json
workflow_id: github-discord-notify
last_updated: 2026-02-07T23:30:00Z
dependencies: []
tags: ["github", "discord", "webhook", "notification", "hmac", "security"]
notes: "Workflow created and deployed. Requires activation in n8n UI and testing with real GitHub webhooks."
---

# GitHub to Discord Notification Webhook

n8n webhook endpoint that receives GitHub events (push, pull_request) and forwards detailed notifications to Discord with HMAC signature validation.

## Objective

**What**: Secure webhook endpoint that receives GitHub App events and posts rich notifications to Discord.

**Why**: This enables:
- Real-time Discord notifications for GitHub repository activity
- Secure authentication using GitHub's X-Hub-Signature-256 HMAC
- Audit trail via payload logging
- Integration testing capability (manual trigger, MCP, real GitHub App)

**When**:
- Automatically triggered by GitHub App on `push` and `pull_request` events
- Manually triggered for testing (bypasses signature validation for localhost)
- Triggered via n8n MCP for programmatic testing

---

## Prerequisites

**Environment Variables** (required):
```bash
N8N_WEBHOOK_SECRET="your-github-webhook-secret"  # Shared secret for HMAC validation
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."  # Discord channel webhook
```

**External Dependencies**:
- n8n instance running and accessible from GitHub (public URL or ngrok tunnel)
- Discord webhook configured for target channel
- GitHub App configured with webhook pointing to n8n endpoint
- `.tmp/n8n-endpoint/github-discord/` directory exists (or workflow creates it)

**Required Permissions**:
- n8n instance must be publicly accessible (or use ngrok for testing)
- Write permissions to `.tmp/n8n-endpoint/github-discord/`
- Discord webhook URL must be valid and active

**GitHub App Setup**:
1. Create GitHub App in repository/organization settings
2. Configure webhook URL: `https://n8n.labs.lair.nntin.xyz/webhook/github-discord`
3. Set webhook secret (same as `N8N_WEBHOOK_SECRET`)
4. Subscribe to events: `push`, `pull_request`
5. Install app on target repositories

---

## Implementation Details

**Tool Type**: n8n workflow (webhook-triggered)

**Location**: `tools/n8n-flows/github-discord-notify.json`

**Key Technologies**:
- n8n Webhook node (n8n-nodes-base.webhook)
- n8n Code node (n8n-nodes-base.code) for HMAC validation
- n8n HTTP Request node for Discord webhook
- n8n Write File node for logging
- crypto (Node.js built-in) for HMAC-SHA256

**Webhook Path**: `/webhook/github-discord`

**Full URL**: `https://n8n.labs.lair.nntin.xyz/webhook/github-discord`

---

## Usage

### Automatic Trigger (GitHub App)

**No manual action required** - workflow executes automatically when GitHub sends events.

**When it triggers:**
- `push` event: Code pushed to repository
- `pull_request` event: PR opened, closed, synchronized, etc.

**Authentication**: GitHub signs payload with `X-Hub-Signature-256` header using shared secret.

---

### Manual Trigger (Testing)

For local testing without GitHub App:

```bash
curl -X POST http://localhost:5678/webhook/github-discord \
  -H "Content-Type: application/json" \
  -d '{
    "action": "opened",
    "repository": {
      "name": "test-repo",
      "html_url": "https://github.com/user/test-repo"
    },
    "sender": {
      "login": "testuser"
    },
    "pull_request": {
      "title": "Test PR",
      "html_url": "https://github.com/user/test-repo/pull/1"
    }
  }'
```

**Note**: Manual triggers from `localhost` bypass signature validation (allowed in workflow logic).

---

### MCP Trigger (Programmatic Testing)

Via n8n MCP server:

```javascript
// Execute workflow programmatically
execute_workflow({
  workflow_id: "github-discord-notify",
  input_data: {
    "action": "push",
    "repository": {...},
    "commits": [...]
  }
})
```

**Note**: MCP triggers also bypass signature validation (internal testing).

---

### Real GitHub App Trigger (Production)

**Setup:**
1. Configure GitHub App webhook with `N8N_WEBHOOK_SECRET`
2. Point webhook to `https://n8n.labs.lair.nntin.xyz/webhook/github-discord`
3. Perform a `push` or create/update a `pull_request`

**Expected behavior:**
1. GitHub signs payload with `X-Hub-Signature-256`
2. n8n receives webhook, validates signature
3. Payload logged to `.tmp/n8n-endpoint/github-discord/YYYY-MM-DD-HH-MM-SS.json`
4. Discord notification sent with rich details
5. HTTP 200 OK returned to GitHub

---

## Technical Specifications

### Input Format (GitHub Webhook Payload)

#### Push Event Payload

Full structure documented at: [GitHub Push Event](https://docs.github.com/webhooks/webhook-events-and-payloads#push)

**Key fields used:**
```json
{
  "ref": "refs/heads/main",
  "repository": {
    "name": "repo-name",
    "full_name": "owner/repo-name",
    "html_url": "https://github.com/owner/repo-name"
  },
  "pusher": {
    "name": "username",
    "email": "user@example.com"
  },
  "sender": {
    "login": "username",
    "html_url": "https://github.com/username"
  },
  "commits": [
    {
      "id": "commit-sha",
      "message": "Commit message",
      "url": "https://github.com/owner/repo/commit/sha",
      "author": {
        "name": "Author Name",
        "email": "author@example.com"
      },
      "timestamp": "2026-02-07T10:00:00Z"
    }
  ],
  "head_commit": {
    "id": "commit-sha",
    "message": "Most recent commit message"
  },
  "compare": "https://github.com/owner/repo/compare/sha1...sha2"
}
```

#### Pull Request Event Payload

Full structure documented at: [GitHub Pull Request Event](https://docs.github.com/webhooks/webhook-events-and-payloads#pull_request)

**Key fields used:**
```json
{
  "action": "opened | closed | synchronize | reopened",
  "number": 123,
  "pull_request": {
    "id": 123456,
    "number": 123,
    "state": "open | closed",
    "title": "PR title",
    "body": "PR description",
    "html_url": "https://github.com/owner/repo/pull/123",
    "user": {
      "login": "username",
      "html_url": "https://github.com/username"
    },
    "head": {
      "ref": "feature-branch",
      "sha": "commit-sha"
    },
    "base": {
      "ref": "main",
      "sha": "commit-sha"
    },
    "created_at": "2026-02-07T10:00:00Z",
    "updated_at": "2026-02-07T10:00:00Z",
    "merged": false,
    "mergeable": true,
    "draft": false
  },
  "repository": {
    "name": "repo-name",
    "full_name": "owner/repo-name",
    "html_url": "https://github.com/owner/repo-name"
  },
  "sender": {
    "login": "username",
    "html_url": "https://github.com/username"
  }
}
```

#### Headers (GitHub)

```
Content-Type: application/json
X-GitHub-Event: push | pull_request
X-Hub-Signature-256: sha256=<hmac-signature>
X-GitHub-Delivery: <unique-delivery-id>
User-Agent: GitHub-Hookshot/<version>
```

**Critical**: `X-Hub-Signature-256` must be validated for non-localhost requests.

---

### Output Format

#### Success Response (to GitHub)

```json
{
  "status": "success",
  "message": "Notification sent to Discord"
}
```

**HTTP Status**: `200 OK`

#### Error Response (Invalid Signature)

```json
{
  "status": "error",
  "message": "Invalid GitHub signature"
}
```

**HTTP Status**: `401 Unauthorized` or workflow throws error

#### Discord Notification Format

**Push Event:**
```
🚀 **New Push to `owner/repo-name`**

**Branch**: `main`
**Pusher**: [username](https://github.com/username)

**Commits** (3):
• [`abc1234`](https://github.com/owner/repo/commit/abc1234) - Commit message 1
• [`def5678`](https://github.com/owner/repo/commit/def5678) - Commit message 2
• [`ghi9012`](https://github.com/owner/repo/commit/ghi9012) - Commit message 3

[View Diff](https://github.com/owner/repo/compare/sha1...sha2)
```

**Pull Request Event (opened):**
```
📬 **Pull Request Opened in `owner/repo-name`**

**Title**: PR title
**Author**: [username](https://github.com/username)
**Branch**: `feature-branch` → `main`

**Description**:
PR description (first 200 chars)...

[View Pull Request](https://github.com/owner/repo/pull/123)
```

**Pull Request Event (merged):**
```
✅ **Pull Request Merged in `owner/repo-name`**

**Title**: PR title
**Merged by**: [username](https://github.com/username)
**Branch**: `feature-branch` → `main`

[View Pull Request](https://github.com/owner/repo/pull/123)
```

---

### n8n Workflow Structure

**Workflow ID**: `github-discord-notify`

**Nodes Required:**

#### 1. Webhook Trigger (n8n-nodes-base.webhook)
- **Path**: `github-discord`
- **Method**: POST
- **Authentication**: None (handled in next node)
- **Response**: Return data from last node
- **Options**:
  - Raw Body: true (needed for HMAC validation)
  - Response Headers: `Content-Type: application/json`

#### 2. Code Node: Validate Signature (n8n-nodes-base.code)
- **Purpose**: Validate GitHub `X-Hub-Signature-256` HMAC
- **Logic**:
  ```javascript
  const crypto = require('crypto');

  // Allow localhost/manual triggers (bypass signature check)
  const origin = $headers['host'] || '';
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

  if (isLocalhost) {
    console.log('Localhost request - skipping signature validation');
    return $input.all();
  }

  // Validate GitHub signature
  const secret = $env.N8N_WEBHOOK_SECRET;
  const signature = $headers['x-hub-signature-256'];
  const rawBody = $json; // Full payload

  if (!signature) {
    throw new Error('Missing X-Hub-Signature-256 header');
  }

  const hmac = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(rawBody))
    .digest('hex');

  const expected = `sha256=${hmac}`;

  if (signature !== expected) {
    throw new Error('Invalid GitHub signature');
  }

  console.log('Signature validated successfully');
  return $input.all();
  ```
- **On Error**: Workflow fails, returns error to GitHub

#### 3. Code Node: Extract Event Data (n8n-nodes-base.code)
- **Purpose**: Parse GitHub payload and prepare data for logging and Discord
- **Logic**:
  ```javascript
  const payload = $json;
  const eventType = $headers['x-github-event'];

  let eventData = {
    timestamp: new Date().toISOString(),
    event_type: eventType,
    delivery_id: $headers['x-github-delivery'],
    repository: payload.repository?.full_name,
    sender: payload.sender?.login,
    raw_payload: payload
  };

  // Extract event-specific data
  if (eventType === 'push') {
    eventData.branch = payload.ref?.replace('refs/heads/', '');
    eventData.commits = payload.commits?.length || 0;
    eventData.head_commit = payload.head_commit;
    eventData.compare_url = payload.compare;
  } else if (eventType === 'pull_request') {
    eventData.action = payload.action;
    eventData.pr_number = payload.pull_request?.number;
    eventData.pr_title = payload.pull_request?.title;
    eventData.pr_url = payload.pull_request?.html_url;
    eventData.pr_state = payload.pull_request?.state;
    eventData.pr_merged = payload.pull_request?.merged;
  }

  return eventData;
  ```

#### 4. Write File Node: Log Payload (n8n-nodes-base.writeFile)
- **Purpose**: Save full payload to disk for audit trail
- **File Path**: `.tmp/n8n-endpoint/github-discord/{{ $now.format('yyyy-MM-dd-HH-mm-ss') }}.json`
- **Content**: `{{ JSON.stringify($json, null, 2) }}`
- **Options**:
  - Create directory if not exists: true
  - Overwrite: false
- **On Error**: Log error but continue workflow (logging failure shouldn't block notification)

#### 5. Code Node: Format Discord Message (n8n-nodes-base.code)
- **Purpose**: Build rich Discord message based on event type
- **Logic**:
  ```javascript
  const data = $json;
  const eventType = data.event_type;

  let discordMessage = '';

  if (eventType === 'push') {
    const branch = data.branch;
    const commits = data.raw_payload.commits || [];
    const sender = data.raw_payload.sender;
    const repo = data.raw_payload.repository;

    discordMessage = `🚀 **New Push to \`${repo.full_name}\`**\n\n`;
    discordMessage += `**Branch**: \`${branch}\`\n`;
    discordMessage += `**Pusher**: [${sender.login}](${sender.html_url})\n\n`;

    if (commits.length > 0) {
      discordMessage += `**Commits** (${commits.length}):\n`;
      commits.slice(0, 5).forEach(commit => {
        const shortSha = commit.id.substring(0, 7);
        const message = commit.message.split('\n')[0]; // First line only
        discordMessage += `• [\`${shortSha}\`](${commit.url}) - ${message}\n`;
      });
      if (commits.length > 5) {
        discordMessage += `• ... and ${commits.length - 5} more commits\n`;
      }
    }

    if (data.compare_url) {
      discordMessage += `\n[View Diff](${data.compare_url})`;
    }

  } else if (eventType === 'pull_request') {
    const pr = data.raw_payload.pull_request;
    const action = data.action;
    const repo = data.raw_payload.repository;

    let emoji = '📬';
    if (action === 'closed' && pr.merged) {
      emoji = '✅';
      discordMessage = `${emoji} **Pull Request Merged in \`${repo.full_name}\`**\n\n`;
    } else if (action === 'closed') {
      emoji = '❌';
      discordMessage = `${emoji} **Pull Request Closed in \`${repo.full_name}\`**\n\n`;
    } else if (action === 'opened') {
      discordMessage = `${emoji} **Pull Request Opened in \`${repo.full_name}\`**\n\n`;
    } else {
      discordMessage = `${emoji} **Pull Request ${action} in \`${repo.full_name}\`**\n\n`;
    }

    discordMessage += `**Title**: ${pr.title}\n`;
    discordMessage += `**Author**: [${pr.user.login}](${pr.user.html_url})\n`;
    discordMessage += `**Branch**: \`${pr.head.ref}\` → \`${pr.base.ref}\`\n\n`;

    if (pr.body && pr.body.length > 0) {
      const description = pr.body.substring(0, 200);
      discordMessage += `**Description**:\n${description}${pr.body.length > 200 ? '...' : ''}\n\n`;
    }

    discordMessage += `[View Pull Request](${pr.html_url})`;
  }

  return { content: discordMessage };
  ```

#### 6. HTTP Request Node: Send to Discord (n8n-nodes-base.httpRequest)
- **Purpose**: POST formatted message to Discord webhook
- **Method**: POST
- **URL**: `{{ $env.DISCORD_WEBHOOK_URL }}`
- **Headers**:
  - `Content-Type: application/json`
- **Body**:
  ```json
  {
    "content": "{{ $json.content }}",
    "username": "GitHub Bot",
    "avatar_url": "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
  }
  ```
- **Options**:
  - Timeout: 10000ms
  - Retry on fail: false (let workflow fail)
- **On Error**: Workflow fails (error propagates to GitHub)

#### 7. Code Node: Format Response (n8n-nodes-base.code)
- **Purpose**: Send success response to GitHub
- **Logic**:
  ```javascript
  return {
    status: 'success',
    message: 'Notification sent to Discord',
    timestamp: new Date().toISOString()
  };
  ```

**Node Connections:**
```
Webhook Trigger
  → Validate Signature
  → Extract Event Data
  → Log Payload → Format Discord Message → Send to Discord → Format Response
       ↓ (on error)                ↓ (on error)
    Return 401              Return 500
```

**Credentials Needed:**
- None (uses environment variables)

---

## Security Considerations

**Authentication:**
- **HMAC Signature Validation**: Required for all non-localhost requests
  - Uses `X-Hub-Signature-256` header from GitHub
  - Shared secret stored in `N8N_WEBHOOK_SECRET` environment variable
  - SHA-256 HMAC computed over raw request body
  - Timing-safe comparison (use `crypto.timingSafeEqual` in production)
- **Localhost Bypass**: Manual triggers from localhost skip signature validation (for testing)
- **MCP Bypass**: MCP-triggered executions skip signature validation (internal testing)

**Authorization:**
- GitHub App controls which repositories can send events
- Only configured GitHub App can generate valid signatures
- Discord webhook URL is private (not exposed in workflow JSON)

**Data Handling:**
- **Sensitive data in payload**: Review GitHub events for exposed secrets (unlikely but possible)
- **Logging**: Full payloads logged to `.tmp/` (excluded from git via `.gitignore`)
- **Environment variables**:
  - `N8N_WEBHOOK_SECRET` - sensitive, must match GitHub App webhook secret
  - `DISCORD_WEBHOOK_URL` - sensitive, grants write access to Discord channel
  - Both stored in `.env` file (git-ignored)
- **Discord exposure**: Messages posted to Discord are visible to all channel members

**Attack Surface:**
- **Public endpoint**: `/webhook/github-discord` is publicly accessible
- **Rate limiting**: None currently (relies on n8n/GitHub rate limits)
  - Future: Consider rate limiting per sender IP
- **Input validation**:
  - HMAC signature validation prevents spoofed requests
  - Payload structure assumed to be valid GitHub format
  - No SQL injection risk (no database writes)
  - No XSS risk (Discord escapes content)
- **Replay attacks**: No timestamp validation (GitHub delivery IDs are unique but not checked)
  - Future: Consider checking delivery ID uniqueness

**Secrets Management:**
- `N8N_WEBHOOK_SECRET`:
  - Generate: `openssl rand -hex 32`
  - Store in `.env` and GitHub App webhook configuration
  - Never commit to git
  - Rotate if exposed
- `DISCORD_WEBHOOK_URL`:
  - Obtain from Discord channel settings (Integrations → Webhooks)
  - Store in `.env`
  - Regenerate in Discord if exposed

---

## Testing

### Manual Testing (Localhost - No Signature Validation)

**Test Case 1: Push Event**
```bash
curl -X POST http://localhost:5678/webhook/github-discord \
  -H "Content-Type: application/json" \
  -d '{
    "ref": "refs/heads/main",
    "repository": {
      "name": "test-repo",
      "full_name": "user/test-repo",
      "html_url": "https://github.com/user/test-repo"
    },
    "pusher": {
      "name": "testuser",
      "email": "test@example.com"
    },
    "sender": {
      "login": "testuser",
      "html_url": "https://github.com/testuser"
    },
    "commits": [
      {
        "id": "abc1234567890",
        "message": "Test commit",
        "url": "https://github.com/user/test-repo/commit/abc1234",
        "author": {
          "name": "Test User",
          "email": "test@example.com"
        }
      }
    ],
    "head_commit": {
      "id": "abc1234567890",
      "message": "Test commit"
    },
    "compare": "https://github.com/user/test-repo/compare/sha1...sha2"
  }'

# Verify:
# 1. Check Discord for push notification
# 2. Check .tmp/n8n-endpoint/github-discord/ for log file
# Expected: 200 OK, Discord message appears, log file created
```

**Test Case 2: Pull Request Opened**
```bash
curl -X POST http://localhost:5678/webhook/github-discord \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d '{
    "action": "opened",
    "number": 123,
    "pull_request": {
      "number": 123,
      "title": "Test PR",
      "body": "This is a test pull request",
      "html_url": "https://github.com/user/test-repo/pull/123",
      "state": "open",
      "user": {
        "login": "testuser",
        "html_url": "https://github.com/testuser"
      },
      "head": {
        "ref": "feature-branch",
        "sha": "abc123"
      },
      "base": {
        "ref": "main",
        "sha": "def456"
      }
    },
    "repository": {
      "name": "test-repo",
      "full_name": "user/test-repo",
      "html_url": "https://github.com/user/test-repo"
    },
    "sender": {
      "login": "testuser",
      "html_url": "https://github.com/testuser"
    }
  }'

# Expected: 200 OK, Discord shows "Pull Request Opened" message
```

**Test Case 3: Invalid Request (Missing Data)**
```bash
curl -X POST http://localhost:5678/webhook/github-discord \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected: Workflow may fail or send minimal Discord message
```

---

### Testing via MCP (Programmatic)

```javascript
// Via n8n MCP server
execute_workflow({
  workflow_id: "github-discord-notify",
  input_data: {
    "ref": "refs/heads/main",
    "repository": {
      "full_name": "user/test-repo",
      "html_url": "https://github.com/user/test-repo"
    },
    "commits": [...]
  }
})

// Expected: Workflow executes, Discord notification sent
```

---

### Testing with Real GitHub App (Production - Signature Validation)

**Setup:**
1. Create GitHub App with webhook pointing to `https://n8n.labs.lair.nntin.xyz/webhook/github-discord`
2. Set webhook secret to match `N8N_WEBHOOK_SECRET` in `.env`
3. Subscribe to `push` and `pull_request` events
4. Install app on test repository

**Test Case 4: Real Push Event**
```bash
# In test repository
echo "test" >> README.md
git add README.md
git commit -m "Test webhook trigger"
git push origin main

# Verify:
# 1. Check GitHub webhook delivery (Settings → GitHub Apps → Advanced → Recent Deliveries)
# 2. Check Discord for notification
# 3. Check .tmp/n8n-endpoint/github-discord/ for log
# Expected: GitHub shows 200 OK, Discord message appears, log created
```

**Test Case 5: Real Pull Request Event**
```bash
# In test repository
git checkout -b test-pr
echo "test" >> test.txt
git add test.txt
git commit -m "Test PR webhook"
git push origin test-pr

# On GitHub: Create pull request from test-pr to main

# Expected: Discord shows "Pull Request Opened" notification
```

**Test Case 6: Invalid Signature (Security Test)**
```bash
# Attempt to spoof GitHub request with wrong signature
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/github-discord \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  -d '{"test": "data"}'

# Expected: 401 Unauthorized or workflow error "Invalid GitHub signature"
```

**Test Case 7: Missing Signature**
```bash
# Attempt to send request without signature
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/github-discord \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Expected: Error "Missing X-Hub-Signature-256 header"
```

---

## Error Handling

### Error: Invalid GitHub Signature

**Symptom**: Workflow fails with "Invalid GitHub signature" error

**Possible Causes:**
1. `N8N_WEBHOOK_SECRET` doesn't match GitHub App webhook secret
2. Request body was modified in transit (proxy/CDN issue)
3. GitHub App webhook secret was recently changed
4. Spoofed request attempting to bypass authentication

**Resolution:**
```bash
# 1. Verify secret in .env matches GitHub App
cat .env | grep N8N_WEBHOOK_SECRET

# 2. Check GitHub App webhook configuration
# Go to GitHub App settings → Webhook → Secret

# 3. Update .env if needed
echo 'N8N_WEBHOOK_SECRET="correct-secret-here"' >> .env

# 4. Restart n8n to reload environment variables
docker restart <n8n-container-id>

# 5. Re-import workflow to pick up new env
cd gsnake-n8n
./tools/scripts/sync-workflows.sh import
```

**Prevention**: Never commit `.env` to git, use secure secret generation (`openssl rand -hex 32`).

---

### Error: Discord Webhook Failed

**Symptom**: Workflow fails at "Send to Discord" node

**Possible Causes:**
1. Invalid `DISCORD_WEBHOOK_URL` (deleted, regenerated, or malformed)
2. Discord API is down
3. Rate limit exceeded on Discord webhook
4. Network connectivity issue
5. Message content too large (> 2000 characters)

**Resolution:**
```bash
# 1. Verify Discord webhook URL is valid
curl -X POST $DISCORD_WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d '{"content": "Test message"}'

# Expected: 204 No Content or 200 OK

# 2. If invalid, regenerate in Discord
# Go to Discord channel → Settings → Integrations → Webhooks
# Delete old webhook, create new one

# 3. Update .env
echo 'DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."' >> .env

# 4. Restart n8n
docker restart <n8n-container-id>
```

**Prevention**: Store webhook URL securely, monitor Discord channel for delivery.

---

### Error: Log File Write Failed

**Symptom**: Logging node fails (workflow may continue or fail based on configuration)

**Possible Causes:**
1. Directory `.tmp/n8n-endpoint/github-discord/` doesn't exist
2. Insufficient permissions to write
3. Disk full

**Resolution:**
```bash
# 1. Create directory
mkdir -p .tmp/n8n-endpoint/github-discord/

# 2. Set permissions
chmod -R u+w .tmp/

# 3. Check disk space
df -h

# 4. Clean old logs if needed
find .tmp/n8n-endpoint/github-discord/ -mtime +30 -delete
```

**Prevention**: Ensure `.tmp/` exists and is writable, add log rotation.

---

### Error: Missing X-Hub-Signature-256 Header

**Symptom**: Workflow fails with "Missing X-Hub-Signature-256 header"

**Possible Causes:**
1. Request not from GitHub (manual curl from production URL)
2. GitHub App webhook not configured properly
3. GitHub bug (rare)

**Resolution:**
- If testing: Use localhost URL to bypass signature validation
- If production: Check GitHub App webhook configuration
- Verify GitHub is sending the header (check Recent Deliveries in GitHub App settings)

---

### Error: Workflow Timeout

**Symptom**: Workflow execution takes too long and times out

**Possible Causes:**
1. Discord API slow to respond
2. Network latency
3. Large payload (many commits)

**Resolution:**
- Check n8n workflow settings → Execution timeout
- Increase timeout if needed (default 120s should be sufficient)
- Optimize Discord message formatting (truncate commits if > 10)

---

## Edge Cases

**Edge Case 1: Push with 0 commits (force push)**
- **Condition**: `commits` array is empty
- **Behavior**: Discord message shows "0 commits"
- **Rationale**: Valid GitHub event, should still notify

**Edge Case 2: Pull Request draft**
- **Condition**: `pull_request.draft: true`
- **Behavior**: Notification sent same as regular PR
- **Rationale**: Draft PRs are still activity worth notifying
- **Future**: Consider filtering drafts or using different emoji

**Edge Case 3: Pull Request closed without merge**
- **Condition**: `action: "closed"` and `merged: false`
- **Behavior**: Uses ❌ emoji and "Pull Request Closed" message
- **Rationale**: Distinguish from successful merge (✅)

**Edge Case 4: Very long commit message**
- **Condition**: Commit message > 100 characters
- **Behavior**: Discord shows first line only (via `split('\n')[0]`)
- **Rationale**: Keep Discord message readable

**Edge Case 5: More than 5 commits in push**
- **Condition**: `commits.length > 5`
- **Behavior**: Show first 5 commits + "... and X more commits" summary
- **Rationale**: Prevent Discord message from being too long

**Edge Case 6: Pull Request body exceeds 200 characters**
- **Condition**: `pull_request.body.length > 200`
- **Behavior**: Truncate to 200 chars + "..."
- **Rationale**: Keep Discord message concise

**Edge Case 7: Localhost trigger with signature**
- **Condition**: Request from localhost but includes `X-Hub-Signature-256` header
- **Behavior**: Signature validation bypassed (localhost takes precedence)
- **Rationale**: Simplify local testing

**Edge Case 8: Unknown event type**
- **Condition**: `X-GitHub-Event` header is not "push" or "pull_request"
- **Behavior**: Workflow may fail or send generic message
- **Rationale**: Only subscribed to push/PR events
- **Future**: Add fallback for unknown events (log but don't notify)

**Edge Case 9: Simultaneous webhooks (race condition)**
- **Condition**: Multiple pushes/PRs trigger webhooks at same time
- **Behavior**: Each execution is independent, may create log files with same timestamp (seconds precision)
- **Rationale**: n8n handles concurrent executions
- **Future**: Add milliseconds to log filename for uniqueness

**Edge Case 10: GitHub App sends ping event**
- **Condition**: GitHub sends `ping` event when webhook is configured
- **Behavior**: Workflow may fail (ping payload structure differs)
- **Rationale**: Not subscribed to ping events in workflow logic
- **Future**: Handle ping event gracefully (return 200 OK, don't notify)

---

## Performance Considerations

**Expected Load:**
- ~10-50 webhook events per day (development repository)
- ~100-500 events per day (active production repository)
- Burst: Multiple commits in single push (up to 20 commits)

**Execution Time:**
- HMAC validation: < 10ms
- Logging: < 50ms
- Discord API call: 100-500ms
- **Total**: < 1 second per event

**Timeouts:**
- Webhook node: No timeout (waits for GitHub)
- Discord HTTP request: 10 seconds
- Total workflow timeout: 120 seconds (n8n default)

**Rate Limiting:**
- **GitHub**: No webhook rate limit (per repository)
- **Discord**: 30 requests per minute per webhook URL
  - If exceeded: Workflow fails, GitHub retries
  - Mitigation: Batch multiple commits into single Discord message (future improvement)
- **n8n**: No rate limit on workflow executions

**Optimization Opportunities:**
- Batch multiple commits into single Discord message (if Discord rate limit hit)
- Async logging (don't block workflow on log write failure)
- Caching for repeated payloads (unlikely to be useful)

---

## Monitoring & Logging

**What Gets Logged:**
- **File logs**: Full GitHub webhook payload (request body + headers metadata)
  - Location: `.tmp/n8n-endpoint/github-discord/YYYY-MM-DD-HH-MM-SS.json`
  - Format: Pretty-printed JSON
  - Retention: Manual cleanup (recommend 30 days)
  - Contents:
    ```json
    {
      "timestamp": "2026-02-07T10:00:00.000Z",
      "event_type": "push",
      "delivery_id": "12345-67890-abcdef",
      "repository": "owner/repo-name",
      "sender": "username",
      "branch": "main",
      "commits": 3,
      "raw_payload": { /* full GitHub payload */ }
    }
    ```
- **n8n execution logs**: Workflow execution history (visible in n8n UI)
  - Success/failure status
  - Execution time
  - Node-by-node data flow
- **Discord**: Notification message (visible in Discord channel)
- **GitHub webhook delivery logs**: Available in GitHub App settings

**Log Rotation:**
```bash
# Manual cleanup (run periodically)
find .tmp/n8n-endpoint/github-discord/ -name "*.json" -mtime +30 -delete

# Future: Automate with cron or n8n scheduled workflow
```

**Alerts/Notifications:**
- **Workflow failure**: None currently (GitHub shows failed delivery)
  - Future: Send Discord alert on workflow failure
- **Discord delivery failure**: Workflow fails, GitHub retries
- **Invalid signature**: Workflow fails, logged in n8n

**Monitoring Checklist:**
1. Check Discord channel regularly for notifications
2. Review GitHub webhook delivery logs weekly (Settings → GitHub Apps → Advanced)
3. Check `.tmp/n8n-endpoint/github-discord/` for log files
4. Review n8n execution history for failures

---

## Common Workflows

### Workflow 1: Initial Setup and Testing

```bash
# 1. Ensure environment variables are set
cat .env | grep -E "N8N_WEBHOOK_SECRET|DISCORD_WEBHOOK_URL"

# 2. Create log directory
mkdir -p .tmp/n8n-endpoint/github-discord/

# 3. Create workflow JSON (following template structure)
# (This step will be done after this SOP is written)

# 4. Import workflow to n8n
./tools/scripts/sync-workflows.sh import

# 5. Test manually (localhost)
curl -X POST http://localhost:5678/webhook/github-discord \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -d @test-fixtures/github-push-event.json

# 6. Verify Discord message appears

# 7. Test with real GitHub App
# (Create GitHub App, configure webhook, push to test repo)

# 8. Verify signature validation works
# Check GitHub webhook delivery logs for 200 OK

# 9. Mark SOP as implemented
# Update frontmatter: implementation_status: implemented
```

---

### Workflow 2: Update Discord Message Format

```bash
# 1. Export current workflow
./tools/scripts/sync-workflows.sh export

# 2. Edit workflow JSON
# Update "Format Discord Message" Code node logic

# 3. Import updated workflow
./tools/scripts/sync-workflows.sh import

# 4. Test with manual trigger
curl -X POST http://localhost:5678/webhook/github-discord \
  -H "Content-Type: application/json" \
  -d @test-fixtures/github-push-event.json

# 5. Verify new format in Discord

# 6. Commit changes
git add tools/n8n-flows/github-discord-notify.json
git commit -m "feat: improve Discord notification format"
```

---

### Workflow 3: Troubleshoot Failed Webhook

```bash
# Scenario: GitHub shows webhook delivery failed

# 1. Check GitHub webhook delivery details
# Go to GitHub App → Advanced → Recent Deliveries
# Click on failed delivery to see response

# 2. Check n8n execution logs
# Open https://n8n.labs.lair.nntin.xyz/
# Navigate to Executions tab
# Find failed execution for timestamp

# 3. Check error message
# Common errors:
#   - "Invalid GitHub signature" → Secret mismatch
#   - "Discord webhook failed" → Invalid Discord URL
#   - "Missing X-Hub-Signature-256" → GitHub App misconfigured

# 4. Fix issue (see Error Handling section)

# 5. Use GitHub "Redeliver" button to retry webhook
# Or make new push/PR to test
```

---

### Workflow 4: Rotate Webhook Secret

```bash
# Scenario: Security incident, need to rotate N8N_WEBHOOK_SECRET

# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update .env
sed -i "s/N8N_WEBHOOK_SECRET=.*/N8N_WEBHOOK_SECRET=\"$NEW_SECRET\"/" .env

# 3. Update GitHub App webhook secret
# Go to GitHub App settings → Webhook → Secret
# Paste new secret

# 4. Restart n8n to reload .env
docker restart <n8n-container-id>

# 5. Test webhook
# Make a push to test repository
# Verify GitHub shows 200 OK

# 6. Document rotation in changelog
echo "$(date): Rotated N8N_WEBHOOK_SECRET" >> .tmp/security-log.txt
```

---

### Workflow 5: Add Support for New Event Type

```bash
# Scenario: Want to add "issues" event notifications

# 1. Update GitHub App webhook subscriptions
# Go to GitHub App settings → Permissions & events
# Subscribe to "Issues" events

# 2. Export workflow
./tools/scripts/sync-workflows.sh export

# 3. Edit workflow JSON
# Update "Extract Event Data" node to handle "issues" event
# Update "Format Discord Message" node to format issues notifications

# 4. Import updated workflow
./tools/scripts/sync-workflows.sh import

# 5. Test by creating issue in test repository

# 6. Update this SOP documentation
# Add "issues" to event types, update payload documentation

# 7. Commit changes
git add workflows/ tools/n8n-flows/
git commit -m "feat: add support for GitHub issues events"
```

---

## Integration Points

**Upstream Dependencies:**
- **GitHub App** sends webhook events → this workflow
- **GitHub repository** activity (push, PR) triggers GitHub App
- **n8n instance** must be publicly accessible for GitHub to reach webhook

**Downstream Consumers:**
- This workflow → **Discord channel** (posts notifications)
- This workflow → **File system** (writes logs to `.tmp/`)

**Data Flow Diagram:**
```
GitHub Repository (push/PR activity)
    ↓
GitHub App (webhook configured)
    ↓ [HTTPS POST with X-Hub-Signature-256]
n8n Webhook (/webhook/github-discord)
    ↓
Validate HMAC Signature
    ↓
Extract Event Data
    ↓                          ↓
Log to File System      Format Discord Message
(.tmp/...)                     ↓
                     POST to Discord Webhook
                               ↓
                      Discord Channel (notification visible)
```

**External Services:**
- **GitHub API**: Webhook delivery
- **Discord API**: Webhook message posting
- **n8n Instance**: Workflow execution engine

---

## Rollback Procedure

If this workflow causes issues:

```bash
# 1. Disable GitHub App webhook (stop new events)
# Go to GitHub App settings → Webhook
# Uncheck "Active" checkbox

# 2. Deactivate n8n workflow
# Option A: In n8n UI, toggle workflow to inactive
# Option B: Update JSON and reimport
cat tools/n8n-flows/github-discord-notify.json | \
  jq '.active = false' > /tmp/temp.json
mv /tmp/temp.json tools/n8n-flows/github-discord-notify.json
./tools/scripts/sync-workflows.sh import

# 3. If workflow is fundamentally broken, delete it
# In n8n UI: Delete workflow
# Or export without this workflow, remove JSON from git

# 4. Clean up logs if needed
rm -rf .tmp/n8n-endpoint/github-discord/

# 5. Revert to previous version in git (if needed)
git log --oneline tools/n8n-flows/github-discord-notify.json
git checkout <previous-commit> tools/n8n-flows/github-discord-notify.json
./tools/scripts/sync-workflows.sh import

# 6. Re-enable GitHub App webhook when fixed
# Go to GitHub App settings → Webhook
# Check "Active" checkbox
```

---

## Future Improvements

- [ ] Add support for additional GitHub event types (issues, releases, deployments)
- [ ] Implement Discord webhook rate limit handling (batch messages)
- [ ] Add replay attack protection (check `X-GitHub-Delivery` uniqueness)
- [ ] Use `crypto.timingSafeEqual` for HMAC comparison (timing attack prevention)
- [ ] Add log rotation (delete logs older than 30 days automatically)
- [ ] Send Discord alert when workflow fails (meta-notification)
- [ ] Add workflow execution metrics (count events per day, average execution time)
- [ ] Support multiple Discord channels (route different events to different channels)
- [ ] Add filtering options (e.g., only notify for main branch pushes)
- [ ] Implement GitHub App ping event handling (return 200 OK without notification)
- [ ] Add emoji customization (configurable via environment variables)
- [ ] Support Discord embeds for richer formatting (vs plain text messages)
- [ ] Add unit tests for HMAC validation logic
- [ ] Create test fixtures for all supported event types
- [ ] Monitor Discord message delivery (webhook response codes)

---

## Related Documentation

- **GitHub Webhook Documentation**: [GitHub Webhooks](https://docs.github.com/webhooks)
  - [Push Event Payload](https://docs.github.com/webhooks/webhook-events-and-payloads#push)
  - [Pull Request Event Payload](https://docs.github.com/webhooks/webhook-events-and-payloads#pull_request)
  - [Securing Webhooks](https://docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries)
- **Discord Webhook Documentation**: [Discord Webhooks Guide](https://discord.com/developers/docs/resources/webhook)
- **n8n Documentation**:
  - [Webhook Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
  - [HTTP Request Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
  - [Code Node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/)
- **Related SOPs**:
  - `workflows/infra/n8n-sync.md` - How to import/export this workflow
  - `workflows/template.md` - Template used to create this SOP
- **WAT Framework**: `gsnake-n8n/CLAUDE.md` - Overall architecture

---

## Changelog

**2026-02-07 23:30 UTC**: Workflow implemented and deployed
- Created n8n workflow JSON with all 7 nodes as specified
- Implemented HMAC signature validation with localhost bypass
- Implemented Discord message formatting for push and pull_request events
- Deployed to n8n instance via sync-workflows.sh import
- Status: Deployed, awaiting activation and testing

**2026-02-07**: Initial SOP creation following template.md structure

---

## Implementation Checklist

- [ ] Prerequisites met (environment variables set, Discord webhook created, GitHub App configured)
- [ ] Tool created at `tools/n8n-flows/github-discord-notify.json`
- [ ] Manual testing completed (localhost trigger works)
- [ ] MCP testing completed (programmatic trigger works)
- [ ] Real GitHub App testing completed (signature validation works)
- [ ] Error handling tested (invalid signature rejected, missing headers handled)
- [ ] Security review completed (HMAC validation, secret storage)
- [ ] Logging verified (payload written to `.tmp/`)
- [ ] Discord notification verified (message format correct)
- [ ] Documentation updated (this SOP + CLAUDE.md SOP mapping table)
- [ ] Committed to git (SOP + workflow JSON)
- [ ] Deployed to production n8n
- [ ] End-to-end test with real GitHub activity
- [ ] Update frontmatter: `implementation_status: implemented`
- [ ] Update `last_updated` timestamp
