---
implementation_status: implemented
tool_type: n8n-workflow
tool_location: tools/n8n-flows/github-multi-ci-suite-parent.json
workflow_id: github-multi-ci-suite-parent
last_updated: "2026-02-12T00:00:00Z"
dependencies:
  - workflows/n8n-workflow/dispatch-github-ci-and-capture-result.md
  - workflows/n8n-workflow/manage-parent-repo-ci-failure-issue.md
  - .github/workflows/ci.yml
  - gsnake-web/.github/workflows/ci.yml
  - gsnake-specs/.github/workflows/ci.yml
  - gsnake-levels/.github/workflows/ci.yml
  - gsnake-editor/.github/workflows/ci.yml
  - gsnake-specs/.github/workflows/test.yml
tags: ["github", "ci", "workflow-dispatch", "n8n-workflow", "manual-trigger", "schedule-trigger", "orchestration", "multi-repo", "workflow-chaining"]
---

# Dispatch Multi-Repo CI Suite And Capture Results

Parent n8n workflow with two triggers (manual and every-8-hours schedule) that runs multiple GitHub Actions checks across gSnake repositories, aggregates CI results, and then triggers a dedicated issue-management workflow.

## Objective

**What**: Run the following six GitHub Actions workflows from one parent n8n execution:
- `NNTin/gSnake` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-web` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-specs` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-levels` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-editor` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-specs` -> `.github/workflows/test.yml`

**Why**: Provide both on-demand and recurring automated CI validation, then hand off result handling to the issue-management workflow.

**When**:
- Manual trigger for operator-initiated validation.
- Schedule trigger every 8 hours for recurring validation.

---

## Prerequisites

**Environment Variables** (optional):
```bash
DEFAULT_CI_REF="main"                  # Optional default branch/tag used by parent workflow
DEFAULT_CHILD_TIMEOUT_SECONDS="3600"   # Optional default timeout passed to child workflow
DEFAULT_CHILD_POLL_INTERVAL_SECONDS="15"  # Optional poll interval passed to child workflow
```

**External Dependencies** (required):
- n8n instance with ability to run manual and scheduled workflows.
- Child workflow implemented and available:
  - `github-ci-dispatch-result` (from `workflows/n8n-workflow/dispatch-github-ci-and-capture-result.md`)
  - `github-parent-ci-failure-issue-manager` (from `workflows/n8n-workflow/manage-parent-repo-ci-failure-issue.md`)
- GitHub Actions workflow files exist and are dispatchable:
  - `.github/workflows/ci.yml`
  - `gsnake-web/.github/workflows/ci.yml`
  - `gsnake-specs/.github/workflows/ci.yml`
  - `gsnake-levels/.github/workflows/ci.yml`
  - `gsnake-editor/.github/workflows/ci.yml`
  - `gsnake-specs/.github/workflows/test.yml`

**Required Permissions**:
- Parent workflow can execute child workflows (`Execute Workflow` node).
- Child workflow credential (`github_actions_token`) can dispatch and read Actions runs in all listed repositories.
- Parent workflow can trigger `github-parent-ci-failure-issue-manager` after CI aggregation.

---

## Implementation Details

**Tool Type**: n8n workflow (manual + scheduled parent orchestration)

**Location**: `tools/n8n-flows/github-multi-ci-suite-parent.json`

**Key Technologies**:
- n8n `Manual Trigger`
- n8n `Schedule Trigger` (every 8 hours)
- n8n `Code` node for matrix generation and result aggregation
- n8n `Loop Over Items` (or equivalent sequential iterator)
- n8n `Execute Workflow` node calling `github-ci-dispatch-result`
- n8n `Execute Workflow` node calling `github-parent-ci-failure-issue-manager`

**Child Workflow Contract Delta (minimal change)**:
- Keep `github-ci-dispatch-result` behavior unchanged except one optional input:
  - `workflow_path` (optional, default `.github/workflows/ci.yml`)
- This allows the parent workflow to run both `ci.yml` and `test.yml` targets without duplicating child logic.

---

## Usage

### Run Full CI Suite (Manual)

Execute the parent workflow from n8n UI using manual trigger.

**Default matrix (normative):**
```json
[
  {"repo_owner":"NNTin","repo_name":"gSnake","workflow_path":".github/workflows/ci.yml","ref":"main","target_id":"gsnake-ci"},
  {"repo_owner":"NNTin","repo_name":"gsnake-web","workflow_path":".github/workflows/ci.yml","ref":"main","target_id":"gsnake-web-ci"},
  {"repo_owner":"NNTin","repo_name":"gsnake-specs","workflow_path":".github/workflows/ci.yml","ref":"main","target_id":"gsnake-specs-ci"},
  {"repo_owner":"NNTin","repo_name":"gsnake-levels","workflow_path":".github/workflows/ci.yml","ref":"main","target_id":"gsnake-levels-ci"},
  {"repo_owner":"NNTin","repo_name":"gsnake-editor","workflow_path":".github/workflows/ci.yml","ref":"main","target_id":"gsnake-editor-ci"},
  {"repo_owner":"NNTin","repo_name":"gsnake-specs","workflow_path":".github/workflows/test.yml","ref":"main","target_id":"gsnake-specs-test"}
]
```

**Optional runtime controls (parent-configurable):**
- `ref` (default `main`): branch/tag for all targets unless overridden per target.
- `timeout_seconds` (default `3600`): passed through to child.
- `poll_interval_seconds` (default `15`): passed through to child.
- `fail_fast` (default `false`): stop after first non-success result when `true`.
- `selected_targets` (optional): subset of `target_id` values for partial runs.

### Run Full CI Suite (Scheduled Every 8 Hours)

Configure a `Schedule Trigger` node with an 8-hour cadence.

Cron example:
```text
0 */8 * * *
```

**What it does (step-by-step):**
1. Starts from `Manual Trigger` or `Schedule Trigger`.
2. Builds target matrix and applies optional runtime overrides.
3. Iterates through targets and invokes child workflow once per target.
4. Captures each child response exactly as returned (`completed` or `error`).
5. Aggregates summary counts and computes overall suite status.
6. Triggers `github-parent-ci-failure-issue-manager` and passes the aggregated suite payload.

**Aggregated payload passed to issue-manager workflow (suite success):**

```json
{
  "status": "completed",
  "overall_success": true,
  "summary": {
    "total": 6,
    "passed": 6,
    "failed": 0,
    "errors": 0
  },
  "results": [
    {
      "target_id": "gsnake-ci",
      "repo_owner": "NNTin",
      "repo_name": "gSnake",
      "workflow_path": ".github/workflows/ci.yml",
      "status": "completed",
      "ci_success": true,
      "conclusion": "success",
      "run_url": "https://github.com/NNTin/gSnake/actions/runs/123"
    }
  ]
}
```

**Aggregated payload passed to issue-manager workflow (suite has failures):**
```json
{
  "status": "completed",
  "overall_success": false,
  "summary": {
    "total": 6,
    "passed": 4,
    "failed": 2,
    "errors": 0
  },
  "results": []
}
```

**Aggregated payload passed to issue-manager workflow (orchestration/child errors):**
```json
{
  "status": "completed",
  "overall_success": false,
  "summary": {
    "total": 6,
    "passed": 4,
    "failed": 1,
    "errors": 1
  },
  "results": [
    {
      "target_id": "gsnake-specs-test",
      "status": "error",
      "error_code": "DISPATCH_FAILED",
      "retryable": false
    }
  ]
}
```

---

## Technical Specifications

### Input Format

This workflow supports two trigger sources:
- Manual trigger
- Schedule trigger every 8 hours

If inputs are provided (for repeatable automation), use:

```json
{
  "ref": "string (optional, default: main)",
  "timeout_seconds": "number (optional, default: 3600, range: 60..7200)",
  "poll_interval_seconds": "number (optional, default: 15, range: 5..60)",
  "fail_fast": "boolean (optional, default: false)",
  "selected_targets": [
    "string target_id values (optional)"
  ]
}
```

### Child Invocation Payload (per target)

Each iteration sends one payload to `github-ci-dispatch-result`:

```json
{
  "repo_owner": "NNTin",
  "repo_name": "gsnake-specs",
  "workflow_path": ".github/workflows/test.yml",
  "ref": "main",
  "timeout_seconds": 3600,
  "poll_interval_seconds": 15,
  "request_id": "multi-ci-2026-02-12T00:00:00Z-gsnake-specs-test"
}
```

### Output Format

Aggregated payload produced by this workflow and passed to `github-parent-ci-failure-issue-manager`:

```json
{
  "status": "completed | error",
  "overall_success": "boolean",
  "summary": {
    "total": "number",
    "passed": "number",
    "failed": "number",
    "errors": "number"
  },
  "results": [
    {
      "target_id": "string",
      "repo_owner": "string",
      "repo_name": "string",
      "workflow_path": "string",
      "status": "completed | error",
      "ci_success": "boolean | null",
      "conclusion": "string | null",
      "error_code": "string | null",
      "retryable": "boolean | null",
      "run_id": "number | null",
      "run_url": "string | null",
      "request_id": "string"
    }
  ],
  "started_at": "ISO 8601",
  "finished_at": "ISO 8601",
  "duration_seconds": "number"
}
```

### n8n Workflow Structure (minimum behavioral set)

**Workflow ID**: `github-multi-ci-suite-parent`

**Nodes Required:**
1. **Manual Trigger** (`n8n-nodes-base.manualTrigger`)
   - Purpose: explicit operator-triggered suite run.

2. **Schedule Trigger** (`n8n-nodes-base.scheduleTrigger`)
   - Purpose: recurring suite run every 8 hours.
   - Schedule: every 8 hours (cron example `0 */8 * * *`).

3. **Build Target Matrix** (`n8n-nodes-base.code`)
   - Purpose: define fixed six-target list and apply optional overrides.

4. **Loop Targets** (`n8n-nodes-base.splitInBatches` or `n8n-nodes-base.loopOverItems`)
   - Purpose: deterministic per-target execution.

5. **Execute Child Workflow** (`n8n-nodes-base.executeWorkflow`)
   - Workflow: `github-ci-dispatch-result`
   - Wait for completion: `true`

6. **Normalize Per-Target Result** (`n8n-nodes-base.code`)
   - Purpose: map child output into parent result schema.

7. **Aggregate Suite Summary** (`n8n-nodes-base.code`)
   - Purpose: compute `passed`, `failed`, `errors`, `overall_success`.

8. **Trigger Issue Manager Workflow** (`n8n-nodes-base.executeWorkflow`)
   - Workflow: `github-parent-ci-failure-issue-manager`
   - Wait for completion: `true` (recommended for deterministic handoff status)
   - Input: aggregated suite payload from `Aggregate Suite Summary`.

**Node Connections (logical):**
```
Manual Trigger
  -> Build Target Matrix
Schedule Trigger (8h)
  -> Build Target Matrix
Build Target Matrix
  -> Loop Targets
  -> Execute Child Workflow
  -> Normalize Per-Target Result
  -> (back to Loop until done)
  -> Aggregate Suite Summary
  -> Trigger Issue Manager Workflow
```

**Credentials Needed:**
- No direct GitHub credential in parent.
- Parent relies on child workflow credential `github_actions_token` through:
  - `github-ci-dispatch-result`
  - `github-parent-ci-failure-issue-manager`

---

## Security Considerations

**Authentication:**
- Parent has no public webhook endpoint and no direct external auth surface.
- GitHub authentication is delegated to child workflow credentials.

**Authorization:**
- Token used by child must have only required repository/action permissions.
- Parent workflow execute permissions should be restricted to trusted operators.

**Data Handling:**
- Parent stores non-sensitive CI metadata (status, conclusion, run URLs).
- Do not log secrets or credential objects.

**Attack Surface:**
- Manual and scheduled internal triggers only; no external ingress.
- Primary risk is misuse of an over-scoped GitHub token in child workflows.

---

## Testing

### Manual Testing

**Test Case 1: Full Suite Happy Path**
1. Manually execute parent workflow on `main`.
2. Verify all six targets run.
3. Verify output:
   - `status=completed`
   - `summary.total=6`
   - `overall_success=true` when all conclusions are `success`.

**Test Case 2: One CI Failure**
1. Execute against a ref where one target CI fails.
2. Verify:
   - `status=completed`
   - `overall_success=false`
   - failed target recorded with `ci_success=false`.

**Test Case 3: Child Technical Error**
1. Use invalid token or invalid ref for one target.
2. Verify:
   - target result `status=error`
   - suite still returns `status=completed` with `overall_success=false`
   - `summary.errors` increments.

**Test Case 4: gsnake-specs test.yml Coverage**
1. Execute suite and inspect results for `target_id=gsnake-specs-test`.
2. Verify `workflow_path=.github/workflows/test.yml` is dispatched and tracked.

**Test Case 5: Selected Targets**
1. Provide `selected_targets=["gsnake-ci","gsnake-web-ci"]`.
2. Verify only those two targets run and `summary.total=2`.

**Test Case 6: Schedule Trigger Every 8 Hours**
1. Configure schedule trigger for every 8 hours.
2. Confirm a scheduled run executes without manual input.
3. Verify full CI suite runs and reaches the final trigger node.

**Test Case 7: Final Handoff To Issue-Manager Workflow**
1. Execute parent workflow (manual or scheduled).
2. Verify `Trigger Issue Manager Workflow` node executes after `Aggregate Suite Summary`.
3. Verify child workflow `github-parent-ci-failure-issue-manager` receives the aggregated payload.

### Testing via n8n UI

1. Navigate to `https://n8n.labs.lair.nntin.xyz/workflow/github-multi-ci-suite-parent`
2. Click **Test workflow**
3. Optionally provide runtime overrides
4. Verify aggregated suite payload and that `Trigger Issue Manager Workflow` executed successfully

---

## Error Handling

### Error: CHILD_WORKFLOW_MISSING

**Symptom:** Execute Workflow node cannot find `github-ci-dispatch-result`.

**Possible Causes:**
1. Child workflow not imported
2. Workflow ID/name mismatch

**Resolution:**
1. Import child workflow JSON via `./tools/scripts/sync-workflows.sh import`
2. Rebind parent Execute Workflow node to workflow ID `github-ci-dispatch-result`

---

### Error: INVALID_TARGET_MATRIX

**Symptom:** Parent exits before dispatching any target.

**Possible Causes:**
1. Empty target list
2. Invalid `selected_targets` filtering all entries out
3. Missing required fields (`repo_owner`, `repo_name`, `workflow_path`)

**Resolution:**
1. Restore normative six-target matrix
2. Correct `selected_targets`
3. Re-run with valid matrix entries

---

### Error: ISSUE_MANAGER_TRIGGER_FAILED

**Symptom:** Final `Trigger Issue Manager Workflow` node fails.

**Possible Causes:**
1. `github-parent-ci-failure-issue-manager` workflow missing/not imported
2. Workflow ID mismatch
3. Child workflow runtime error

**Resolution:**
1. Import workflow JSON via `./tools/scripts/sync-workflows.sh import`
2. Rebind final execute node to workflow ID `github-parent-ci-failure-issue-manager`
3. Inspect child workflow execution logs and fix child error

---

### Error: PARTIAL_SUITE_FAILURE

**Symptom:** Suite completes with mixed results.

**Possible Causes:**
1. One or more CI runs returned non-success conclusion
2. One or more child calls returned `status=error`

**Resolution:**
1. Inspect failed target entries in `results[]`
2. Open `run_url` in GitHub for failed conclusions
3. Retry only failed targets via `selected_targets`

---

## Edge Cases

**Edge Case 1: Child workflow still fixed to ci.yml**
- **Condition:** Child does not yet support `workflow_path`.
- **Behavior:** `gsnake-specs-test` target cannot be dispatched correctly.
- **Handling:** Implement child optional `workflow_path` input before enabling this parent in production.

**Edge Case 2: Long-running suite**
- **Condition:** Sum of target runtimes exceeds operator expectation.
- **Behavior:** Parent remains running until all iterations complete or fail-fast triggers.
- **Handling:** Increase timeout or use `selected_targets` for partial runs.

**Edge Case 3: Mixed technical and CI failures**
- **Condition:** Some targets fail CI while others fail orchestration.
- **Behavior:** Aggregate both under one output with `failed` and `errors` counts.
- **Handling:** Treat both as `overall_success=false`.

**Edge Case 4: Schedule overlap with long execution**
- **Condition:** Next 8-hour schedule window starts before previous execution finished.
- **Behavior:** Multiple parent executions can overlap.
- **Handling:** Configure workflow concurrency limits if overlap is undesirable.

---

## Performance Considerations

**Execution model:** Sequential by default for deterministic correlation and simpler debugging.

**Expected runtime:**
- Approximately sum of all child runtimes (worst case can be large if each CI run is long).

**Rate limiting:**
- Child workflow handles GitHub API polling.
- Sequential parent execution reduces concurrent API pressure and ambiguity risk.

---

## Monitoring & Logging

**What gets logged:**
- Parent run start/end timestamps
- Trigger source (`manual` or `schedule`)
- Target dispatch order (`target_id`)
- Per-target child status and run URL
- Aggregated summary (`passed`, `failed`, `errors`)
- Final handoff node execution status to issue-manager workflow

**What must not be logged:**
- Tokens
- Raw credential objects

**Recommended log shape:**
```json
{
  "request_id": "multi-ci-2026-02-12T00:00:00Z",
  "trigger_source": "schedule",
  "target_id": "gsnake-specs-test",
  "repo_name": "gsnake-specs",
  "workflow_path": ".github/workflows/test.yml",
  "status": "completed",
  "ci_success": true,
  "issue_workflow_triggered": true
}
```

---

## Integration Points

**Upstream Dependencies:**
- Manual operator execution in n8n UI.
- Schedule trigger execution every 8 hours.
- Optional upstream parent if this workflow is later reused as child.

**Downstream Dependencies:**
- `github-ci-dispatch-result` child workflow.
- `github-parent-ci-failure-issue-manager` child workflow.
- GitHub Actions workflows listed in objective.

**Data Flow Diagram:**
```
[Manual Trigger | Schedule Trigger (8h)]
  -> [Parent: github-multi-ci-suite-parent]
  -> [Child: github-ci-dispatch-result] x N targets
  -> [GitHub Actions runs]
  -> [Parent aggregates results]
  -> [Child: github-parent-ci-failure-issue-manager]
```
