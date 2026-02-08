---
implementation_status: implemented
tool_type: n8n-workflow
tool_location: tools/n8n-flows/github-ci-dispatch-result.json
workflow_id: github-ci-dispatch-result
last_updated: "2026-02-08T17:00:00Z"
dependencies:
  - workflows/infra/n8n-sync.md
  - .github/workflows/ci.yml
tags: ["github", "ci", "workflow-dispatch", "n8n-workflow", "polling"]
---

# Dispatch GitHub CI And Capture Result

Internal n8n workflow that is executed by another n8n workflow, dispatches `.github/workflows/ci.yml`, waits for the matching GitHub Actions run to finish, and returns a structured success/failure result.

## Objective

**What**: Execute GitHub Actions CI (`.github/workflows/ci.yml`) via `workflow_dispatch`, then capture the final run conclusion.

**Why**: Upstream orchestration workflows need a deterministic machine-readable CI outcome (`success` vs non-success) to make follow-up decisions (deploy, notify, retry, rollback).

**When**: Use when a parent n8n workflow needs to trigger CI on demand and block until completion outcome is known.

This SOP defines a strict contract (input schema, output schema, polling algorithm, error taxonomy) so implementation behavior is unambiguous.

---

## Prerequisites

**Environment Variables** (optional):
```bash
GITHUB_API_BASE_URL="https://api.github.com"  # Optional override for GitHub Enterprise; default is api.github.com
```

**External Dependencies** (required):
- n8n instance running with support for internal workflow execution.
- GitHub repository `NNTin/gSnake` with workflow file `.github/workflows/ci.yml` committed on the default branch.
- GitHub token available in n8n Credential Manager (recommended), with rights to dispatch and read Actions runs.

**Credential Requirement (required)**:
- n8n credential name: `github_actions_token`
- Credential type: Header Auth or HTTP Bearer Auth
- Header value: `Authorization: Bearer <token>`

**Required Token Permissions**:
- Classic PAT: `repo` and `workflow`
- Fine-grained token (repository-scoped):
  - Actions: Read and write
  - Contents: Read
  - Metadata: Read

**Required Permissions** (runtime):
- Parent workflow can execute child workflows (`Execute Workflow` node).
- Outbound HTTPS from n8n to GitHub API.

---

## Implementation Details

**Tool Type**: n8n workflow (triggered by another n8n workflow)

**Location**: `tools/n8n-flows/github-ci-dispatch-result.json`

**Key Technologies**:
- n8n `Execute Workflow Trigger` ("When executed by another workflow")
- n8n `HTTP Request` nodes for GitHub REST API
- n8n `Wait` + loop control for polling
- n8n `Code` node for candidate selection and output normalization
- GitHub REST API v3 (version header `2022-11-28`)

---

## Usage

### Execute From Parent Workflow

Parent workflow calls this child workflow via n8n `Execute Workflow` node and waits for completion.

**Parent node requirements:**
- Workflow: `github-ci-dispatch-result`
- Wait for completion: `true`
- Input mode: JSON item payload (single item only)

**Input payload example:**
```json
{
  "repo_owner": "NNTin",
  "repo_name": "gSnake",
  "ref": "main",
  "timeout_seconds": 1800,
  "poll_interval_seconds": 15,
  "request_id": "ci-dispatch-2026-02-08T12:00:00Z"
}
```

**Parameters:**
- `repo_owner` (optional, default `NNTin`): GitHub repository owner.
- `repo_name` (optional, default `gSnake`): GitHub repository name.
- `ref` (optional, default `main`): Branch or tag for `workflow_dispatch`.
- `timeout_seconds` (optional, default `1800`, min `60`, max `7200`): End-to-end timeout.
- `poll_interval_seconds` (optional, default `15`, min `5`, max `60`): Poll cadence.
- `request_id` (optional): Correlation ID passed through to output/logs.

**When to use:**
- Orchestrating CI as a gated step in n8n automation.
- Centralizing CI trigger logic in one reusable child workflow.

**What it does (step-by-step):**
1. Validates and normalizes input parameters.
2. Fetches baseline workflow runs for `.github/workflows/ci.yml` (event `workflow_dispatch`, target branch).
3. Sends GitHub workflow dispatch request for `ci.yml` and target `ref`.
4. Polls workflow runs until it discovers exactly one new candidate run created after dispatch.
5. Polls the matched run until `status=completed` or timeout.
6. Returns structured output:
   - `status=completed`, `ci_success=true` when conclusion is `success`.
   - `status=completed`, `ci_success=false` when conclusion is non-success.
   - `status=error` for technical failures (dispatch, auth, timeout, ambiguity, API errors).

**Expected output (CI success):**
```json
{
  "status": "completed",
  "ci_success": true,
  "conclusion": "success",
  "workflow": {
    "owner": "NNTin",
    "repo": "gSnake",
    "path": ".github/workflows/ci.yml",
    "ref": "main"
  },
  "run": {
    "id": 123456789,
    "html_url": "https://github.com/NNTin/gSnake/actions/runs/123456789",
    "event": "workflow_dispatch",
    "status": "completed",
    "conclusion": "success",
    "head_branch": "main",
    "head_sha": "abc123...",
    "created_at": "2026-02-08T12:00:30Z",
    "run_started_at": "2026-02-08T12:00:35Z",
    "updated_at": "2026-02-08T12:03:10Z"
  },
  "polling": {
    "timeout_seconds": 1800,
    "poll_interval_seconds": 15,
    "api_calls": 18
  },
  "request_id": "ci-dispatch-2026-02-08T12:00:00Z"
}
```

**Expected output (CI failed but captured correctly):**
```json
{
  "status": "completed",
  "ci_success": false,
  "conclusion": "failure",
  "run": {
    "id": 123456790,
    "html_url": "https://github.com/NNTin/gSnake/actions/runs/123456790"
  },
  "request_id": "ci-dispatch-2026-02-08T12:05:00Z"
}
```

**Expected output (technical error):**
```json
{
  "status": "error",
  "error_code": "RUN_NOT_FOUND",
  "message": "Dispatch accepted but no matching workflow_dispatch run was discovered before timeout.",
  "retryable": true,
  "context": {
    "owner": "NNTin",
    "repo": "gSnake",
    "ref": "main",
    "timeout_seconds": 1800
  },
  "request_id": "ci-dispatch-2026-02-08T12:10:00Z"
}
```

---

## Technical Specifications

### Input Format

**Input contract (single JSON item):**
```json
{
  "repo_owner": "string (optional, default: NNTin)",
  "repo_name": "string (optional, default: gSnake)",
  "ref": "string (optional, default: main)",
  "timeout_seconds": "number (optional, default: 1800, range: 60..7200)",
  "poll_interval_seconds": "number (optional, default: 15, range: 5..60)",
  "request_id": "string (optional)"
}
```

**Validation rules:**
- Exactly one input item must be processed; multiple items are rejected with `INVALID_INPUT`.
- `ref` must be non-empty.
- `timeout_seconds` and `poll_interval_seconds` must be integers within allowed ranges.
- Workflow path is fixed to `.github/workflows/ci.yml` (not caller-configurable in V1).

### Output Format

**Completion output (`status=completed`)**:
- Returned for both successful and failed CI conclusions.
- CI outcome is represented by `ci_success` and `conclusion`.

```json
{
  "status": "completed",
  "ci_success": "boolean",
  "conclusion": "success | failure | cancelled | timed_out | neutral | action_required | skipped | stale | startup_failure",
  "workflow": {
    "owner": "string",
    "repo": "string",
    "path": ".github/workflows/ci.yml",
    "ref": "string"
  },
  "run": {
    "id": "number",
    "html_url": "string",
    "event": "workflow_dispatch",
    "status": "completed",
    "conclusion": "string",
    "head_branch": "string",
    "head_sha": "string",
    "created_at": "ISO 8601",
    "run_started_at": "ISO 8601 or null",
    "updated_at": "ISO 8601"
  },
  "polling": {
    "timeout_seconds": "number",
    "poll_interval_seconds": "number",
    "api_calls": "number"
  },
  "request_id": "string or null"
}
```

**Error output (`status=error`)**:
```json
{
  "status": "error",
  "error_code": "INVALID_INPUT | DISPATCH_FAILED | RUN_NOT_FOUND | RUN_AMBIGUOUS | POLL_TIMEOUT | GITHUB_API_ERROR",
  "message": "Human-readable error",
  "retryable": "boolean",
  "context": {
    "owner": "string",
    "repo": "string",
    "ref": "string"
  },
  "request_id": "string or null"
}
```

### GitHub API Contract (Normative)

**Headers used on all requests:**
```
Authorization: Bearer <token from n8n credential>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**1. Baseline runs query (before dispatch):**
```
GET /repos/{owner}/{repo}/actions/workflows/ci.yml/runs?event=workflow_dispatch&branch={ref}&per_page=20
```
- Expected: `200 OK`
- Extract baseline set: `baseline_run_ids = workflow_runs[].id`

**2. Dispatch request:**
```
POST /repos/{owner}/{repo}/actions/workflows/ci.yml/dispatches
Body: { "ref": "{ref}" }
```
- Expected: `204 No Content`
- On non-204: classify as `DISPATCH_FAILED` (include HTTP status and response body)

**3. Discovery polling query (after dispatch):**
```
GET /repos/{owner}/{repo}/actions/workflows/ci.yml/runs?event=workflow_dispatch&branch={ref}&per_page=20
```

**4. Run detail polling:**
```
GET /repos/{owner}/{repo}/actions/runs/{run_id}
```
- Expected: `200 OK`
- Terminal condition: `status == "completed"`

### HTTP Error Classification (Normative)

**Dispatch endpoint (`POST .../dispatches`)**:
- `204`: success
- `401`, `403`, `404`, `422`: `DISPATCH_FAILED`, `retryable=false`
- `429`, `5xx`: `DISPATCH_FAILED`, `retryable=true` (retry within timeout budget)
- Other non-204: `DISPATCH_FAILED`, `retryable=false`

**Polling endpoints (`GET .../runs`) and (`GET .../runs/{run_id}`)**:
- `200`: normal processing
- `401`, `403`, `404`: `GITHUB_API_ERROR`, `retryable=false`
- `429`, `5xx`: `GITHUB_API_ERROR`, `retryable=true` (wait one poll interval, then retry)
- Other non-200: `GITHUB_API_ERROR`, `retryable=false`

### Run Correlation Algorithm (Normative)

Because dispatch API returns no `run_id`, matching must follow this exact algorithm:

1. Record `dispatch_requested_at` immediately before dispatch call.
2. Capture `baseline_run_ids` from pre-dispatch query.
3. After successful dispatch, poll discovery endpoint.
4. Candidate filter for each polled run:
   - `run.id` not in `baseline_run_ids`
   - `run.event == "workflow_dispatch"`
   - `run.path == ".github/workflows/ci.yml"`
   - `run.created_at >= dispatch_requested_at - 5 seconds` (clock-skew tolerance)
5. Candidate resolution:
   - 0 candidates: continue polling.
   - 1 candidate: select it as `matched_run_id`.
   - >1 candidates: return `RUN_AMBIGUOUS` (do not guess).
6. If no match before timeout: return `RUN_NOT_FOUND`.
7. Once matched, poll run detail until completed or timeout.
8. If timeout occurs in either discovery or completion stage: return `POLL_TIMEOUT`.

### n8n Workflow Structure (if applicable)

**Workflow ID**: `github-ci-dispatch-result`

**Trigger Type:** `When executed by another workflow`

**Nodes Required (minimum behavioral set):**
1. **Execute Workflow Trigger** (`n8n-nodes-base.executeWorkflowTrigger`)
   - Purpose: Receive input item from parent workflow.

2. **Validate + Normalize Input** (`n8n-nodes-base.code` or equivalent)
   - Purpose: Apply defaults, enforce constraints, initialize state object.

3. **HTTP Request: List Baseline Runs** (`n8n-nodes-base.httpRequest`)
   - Method: GET
   - Endpoint: workflow runs list (event + branch filters)

4. **HTTP Request: Dispatch CI** (`n8n-nodes-base.httpRequest`)
   - Method: POST
   - Endpoint: workflow dispatch
   - Body: `{ "ref": "..." }`

5. **Polling Loop: Discover Run** (`Wait` + `HTTP Request` + `Code` + branch logic)
   - Purpose: Identify unique `run_id` using normative correlation algorithm.

6. **Polling Loop: Wait For Completion** (`Wait` + `HTTP Request` + branch logic)
   - Purpose: Poll run detail until `status=completed`.

7. **Format Output** (`n8n-nodes-base.code` or Set nodes)
   - Purpose: Emit normalized completion/error payload to parent workflow.

**Node Connections (logical):**
```
Execute Workflow Trigger
  -> Validate + Normalize Input
  -> List Baseline Runs
  -> Dispatch CI
  -> Discover Run Poll Loop
  -> Completion Poll Loop
  -> Format Output
```

**Credentials Needed:**
- `github_actions_token` (Type: HTTP auth)
  - Used in: all GitHub HTTP Request nodes
  - Permissions: dispatch workflow + read workflow runs

---

## Security Considerations

**Authentication:**
- GitHub API authentication uses PAT through n8n credential manager.
- Never hardcode tokens in workflow JSON or SOP.

**Authorization:**
- Token scope should be limited to required repository permissions.
- For fine-grained PATs, keep repository scope minimal.

**Data Handling:**
- Workflow processes metadata only (run status, IDs, URLs, timestamps).
- Do not log token headers or full credential objects.
- Mask or omit raw API error bodies if they contain sensitive data.

**Attack Surface:**
- No public webhook endpoint in this workflow; internal trigger only.
- Risk is primarily credential exposure and over-permissive token scopes.

---

## Testing

### Manual Testing

**Test Case 1: Happy Path (CI succeeds)**
1. Create parent test workflow with `Execute Workflow` node calling `github-ci-dispatch-result`.
2. Input:
```json
{
  "repo_owner": "NNTin",
  "repo_name": "gSnake",
  "ref": "main",
  "timeout_seconds": 1800,
  "poll_interval_seconds": 15,
  "request_id": "test-happy-path"
}
```
3. Verify:
- Output `status` is `completed`
- `ci_success` is `true`
- `run.id` and `run.html_url` are present

**Test Case 2: CI Conclusion Is Failure (still completed output)**
1. Run against a ref expected to fail CI.
2. Verify:
- Output `status` is `completed`
- `ci_success` is `false`
- `conclusion` is non-success (`failure`, `cancelled`, etc.)
- Workflow does not crash due to CI test failure

**Test Case 3: Invalid Ref**
1. Input `ref` as non-existent branch/tag.
2. Verify:
- Output `status` is `error`
- `error_code` is `DISPATCH_FAILED`
- HTTP status from GitHub (`422`) is captured in context/message

**Test Case 4: Missing or Invalid Token**
1. Use invalid credential.
2. Verify:
- Output `status` is `error`
- `error_code` is `GITHUB_API_ERROR` or `DISPATCH_FAILED`
- Error classified as `retryable=false`

**Test Case 5: Timeout Handling**
1. Set `timeout_seconds` low (for example `60`) and `poll_interval_seconds` `15`.
2. Verify:
- Output `status` is `error`
- `error_code` is `POLL_TIMEOUT`
- Context includes elapsed timeout values

**Test Case 6: Ambiguous Candidate Detection**
1. Trigger two dispatches in near-parallel for the same repo/ref.
2. Verify:
- If candidate matching cannot uniquely resolve run ID, output returns `RUN_AMBIGUOUS`
- Workflow must not arbitrarily choose one run

### Automated Testing (if applicable)

- Add workflow-level regression tests via n8n MCP execution (if test harness exists).
- Minimum assertions for automation:
  - Dispatch HTTP status handling
  - Correlation algorithm behavior for 0/1/multiple candidates
  - Terminal mapping `conclusion -> ci_success`

### Testing via n8n UI (if applicable)

1. Navigate to `https://n8n.labs.lair.nntin.xyz/workflow/github-ci-dispatch-result`
2. Use "Test Workflow" with sample input payload
3. Confirm final output JSON matches this SOP schema

---

## Error Handling

### Error: INVALID_INPUT

**Symptom:** Workflow exits immediately with validation error.

**Possible Causes:**
1. Multiple input items sent instead of one
2. Invalid timeout/poll values
3. Empty `ref`

**Resolution:**
1. Ensure parent sends exactly one JSON item
2. Fix numeric ranges (`timeout_seconds`, `poll_interval_seconds`)
3. Provide valid `ref`

**Prevention:** Validate parent payload before calling child workflow.

---

### Error: DISPATCH_FAILED

**Symptom:** Dispatch call does not return HTTP `204`.

**Possible Causes:**
1. Invalid/missing token (`401`)
2. Missing permissions (`403`)
3. Workflow file or repo not found (`404`)
4. Invalid ref (`422`)

**Resolution:**
1. Verify token scope and validity
2. Verify repo owner/name and workflow path (`ci.yml`)
3. Verify target ref exists

**Prevention:** Keep repo/ref defaults aligned with actual repository state.

---

### Error: RUN_NOT_FOUND

**Symptom:** Dispatch accepted but matching run is never found before timeout.

**Possible Causes:**
1. GitHub queue delay exceeded timeout
2. Correlation filters too strict
3. Branch filter mismatch

**Resolution:**
1. Increase timeout
2. Inspect GitHub Actions UI for workflow_dispatch runs
3. Review matching logic against this SOP algorithm

**Prevention:** Keep poll timeout >= typical CI queue + execution time.

---

### Error: RUN_AMBIGUOUS

**Symptom:** Multiple candidate runs satisfy match criteria.

**Possible Causes:**
1. Concurrent dispatches on same ref
2. Overlapping orchestrations with same token and branch

**Resolution:**
1. Retry with controlled dispatch concurrency
2. Stagger parent workflow calls

**Prevention:** Avoid parallel dispatches to same workflow/ref when exact run attribution is required.

---

### Error: POLL_TIMEOUT

**Symptom:** Run discovered but not completed before deadline.

**Possible Causes:**
1. Long-running CI jobs
2. GitHub queue congestion

**Resolution:**
1. Increase `timeout_seconds`
2. Review CI runtime and queue behavior

**Prevention:** Set timeout based on observed p95/p99 CI duration.

---

## Edge Cases

**Edge Case 1: Dispatch accepted but workflow run is delayed**
- **Condition:** `204` returned, but runs list remains unchanged for several polls
- **Behavior:** Continue discovery polling until timeout
- **Rationale:** Dispatch acceptance is asynchronous

**Edge Case 2: CI run conclusion is non-success**
- **Condition:** Run completes with `failure`, `cancelled`, `timed_out`, etc.
- **Behavior:** Return `status=completed` with `ci_success=false`
- **Rationale:** CI failure is business outcome, not orchestration failure

**Edge Case 3: GitHub transient API errors (`502`, `503`, `504`)**
- **Condition:** Temporary upstream API instability
- **Behavior:** Retry within polling loop until timeout budget exhausted
- **Rationale:** Improves robustness for transient failures

**Edge Case 4: Re-run attempts on same run**
- **Condition:** Matched run has `run_attempt > 1`
- **Behavior:** Return run metadata including `run_attempt` from API
- **Rationale:** Parent workflow may need auditability for retried runs

---

## Performance Considerations

**Expected Load:**
- Low to moderate orchestration frequency
- Typical: few dispatches per hour

**Timeouts:**
- Default timeout: 1800 seconds
- Poll interval: 15 seconds
- Max poll cycles at default: 120

**Rate Limiting:**
- GitHub authenticated rate limit typically 5000 requests/hour/token
- Estimated requests per execution (default):
  - Baseline + dispatch: 2
  - Discovery and completion polling: up to 120-240 (depends on split between phases)
- Recommended: keep dispatch concurrency controlled to avoid throttling

---

## Monitoring & Logging

**What Gets Logged:**
- Input metadata (owner, repo, ref, request_id)
- Dispatch attempt timestamp
- Matched run ID and URL
- Poll progress checkpoints (stage, attempt number)
- Final completion/error payload

**What MUST NOT be logged:**
- Authorization token
- Full credential object

**Log Location:**
- n8n execution logs and execution data in n8n UI
- Optional `.tmp/` debug artifacts if implementation adds explicit file logging

**Log Format (recommended):**
```json
{
  "timestamp": "ISO 8601",
  "level": "INFO|WARN|ERROR",
  "request_id": "string",
  "stage": "baseline|dispatch|discover|wait_completion|finalize",
  "message": "Human-readable status",
  "context": {
    "owner": "NNTin",
    "repo": "gSnake",
    "ref": "main",
    "run_id": 123456789
  }
}
```

**Alerts/Notifications:**
- Optional downstream alert when `status=error` or `ci_success=false`
- Alerting is out of scope for this workflow; parent workflow decides

---

## Common Workflows

### Workflow 1: First-Time Setup

```bash
# 1) Ensure SOP and workflow JSON are in git workspace
cd /home/nntin/git/gSnake/gsnake-n8n

# 2) Import workflows to n8n
./tools/scripts/sync-workflows.sh import

# 3) Activate workflow in n8n UI (if required by your environment)
# https://n8n.labs.lair.nntin.xyz/
```

### Workflow 2: Parent Workflow Integration

1. In parent n8n flow, add `Execute Workflow` node.
2. Select workflow ID `github-ci-dispatch-result`.
3. Pass one JSON input item matching this SOP input schema.
4. Branch on returned fields:
- `status == "completed" && ci_success == true` -> success path
- `status == "completed" && ci_success == false` -> CI-failure path
- `status == "error"` -> orchestration-error path

### Workflow 3: Troubleshooting Failed Execution

```bash
# 1) Open n8n execution details for failed run
# 2) Verify child output payload (status/error_code/message)
# 3) Inspect corresponding GitHub run URL from output
# 4) Re-run with same request_id for traceability if needed
```

---

## Integration Points

**Upstream Dependencies:**
- Parent n8n workflow that calls this child workflow via `Execute Workflow`.

**Downstream Consumers:**
- GitHub Actions CI workflow `.github/workflows/ci.yml`.
- Parent workflow branches based on returned result payload.

**Data Flow Diagram:**
```
[Parent n8n Flow]
  -> [This Workflow: github-ci-dispatch-result]
  -> [GitHub Actions: .github/workflows/ci.yml]
  -> [This Workflow polls status]
  -> [Parent n8n Flow receives structured outcome]
```

---

## Rollback Procedure

If this workflow/tool causes issues, how to revert:

```bash
# 1. Deactivate workflow in n8n UI
# (Open workflow and toggle inactive)

# 2. Restore previous JSON from git history
cd /home/nntin/git/gSnake/gsnake-n8n
git checkout HEAD~1 -- tools/n8n-flows/github-ci-dispatch-result.json

# 3. Re-import restored workflow
./tools/scripts/sync-workflows.sh import

# 4. Verify parent workflows point to restored behavior
```

---

## Future Improvements

Known limitations and planned enhancements:

- [ ] Add optional support for configurable workflow file (not just `ci.yml`) with strict allowlist.
- [ ] Add caller-provided correlation strategy once `.github/workflows/ci.yml` defines workflow inputs.
- [ ] Add optional callback notification node for async fan-out (Discord/Slack).
- [ ] Add metrics export for CI duration and failure-rate trends.

---

## Related Documentation

- **Related SOPs**:
  - `workflows/infra/n8n-sync.md`
  - `workflows/infra/trigger-github-push-event.md`
- **Target CI Workflow**:
  - `.github/workflows/ci.yml`
- **External References**:
  - [GitHub REST API - Workflows](https://docs.github.com/en/rest/actions/workflows)
  - [GitHub REST API - Workflow Runs](https://docs.github.com/en/rest/actions/workflow-runs)
  - [n8n Documentation](https://docs.n8n.io/)

---

## Acceptance Criteria

- Workflow trigger is `When executed by another workflow`.
- Workflow dispatches `ci.yml` using GitHub API and validates dispatch response handling.
- Workflow does not treat CI test failure as orchestration error.
- For CI failure outcomes, output is `status=completed` with `ci_success=false`.
- For technical failures, output is `status=error` with deterministic `error_code` and `retryable`.
- Run matching uses baseline + post-dispatch polling and returns `RUN_AMBIGUOUS` for multiple candidates.
- Parent workflow receives a single normalized JSON output object.

---

## Changelog

Track major changes to this SOP:

**2026-02-08**: Initial creation

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
