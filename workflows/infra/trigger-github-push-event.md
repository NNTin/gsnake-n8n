---
implementation_status: not_started
tool_type: shell-script
tool_location: tools/scripts/trigger-github-push-event.sh
workflow_id: ""  # Not an n8n workflow
last_updated: "2026-02-07"
dependencies: []
tags: ["github", "workflow-dispatch", "testing", "automation"]
---

# Trigger GitHub Push Event

Shell script to trigger GitHub workflow dispatch on the test repository, used for testing GitHub App Push Event webhooks.

## Objective

**What**: Trigger a GitHub Actions workflow dispatch event on the NNTin/test repository

**Why**: To test GitHub App Push Event handling in n8n workflows without requiring manual commits

**When**: Use when you need to simulate a GitHub push event for testing webhook handlers

This provides a deterministic way to trigger GitHub webhooks for testing purposes by dispatching a workflow that creates a commit.

---

## Prerequisites

**Environment Variables**:
```bash
GITHUB_TOKEN="ghp_..."  # GitHub token with workflow dispatch and contents:write permissions
```

**External Dependencies**:
- curl (for API calls)
- jq (optional, for JSON processing and pretty output)
- GitHub repository: https://github.com/NNTin/test
- GitHub workflow: `.github/workflows/counter.yml` must exist in the repository

**Required Permissions**:
- GitHub token must have `workflow` scope (for workflow dispatch)
- The target workflow (`counter.yml`) must have `contents:write` permission

---

## Implementation Details

**Tool Type**: shell script

**Location**: `tools/scripts/trigger-github-push-event.sh`

**Key Technologies**: GitHub REST API v3, curl, bash

---

## Usage

### Trigger Workflow Dispatch

Triggers the counter.yml workflow which increments a counter and creates a commit (push event).

```bash
# Basic usage
./tools/scripts/trigger-github-push-event.sh

# With explicit ref (branch)
./tools/scripts/trigger-github-push-event.sh master
```

**Parameters:**
- `$1` (optional): Git ref (branch/tag) to run workflow on (default: `master`)

**When to use:**
- Testing GitHub webhook handlers in n8n
- Simulating push events for CI/CD testing
- Debugging GitHub App integrations

**What it does (step-by-step):**
1. Validates GITHUB_TOKEN environment variable is set
2. Sends workflow dispatch API request to GitHub
3. Reports success or failure based on HTTP response code

**Expected output:**
```
✓ Workflow dispatch triggered successfully
Workflow will run on ref: master
GitHub Actions: https://github.com/NNTin/test/actions
```

**Exit codes:**
- 0: Workflow dispatch triggered successfully
- 1: Missing GITHUB_TOKEN environment variable
- 2: GitHub API request failed (invalid token, workflow not found, etc.)

---

## Technical Specifications

### Input Format

**Environment Variables:**
```bash
GITHUB_TOKEN="ghp_..."
```

**Script Arguments:**
```bash
./trigger-github-push-event.sh [ref]
```

### Output Format

**Success Response:**
```
✓ Workflow dispatch triggered successfully
Workflow will run on ref: master
GitHub Actions: https://github.com/NNTin/test/actions
```

**Error Response:**
```
✗ Error: GITHUB_TOKEN not set
Set it in .env or export it manually
```

### API Details

**GitHub API Endpoint:**
```
POST https://api.github.com/repos/NNTin/test/actions/workflows/counter.yml/dispatches
```

**Request Headers:**
```
Authorization: Bearer ${GITHUB_TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

**Request Body:**
```json
{
  "ref": "master"
}
```

**Response:**
- Success: HTTP 204 No Content
- Error: HTTP 4xx/5xx with error details

---

## Security Considerations

**Authentication:**
- GitHub Personal Access Token (PAT) stored in `.env`
- Token transmitted via Authorization header (HTTPS only)

**Authorization:**
- Token must have `workflow` scope (for workflow dispatch)
- Access limited to NNTin/test repository

**Data Handling:**
- No sensitive data logged (token masked in output)
- API responses logged for debugging (non-sensitive only)

**Attack Surface:**
- Script executes locally (not a public endpoint)
- No rate limiting implemented (rely on GitHub's limits)
- Token exposure risk if .env is committed (protected by .gitignore)

---

## Testing

### Manual Testing

**Test Case 1: Happy Path**
```bash
# Setup
source .env

# Execute
./tools/scripts/trigger-github-push-event.sh

# Verify
# Expected: Success message, check https://github.com/NNTin/test/actions for workflow run
```

**Test Case 2: Missing Token**
```bash
# Execute
unset GITHUB_TOKEN
./tools/scripts/trigger-github-push-event.sh

# Verify
# Expected: Error message "GITHUB_TOKEN not set", exit code 1
```

**Test Case 3: Custom Branch**
```bash
# Execute
./tools/scripts/trigger-github-push-event.sh main

# Verify
# Expected: Workflow runs on 'main' branch instead of default 'master'
```

---

## Error Handling

### Error: GITHUB_TOKEN not set

**Symptom:** Script exits with error message before making API call

**Possible Causes:**
1. .env not sourced
2. GITHUB_TOKEN not exported
3. Variable name typo

**Resolution:**
```bash
# Source .env
source .env

# Or set inline
GITHUB_TOKEN="ghp_..." ./tools/scripts/trigger-github-push-event.sh
```

**Prevention:** Always source .env before running scripts

---

### Error: GitHub API returns 404

**Symptom:** API returns "Not Found" error

**Possible Causes:**
1. Workflow file path incorrect (counter.yml vs workflow_id)
2. Repository doesn't exist or is private without access
3. Token doesn't have access to repository

**Resolution:**
```bash
# Verify workflow exists
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/NNTin/test/actions/workflows

# Check token permissions
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/user

# Verify repository access
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/NNTin/test
```

**Prevention:** Ensure token has correct scopes and repository access

---

### Error: GitHub API returns 401 Unauthorized

**Symptom:** "Bad credentials" or "Requires authentication"

**Possible Causes:**
1. Token is invalid or expired
2. Token not properly formatted in Authorization header

**Resolution:**
```bash
# Regenerate token at https://github.com/settings/tokens
# Update .env with new token
# Verify token format (should start with ghp_)
echo $GITHUB_TOKEN | grep -E '^ghp_'
```

**Prevention:** Use tokens with appropriate expiration, rotate regularly

---

## Edge Cases

**Edge Case 1: Workflow already running**
- **Condition:** Script triggered while previous workflow still executing
- **Behavior:** GitHub queues the new workflow run (doesn't reject)
- **Rationale:** GitHub allows concurrent workflow runs by default

**Edge Case 2: Rate limiting**
- **Condition:** Too many API requests in short time
- **Behavior:** GitHub returns 403 with rate limit headers
- **Rationale:** GitHub API has rate limits (5000/hour for authenticated requests)

**Edge Case 3: Workflow disabled**
- **Condition:** counter.yml workflow is disabled in repository settings
- **Behavior:** API returns error (workflow not enabled)
- **Rationale:** Disabled workflows cannot be dispatched

---

## Performance Considerations

**Expected Load:**
- Manual execution (low frequency)
- Primarily for testing/debugging

**Timeouts:**
- API request timeout: 30 seconds (curl default)
- No retry strategy (fail fast for debugging)

**Rate Limiting:**
- GitHub API: 5000 requests/hour (authenticated)
- Workflow dispatch is not rate-limited separately
- No internal rate limiting implemented

---

## Monitoring & Logging

**What Gets Logged:**
- Script execution status (success/failure)
- API response codes (not full response bodies)
- Errors and diagnostics

**Log Location:**
```
stdout/stderr (no persistent logging)
GitHub Actions logs: https://github.com/NNTin/test/actions
```

**Log Format:**
```
[Action]: description
✓ Success message
✗ Error message
```

**Alerts/Notifications:**
- None (manual execution only)
- Check GitHub Actions UI for workflow execution status

---

## Common Workflows

### Workflow 1: First Time Setup

```bash
# 1. Verify prerequisites
cat .env | grep GITHUB_TOKEN

# 2. Make script executable
chmod +x ./tools/scripts/trigger-github-push-event.sh

# 3. Source environment
source .env

# 4. Test execution
./tools/scripts/trigger-github-push-event.sh

# 5. Verify on GitHub
# Open: https://github.com/NNTin/test/actions
```

### Workflow 2: Testing GitHub Webhook Integration

```bash
# 1. Trigger the workflow (creates push event)
./tools/scripts/trigger-github-push-event.sh

# 2. Monitor n8n for webhook receipt
# Check n8n execution logs or n8n UI

# 3. Verify payload processing
# Check Discord notifications or other downstream actions
```

### Workflow 3: Troubleshooting Failed Trigger

```bash
# 1. Verify token is set
echo "Token present: $([ -n "$GITHUB_TOKEN" ] && echo yes || echo no)"

# 2. Test API connectivity
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/NNTin/test

# 3. Check workflow exists
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/NNTin/test/actions/workflows

# 4. Run script with verbose output
bash -x ./tools/scripts/trigger-github-push-event.sh
```

---

## Integration Points

**Upstream Dependencies:**
- `.env` file provides GITHUB_TOKEN
- GitHub repository NNTin/test must exist with counter.yml workflow

**Downstream Consumers:**
- GitHub Actions workflow (counter.yml) executes
- Workflow creates commit → triggers GitHub push webhook
- n8n webhooks receive push event notifications

**Data Flow Diagram:**
```
[Script] → [GitHub API] → [Workflow Dispatch] → [counter.yml runs]
                                                       ↓
                                                  [Commit created]
                                                       ↓
                                                 [Push webhook]
                                                       ↓
                                              [n8n receives event]
```

---

## Rollback Procedure

If this script causes issues:

```bash
# 1. Stop any running workflows manually
# Visit: https://github.com/NNTin/test/actions
# Click on running workflow → Cancel workflow

# 2. No state to restore (script is stateless)

# 3. Fix any broken webhooks in n8n
# Deactivate problematic workflows in n8n UI
```

---

## Future Improvements

- [ ] TODO: Add retry logic with exponential backoff
- [ ] TODO: Poll for workflow run completion and report status
- [ ] TODO: Support triggering with custom inputs (if workflow updated)
- [ ] TODO: Add verbose mode (-v flag) for debugging
- [ ] TODO: Support multiple repositories/workflows via config file

---

## Related Documentation

- **GitHub API**: [Workflow Dispatch Documentation](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- **Test Repository**: https://github.com/NNTin/test
- **Workflow File**: https://github.com/NNTin/test/blob/master/.github/workflows/counter.yml
- **Related SOPs**:
  - `workflows/n8n-webhook/notify-discord.md` (consumes the push events)

---

## Changelog

**2026-02-07**: Initial creation

---

## Implementation Checklist

- [ ] Prerequisites met (GITHUB_TOKEN in .env)
- [ ] Tool created at `tools/scripts/trigger-github-push-event.sh`
- [ ] Script is executable (`chmod +x`)
- [ ] Manual testing completed (all test cases pass)
- [ ] Error handling tested (missing token, invalid API responses)
- [ ] Security review completed (token handling, no secrets logged)
- [ ] Logging configured (appropriate output messages)
- [ ] Documentation updated (this SOP + CLAUDE.md if needed)
- [ ] Committed to git (SOP + implementation)
- [ ] End-to-end test (trigger → workflow runs → push event → n8n receives)
- [ ] Update frontmatter: `implementation_status: implemented`
