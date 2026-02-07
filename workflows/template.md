---
implementation_status: not_started  # Options: not_started | in_progress | implemented
tool_type: ""                       # Options: shell-script | n8n-node (single node definition) | n8n-webhook (full n8n flow with webhook as starting point)
tool_location: ""                   # Path in tools/ where implemented (e.g., "tools/n8n-flows/workflow-id.json" or "tools/scripts/my-script.sh")
workflow_id: ""                     # For n8n workflows: the workflow ID used in JSON
last_updated: ""                    # ISO 8601 timestamp (YYYY-MM-DD)
dependencies: []                    # List of other SOPs or tools this depends on
tags: []                            # Keywords for categorization (e.g., ["github", "webhook", "notification"])
---

# [SOP Title]

Brief 1-2 sentence description of what this SOP accomplishes.

## Objective

Clearly state:
- **What** this workflow/tool does (the capability it provides)
- **Why** it exists (the problem it solves)
- **When** to use it (trigger conditions or use cases)

Example:
```
Synchronize n8n workflow JSON files between git and the self-hosted n8n instance.

This ensures:
- Git is the source of truth for workflow definitions
- Manual changes in n8n UI can be captured back to git
- Workflows can be deployed consistently across environments
```

---

## Prerequisites

List everything required before this can be implemented or executed:

**Environment Variables** (if any):
```bash
REQUIRED_ENV_VAR="description of what this is"
OPTIONAL_ENV_VAR="default value or description"
```

**External Dependencies** (if any):
- Service X must be running (e.g., "n8n instance at https://n8n.labs.lair.nntin.xyz")
- Credential Y must exist (e.g., "GitHub API token in n8n credentials as 'github_token'")
- Tool Z must be installed (e.g., "jq, curl, docker CLI")

**Required Permissions** (if any):
- Access to X
- Write permissions to Y

---

## Implementation Details

**Tool Type**: [n8n workflow | shell script | API endpoint | hybrid]

**Location**: `[exact path in tools/]`

**Key Technologies**: [List the underlying tech: n8n CLI, bash, curl, webhook, etc.]

---

## Usage

### [Primary Command/Action Name]

Brief description of what this command does.

```bash
# Command syntax
./tools/scripts/my-script.sh [options]
```

**Parameters:**
- `--param1`: Description of parameter (required/optional)
- `--param2`: Description of parameter (required/optional)

**When to use:**
- Scenario 1
- Scenario 2

**What it does (step-by-step):**
1. Step one explained
2. Step two explained
3. Step three explained

**Expected output:**
```
Example output shown here
```

**Exit codes:**
- 0: Success
- 1: Failure reason A
- 2: Failure reason B

---

### [Additional Command/Action if applicable]

[Repeat structure above for each command/action]

---

## Technical Specifications

### Input Format

Define the exact structure of inputs:

**For API/Webhook:**
```json
{
  "field1": "type and description",
  "field2": {
    "nested": "structure if complex"
  }
}
```

**For Scripts:**
- Argument format
- File input format
- Environment variables used

### Output Format

Define the exact structure of outputs:

**Success Response:**
```json
{
  "status": "success",
  "result": {
    "field": "value"
  }
}
```

**Error Response:**
```json
{
  "status": "error",
  "code": "ERROR_CODE",
  "message": "Human-readable error"
}
```

### n8n Workflow Structure (if applicable)

**Workflow ID**: `workflow-unique-id`

**Nodes Required:**
1. **Webhook Trigger** (n8n-nodes-base.webhook)
   - Path: `/webhook/path`
   - Authentication: HMAC signature validation

2. **Code Node** (n8n-nodes-base.code)
   - Purpose: Validate signature
   - Logic: [Describe what it does]

3. **[Other Node Type]**
   - Purpose: [What it does]
   - Configuration: [Key settings]

**Node Connections:**
```
Webhook → Code (validate) → [Next Node] → [Final Node]
                ↓ (on error)
             Error Handler
```

**Credentials Needed:**
- `credential_name` (Type: API Key / OAuth / etc.)
  - Used in: Node X
  - Permissions needed: Read/Write/etc.

---

## Security Considerations

**Authentication:**
- How requests are authenticated (API key, HMAC, OAuth, etc.)
- Where secrets are stored (.env, n8n credentials, etc.)

**Authorization:**
- Who/what can access this
- How access is controlled

**Data Handling:**
- What sensitive data is processed
- Where it's logged (if at all)
- Retention policy

**Attack Surface:**
- Public endpoints vs internal
- Rate limiting needs
- Input validation requirements

---

## Testing

### Manual Testing

**Test Case 1: [Happy Path]**
```bash
# Setup
export TEST_VAR="value"

# Execute
./tools/scripts/script.sh --param value

# Verify
# Expected: [What you should see]
```

**Test Case 2: [Error Condition]**
```bash
# Execute
./tools/scripts/script.sh --invalid

# Verify
# Expected: Error message X, exit code 1
```

### Automated Testing (if applicable)

```bash
# Run test suite
./tests/test-my-workflow.sh
```

### Testing via n8n UI (if applicable)

1. Navigate to `https://n8n.labs.lair.nntin.xyz/workflow/[workflow-id]`
2. Click "Test Workflow"
3. Provide test input: `{...}`
4. Expected result: `{...}`

---

## Error Handling

### Error: [Specific Error Name/Code]

**Symptom:** What you see when this occurs

**Possible Causes:**
1. Cause A
2. Cause B

**Resolution:**
```bash
# Steps to fix
step 1
step 2
```

**Prevention:** How to avoid this error in the future

---

### Error: [Another Error]

[Repeat structure above for each known error]

---

## Edge Cases

Document unusual scenarios and how they're handled:

**Edge Case 1: [Description]**
- **Condition:** When X happens
- **Behavior:** System does Y
- **Rationale:** Because Z

**Edge Case 2: [Description]**
- **Condition:** When X happens
- **Behavior:** System does Y
- **Rationale:** Because Z

---

## Performance Considerations

**Expected Load:**
- Requests per minute/hour
- Data volume processed

**Timeouts:**
- Operation timeout: X seconds
- Retry strategy: Y

**Rate Limiting:**
- Internal limits: X per minute
- External API limits: Y per hour
- Backoff strategy: [Description]

---

## Monitoring & Logging

**What Gets Logged:**
- Request/response data (specify what's included/excluded)
- Errors and stack traces
- Performance metrics

**Log Location:**
```
./logs/my-workflow-YYYY-MM-DD.log
.tmp/n8n-endpoint/my-workflow-YYYY-MM-DD-HH-MM-SS.json
```

**Log Format:**
```json
{
  "timestamp": "ISO 8601",
  "level": "INFO|WARN|ERROR",
  "message": "Human-readable message",
  "context": {
    "additional": "data"
  }
}
```

**Alerts/Notifications:**
- Error conditions that trigger alerts
- Where alerts go (Discord, email, etc.)

---

## Common Workflows

### Workflow 1: [Name - e.g., "First Time Setup"]

```bash
# Step-by-step commands with explanations
# 1. Do this first
command1

# 2. Then do this
command2

# 3. Verify it worked
command3
```

### Workflow 2: [Name - e.g., "Update Existing Configuration"]

```bash
# Complete workflow for this scenario
```

### Workflow 3: [Name - e.g., "Troubleshooting Failed Execution"]

```bash
# Debug workflow
```

---

## Integration Points

**Upstream Dependencies:**
- Service/tool A provides data → this workflow
- Trigger X causes → this workflow to execute

**Downstream Consumers:**
- This workflow → triggers service/tool B
- This workflow → updates resource C

**Data Flow Diagram:**
```
[Source] → [This SOP] → [Destination]
             ↓
        [Side Effect]
```

---

## Rollback Procedure

If this workflow/tool causes issues, how to revert:

```bash
# 1. Stop the workflow
command to deactivate

# 2. Restore previous state
command to rollback

# 3. Verify rollback
command to verify
```

---

## Future Improvements

Known limitations and planned enhancements:

- [ ] TODO: Improvement 1
- [ ] TODO: Improvement 2
- [ ] TODO: Optimization opportunity 3

---

## Related Documentation

- **Architecture Decision**: `[link to ADR if exists]`
- **Test Results**: `[link to test findings]`
- **Related SOPs**:
  - `workflows/path/to/related-sop.md`
  - `workflows/path/to/another-sop.md`
- **External References**:
  - [n8n Documentation](https://docs.n8n.io/)
  - [GitHub Webhooks](https://docs.github.com/webhooks)

---

## Changelog

Track major changes to this SOP:

**YYYY-MM-DD**: Initial creation
**YYYY-MM-DD**: Added error handling for case X
**YYYY-MM-DD**: Updated to use new API version

---

## Implementation Checklist

Use this when implementing a new SOP:

- [ ] Prerequisites met (env vars, dependencies, credentials)
- [ ] Tool created at location specified in frontmatter
- [ ] Manual testing completed (all test cases pass)
- [ ] Error handling tested (all error conditions verified)
- [ ] Security review completed
- [ ] Logging/monitoring configured
- [ ] Documentation updated (this SOP + CLAUDE.md)
- [ ] Committed to git (SOP + implementation)
- [ ] Deployed to target environment
- [ ] End-to-end test in production
- [ ] Update frontmatter: `implementation_status: implemented`
