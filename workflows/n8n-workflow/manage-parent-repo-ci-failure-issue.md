---
implementation_status: implemented
tool_type: n8n-workflow
tool_location: tools/n8n-flows/github-parent-ci-failure-issue-manager.json
workflow_id: github-parent-ci-failure-issue-manager
last_updated: "2026-02-12T08:00:00Z"
dependencies:
  - workflows/n8n-workflow/dispatch-multi-repo-ci-suite-and-capture-results.md
  - tools/n8n-flows/github-multi-ci-suite-parent.json
tags: ["github", "ci", "issues", "n8n-workflow", "execute-workflow-trigger", "incident-tracking"]
---

# Manage Parent Repo CI Failure Issue

Internal n8n workflow that receives the aggregated CI suite result from the parent workflow and manages a single tracking issue in `github.com/nntin/gsnake` with title `[n8n] Automated Tests: Failure detected`.

## Objective

**What**: Read the CI suite output from `dispatch-multi-repo-ci-suite-and-capture-results` and decide whether to comment, close, create, or do nothing on the tracking issue.

**Why**: Keep one canonical CI-failure issue up to date without opening duplicates, and automatically close it after recovery.

**When**: Use immediately after each multi-repo CI suite execution, as a child workflow triggered by `Execute Workflow` from another n8n workflow.

---

## Prerequisites

**Environment Variables** (optional):
```bash
PARENT_REPO_OWNER="nntin"   # Default hard-coded owner for issue operations
PARENT_REPO_NAME="gsnake"   # Default hard-coded repo for issue operations
```

**External Dependencies** (required):
- Parent workflow output from the last node of:
  - `workflows/n8n-workflow/dispatch-multi-repo-ci-suite-and-capture-results.md`
  - Node name: `Aggregate Suite Summary`
- n8n instance with support for internal workflow execution (`Execute Workflow Trigger`).
- GitHub repository `github.com/nntin/gsnake`.

**Credential Requirement (required)**:
- n8n credential name: `github_actions_token`
- Needed scope: issue read/write in `nntin/gsnake`

**Required Permissions**:
- Parent workflow can execute this child workflow and wait for completion.
- GitHub credential can:
  - Read open issues in `nntin/gsnake`
  - Create issue comments in `nntin/gsnake`
  - Create new issues in `nntin/gsnake`
  - Close existing issues in `nntin/gsnake`

---

## Implementation Details

**Tool Type**: n8n workflow (triggered by another n8n workflow)

**Location**: `tools/n8n-flows/github-parent-ci-failure-issue-manager.json`

**Key Technologies**:
- n8n `Execute Workflow Trigger`
- n8n `GitHub` nodes for Issues API actions
- n8n `Code` and `Switch/IF` nodes for decision logic

---

## Usage

### Execute From Parent CI Suite Workflow

Parent workflow node configuration:
- Node type: `Execute Workflow`
- Workflow: `github-parent-ci-failure-issue-manager`
- Wait for completion: `true`
- Input: output JSON from parent node `Aggregate Suite Summary`

**Tracking issue title (exact match):**
```text
[n8n] Automated Tests: Failure detected
```

**Decision rules (normative):**
1. `open_issue_exists == true` and `has_failures == true`:
- Add a new comment to the existing open tracking issue with current run summary and run links.
2. `open_issue_exists == true` and `has_failures == false`:
- Add a recovery comment saying CI runs are successful, include run links, then close the issue.
3. `open_issue_exists == false` and `has_failures == false`:
- Do nothing.
4. `open_issue_exists == false` and `has_failures == true`:
- Create a new issue in `nntin/gsnake` and document successful and unsuccessful CI runs.

**Important repository guardrail:**
- All issue actions must always target `nntin/gsnake`.
- Never derive issue target repo from `results[].repo_name` because those entries include submodules.

**What it does (step-by-step):**
1. Receives one input item from parent suite workflow.
2. Validates schema and computes `has_failures` from `summary` and `results`.
3. Calls GitHub node `Get issues of a repository` for `nntin/gsnake` with state `open`.
4. Filters by exact issue title `[n8n] Automated Tests: Failure detected`.
5. Applies decision rules above.
6. Writes comment and/or closes/creates issue when required.
7. Returns a single action summary payload.

**Expected output (existing open issue + failures):**
```json
{
  "status": "completed",
  "action": "commented_existing_issue",
  "failure_detected": true,
  "issue": {
    "number": 123,
    "state": "open",
    "html_url": "https://github.com/nntin/gsnake/issues/123"
  }
}
```

**Expected output (existing open issue + recovery):**
```json
{
  "status": "completed",
  "action": "commented_and_closed_issue",
  "failure_detected": false,
  "issue": {
    "number": 123,
    "state": "closed",
    "html_url": "https://github.com/nntin/gsnake/issues/123"
  }
}
```

**Expected output (no open issue + failures):**
```json
{
  "status": "completed",
  "action": "created_new_issue",
  "failure_detected": true,
  "issue": {
    "number": 124,
    "state": "open",
    "html_url": "https://github.com/nntin/gsnake/issues/124"
  }
}
```

**Expected output (no open issue + success):**
```json
{
  "status": "completed",
  "action": "no_action",
  "failure_detected": false,
  "issue": null
}
```

---

## Technical Specifications

### Input Format

Input must be one JSON item from parent node `Aggregate Suite Summary`:

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
      "target_id": "gsnake-ci",
      "repo_owner": "NNTin",
      "repo_name": "gSnake",
      "workflow_path": ".github/workflows/ci.yml",
      "status": "completed",
      "ci_success": true,
      "conclusion": "success",
      "run_url": "https://github.com/NNTin/gSnake/actions/runs/111"
    }
  ],
  "started_at": "2026-02-12T00:00:00.000Z",
  "finished_at": "2026-02-12T00:05:00.000Z",
  "duration_seconds": 300
}
```

**Failure detection logic (normative):**
```js
has_failures =
  (summary.failed > 0) ||
  (summary.errors > 0) ||
  (overall_success === false) ||
  results.some(r => r.status !== "completed" || r.ci_success !== true);
```

### Output Format

```json
{
  "status": "completed | error",
  "action": "commented_existing_issue | commented_and_closed_issue | created_new_issue | no_action | error",
  "failure_detected": "boolean",
  "issue": {
    "number": "number",
    "state": "open | closed",
    "html_url": "string"
  },
  "summary": {
    "total": "number",
    "passed": "number",
    "failed": "number",
    "errors": "number"
  },
  "successful_runs": [
    {
      "target_id": "string",
      "run_url": "string"
    }
  ],
  "unsuccessful_runs": [
    {
      "target_id": "string",
      "status": "completed | error",
      "conclusion": "string or null",
      "error_code": "string or null",
      "run_url": "string or null"
    }
  ]
}
```

### n8n Workflow Structure

**Workflow ID**: `github-parent-ci-failure-issue-manager`

**Nodes Required:**
1. **Execute Workflow Trigger** (`n8n-nodes-base.executeWorkflowTrigger`)
   - Trigger type: workflow can only run when called by another workflow.

2. **Validate And Classify Suite Result** (`n8n-nodes-base.code`)
   - Validate parent payload shape.
   - Compute `has_failures`.
   - Split run list into successful and unsuccessful sections.

3. **Get issues of a repository** (`n8n-nodes-base.github`)
   - Resource/Operation: Issue -> Get issues of a repository.
   - Repository owner: `nntin`
   - Repository name: `gsnake`
   - State filter: `open`

4. **Find Matching Open Tracking Issue** (`n8n-nodes-base.code`)
   - Select issue whose title exactly equals `[n8n] Automated Tests: Failure detected`.
   - If multiple matches exist, use the oldest open issue (`lowest number`) as canonical.

5. **Decide Action** (`n8n-nodes-base.switch` or `n8n-nodes-base.if`)
   - Branch by `open_issue_exists` and `has_failures`.

6. **Build Comment/Issue Body** (`n8n-nodes-base.code`)
   - Build markdown including:
     - Summary counts
     - Successful run links
     - Unsuccessful run links and error/conclusion

7. **Create or Comment or Close** (`n8n-nodes-base.github`)
   - Comment on existing issue
   - Create new issue (if needed)
   - Edit issue state to `closed` (recovery path)

8. **Return Action Summary** (`n8n-nodes-base.set` or `n8n-nodes-base.code`)
   - Return stable output contract for parent workflow.

**Node Connections (logical):**
```text
Execute Workflow Trigger
  -> Validate And Classify Suite Result
  -> Get issues of a repository
  -> Find Matching Open Tracking Issue
  -> Decide Action
     -> [open issue + failures] -> Build Failure Comment -> Comment Issue -> Return Action Summary
     -> [open issue + success]  -> Build Recovery Comment -> Comment Issue -> Close Issue -> Return Action Summary
     -> [no issue + failures]   -> Build New Issue Body -> Create Issue -> Return Action Summary
     -> [no issue + success]    -> Return Action Summary
```

**Credentials Needed:**
- `github_actions_token` (GitHub API auth)
  - Used in: all GitHub issue nodes
  - Minimum rights: read/write issues on `nntin/gsnake`

---

## Security Considerations

**Authentication:**
- GitHub auth via n8n credential (`github_actions_token`).
- No public webhook endpoint; internal workflow trigger only.

**Authorization:**
- Restrict token to required repos and issue permissions.
- Restrict execution of this child workflow to trusted parent workflows/operators.

**Data Handling:**
- Processes CI metadata and issue metadata only.
- Must not log credentials or full auth headers.

**Critical Guardrail:**
- Hard-code issue repository target to `nntin/gsnake` for all create/comment/close nodes.
- Do not use `results[].repo_owner` or `results[].repo_name` for issue actions.

---

## Testing

### Manual Testing

**Test Case 1: Open tracking issue exists, CI has failures**
1. Ensure issue `[n8n] Automated Tests: Failure detected` is open in `nntin/gsnake`.
2. Execute workflow with input where `summary.failed > 0` or `summary.errors > 0`.
3. Verify:
- New comment is added to existing issue.
- Issue remains open.
- Output action is `commented_existing_issue`.

**Test Case 2: Open tracking issue exists, CI fully successful**
1. Ensure issue is open.
2. Execute workflow with successful suite input (`overall_success=true`, no failures/errors).
3. Verify:
- Recovery comment is added.
- Issue is closed.
- Output action is `commented_and_closed_issue`.

**Test Case 3: No open tracking issue, CI fully successful**
1. Ensure no open issue with target title.
2. Execute workflow with successful suite input.
3. Verify:
- No issue is created.
- Output action is `no_action`.

**Test Case 4: No open tracking issue, CI has failures**
1. Ensure no open issue with target title (closed issue is allowed).
2. Execute workflow with failing suite input.
3. Verify:
- New issue is created in `nntin/gsnake`.
- Body documents both successful and unsuccessful runs.
- Output action is `created_new_issue`.

**Test Case 5: Parent repo guardrail**
1. Execute with `results[]` containing multiple submodule repos.
2. Verify created/commented/closed issue appears only in `nntin/gsnake`.

### Testing via n8n UI

1. Navigate to `https://n8n.labs.lair.nntin.xyz/workflow/github-parent-ci-failure-issue-manager`
2. Use test input copied from a real `Aggregate Suite Summary` output.
3. Verify action branch and resulting issue state in GitHub UI.

---

## Error Handling

### Error: INVALID_INPUT

**Symptom:** Workflow fails before issue lookup.

**Possible Causes:**
1. Missing `summary` field.
2. Missing `results` array.
3. Multiple input items passed unexpectedly.

**Resolution:**
1. Ensure parent passes exactly one output item from `Aggregate Suite Summary`.
2. Validate parent schema before calling child.

---

### Error: ISSUE_LOOKUP_FAILED

**Symptom:** `Get issues of a repository` node fails.

**Possible Causes:**
1. Invalid/expired GitHub credential.
2. Missing repo access to `nntin/gsnake`.
3. GitHub API outage/rate limiting.

**Resolution:**
1. Revalidate credential and permissions.
2. Retry workflow execution.

---

### Error: ISSUE_WRITE_FAILED

**Symptom:** Create comment, create issue, or close issue fails.

**Possible Causes:**
1. Token missing issue write permission.
2. Issue ID no longer valid (race with manual edits).
3. GitHub API transient error.

**Resolution:**
1. Confirm issue write permission on token.
2. Re-fetch issue list and re-run.

---

## Edge Cases

**Edge Case 1: Closed issue exists but no open issue**
- **Condition:** Matching title exists only in closed state.
- **Behavior:** Treat as `open_issue_exists=false`.
- **Rationale:** Requirement says "does not exist or is not open" share the same branch.

**Edge Case 2: Multiple open issues with same title**
- **Condition:** Duplicate open tracking issues exist.
- **Behavior:** Use oldest open issue as canonical target and continue.
- **Rationale:** Maintains deterministic behavior until duplicates are manually cleaned.

**Edge Case 3: CI summary says success but a result item is error**
- **Condition:** Inconsistent parent payload.
- **Behavior:** `has_failures=true` based on defensive result inspection.
- **Rationale:** Prefer safe failure reporting over false recovery/closure.

---

## Monitoring & Logging

**What gets logged:**
- Input suite summary (`total/passed/failed/errors`)
- Decision branch selected
- Target issue number and URL (if applicable)
- Final action output

**What must not be logged:**
- Tokens
- Credential internals

**Recommended log shape:**
```json
{
  "workflow": "github-parent-ci-failure-issue-manager",
  "issue_title": "[n8n] Automated Tests: Failure detected",
  "failure_detected": true,
  "action": "created_new_issue",
  "issue_number": 124
}
```

---

## Integration Points

**Upstream Dependencies:**
- `github-multi-ci-suite-parent` output from node `Aggregate Suite Summary`.

**Downstream Consumers:**
- GitHub Issues in `nntin/gsnake`.
- Optional parent automation that branches on returned `action`.

**Data Flow Diagram:**
```text
[Parent Workflow: github-multi-ci-suite-parent]
  -> [Child: github-parent-ci-failure-issue-manager]
  -> [GitHub Issues: nntin/gsnake]
  -> [Action summary returned to parent]
```

---

## Rollback Procedure

If this workflow causes incorrect issue lifecycle behavior:

```bash
# 1. Deactivate workflow in n8n UI

# 2. Restore previous workflow JSON from git history (when implemented)
cd /home/nntin/git/gSnake/gsnake-n8n
git checkout HEAD~1 -- tools/n8n-flows/github-parent-ci-failure-issue-manager.json

# 3. Re-import workflows
./tools/scripts/sync-workflows.sh import
```

---

## Future Improvements

- [ ] Add label automation (e.g., `ci`, `automated`, `n8n`) for created issues.
- [ ] Add deduplication cleanup flow for accidental duplicate open issues.
- [ ] Add optional assignment and milestone support.

---

## Related Documentation

- `workflows/n8n-workflow/dispatch-multi-repo-ci-suite-and-capture-results.md`
- `workflows/n8n-workflow/dispatch-github-ci-and-capture-result.md`
- `workflows/infra/n8n-sync.md`
- [n8n GitHub Node Docs](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.github/)
- [GitHub REST API - Issues](https://docs.github.com/en/rest/issues/issues)

---

## Acceptance Criteria

- Trigger is `Execute Workflow Trigger` (internal workflow only).
- Input is parent output from `Aggregate Suite Summary`.
- Workflow queries `Get issues of a repository` in `nntin/gsnake` for open issues.
- Exact issue title match: `[n8n] Automated Tests: Failure detected`.
- If open issue exists and failures exist: comment on existing issue.
- If open issue exists and all CI runs are successful: comment recovery and close issue.
- If no open issue and CI runs are successful: no action.
- If no open issue and failures exist: create new issue with successful/unsuccessful run details.
- All issue create/comment/close operations occur only in `nntin/gsnake`, never submodules.

---

## Changelog

**2026-02-12**: Initial creation

---

## Implementation Checklist

- [ ] Prerequisites met (credentials, permissions, parent workflow output contract)
- [ ] Tool created at location specified in frontmatter
- [ ] Manual tests completed for all 4 decision branches
- [ ] Parent-repo-only guardrail verified
- [ ] Error handling validated
- [ ] Documentation updated (this SOP + `gsnake-n8n/CLAUDE.md` mapping table if implemented)
- [ ] Committed to git (SOP + implementation)
- [ ] Deployed via `./tools/scripts/sync-workflows.sh import`
- [ ] Frontmatter set to `implementation_status: implemented` after delivery
