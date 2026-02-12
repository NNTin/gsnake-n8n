---
implementation_status: implemented
tool_type: n8n-workflow
tool_location: tools/n8n-flows/github-multi-ci-suite-parent.json
workflow_id: github-multi-ci-suite-parent
last_updated: "2026-02-12T00:00:00Z"
dependencies:
  - workflows/n8n-workflow/dispatch-github-ci-and-capture-result.md
  - .github/workflows/ci.yml
  - gsnake-web/.github/workflows/ci.yml
  - gsnake-specs/.github/workflows/ci.yml
  - gsnake-levels/.github/workflows/ci.yml
  - gsnake-editor/.github/workflows/ci.yml
  - gsnake-specs/.github/workflows/test.yml
tags: ["github", "ci", "workflow-dispatch", "n8n-workflow", "manual-trigger", "orchestration", "multi-repo"]
---

# Dispatch Multi-Repo CI Suite And Capture Results

Manual parent n8n workflow that triggers multiple GitHub Actions checks across gSnake repositories, waits for completion through a reusable child workflow, and returns one aggregated CI suite result.

## Objective

**What**: Run the following six GitHub Actions workflows from one manual n8n execution:
- `NNTin/gSnake` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-web` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-specs` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-levels` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-editor` -> `.github/workflows/ci.yml`
- `NNTin/gsnake-specs` -> `.github/workflows/test.yml`

**Why**: Provide a single manual quality gate that confirms the cross-repository CI surface before release, merge, or deployment activities.

**When**: Use when an operator wants to validate the full gSnake CI suite on demand and get a deterministic pass/fail summary.

---

## Prerequisites

**Environment Variables** (optional):
```bash
DEFAULT_CI_REF="main"                  # Optional default branch/tag used by parent workflow
DEFAULT_CHILD_TIMEOUT_SECONDS="3600"   # Optional default timeout passed to child workflow
DEFAULT_CHILD_POLL_INTERVAL_SECONDS="15"  # Optional poll interval passed to child workflow
```

**External Dependencies** (required):
- n8n instance with ability to run manually triggered workflows.
- Child workflow implemented and available:
  - `github-ci-dispatch-result` (from `workflows/n8n-workflow/dispatch-github-ci-and-capture-result.md`)
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

---

## Implementation Details

**Tool Type**: n8n workflow (manual trigger parent orchestration)

**Location**: `tools/n8n-flows/github-multi-ci-suite-parent.json`

**Key Technologies**:
- n8n `Manual Trigger`
- n8n `Code` node for matrix generation and result aggregation
- n8n `Loop Over Items` (or equivalent sequential iterator)
- n8n `Execute Workflow` node calling `github-ci-dispatch-result`

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

**What it does (step-by-step):**
1. Starts from `Manual Trigger`.
2. Builds target matrix and applies optional runtime overrides.
3. Iterates through targets and invokes child workflow once per target.
4. Captures each child response exactly as returned (`completed` or `error`).
5. Aggregates summary counts and computes overall suite status.
6. Returns one normalized payload with per-target details and final pass/fail.

**Expected output (suite success):**
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

**Expected output (suite has failures):**
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

**Expected output (orchestration/child errors):**
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

This workflow is manual-first and can run with no external input. If inputs are provided (for repeatable automation), use:

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

2. **Build Target Matrix** (`n8n-nodes-base.code`)
   - Purpose: define fixed six-target list and apply optional overrides.

3. **Loop Targets** (`n8n-nodes-base.splitInBatches` or `n8n-nodes-base.loopOverItems`)
   - Purpose: deterministic per-target execution.

4. **Execute Child Workflow** (`n8n-nodes-base.executeWorkflow`)
   - Workflow: `github-ci-dispatch-result`
   - Wait for completion: `true`

5. **Normalize Per-Target Result** (`n8n-nodes-base.code`)
   - Purpose: map child output into parent result schema.

6. **Aggregate Suite Summary** (`n8n-nodes-base.code`)
   - Purpose: compute `passed`, `failed`, `errors`, `overall_success`.

7. **Return Final Payload** (`n8n-nodes-base.code` or `Set`)
   - Purpose: stable output contract for manual review and downstream automation.

**Node Connections (logical):**
```
Manual Trigger
  -> Build Target Matrix
  -> Loop Targets
  -> Execute Child Workflow
  -> Normalize Per-Target Result
  -> (back to Loop until done)
  -> Aggregate Suite Summary
  -> Return Final Payload
```

**Credentials Needed:**
- No direct GitHub credential in parent.
- Parent relies on child workflow credential `github_actions_token`.

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
- Manual trigger only; no external ingress.
- Primary risk is misuse of an over-scoped GitHub token in child workflow.

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

### Testing via n8n UI

1. Navigate to `https://n8n.labs.lair.nntin.xyz/workflow/github-multi-ci-suite-parent`
2. Click **Test workflow**
3. Optionally provide runtime overrides
4. Verify final output schema and per-target run URLs

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
- Target dispatch order (`target_id`)
- Per-target child status and run URL
- Aggregated summary (`passed`, `failed`, `errors`)

**What must not be logged:**
- Tokens
- Raw credential objects

**Recommended log shape:**
```json
{
  "request_id": "multi-ci-2026-02-12T00:00:00Z",
  "target_id": "gsnake-specs-test",
  "repo_name": "gsnake-specs",
  "workflow_path": ".github/workflows/test.yml",
  "status": "completed",
  "ci_success": true
}
```

---

## Integration Points

**Upstream Dependencies:**
- Manual operator execution in n8n UI.
- Optional upstream parent if this workflow is later reused as child.

**Downstream Dependencies:**
- `github-ci-dispatch-result` child workflow.
- GitHub Actions workflows listed in objective.

**Data Flow Diagram:**
```
[Manual Trigger]
  -> [Parent: github-multi-ci-suite-parent]
  -> [Child: github-ci-dispatch-result] x N targets
  -> [GitHub Actions runs]
  -> [Parent aggregates results]
  -> [Single suite result payload]
```
