---
implementation_status: implemented
tool_type: shell-script
tool_location: tools/scripts/sync-workflows.sh
workflow_id: n/a
last_updated: 2026-02-07
dependencies: []
tags: ["infrastructure", "deployment", "git", "n8n-cli", "docker"]
---

# n8n Workflow Synchronization

Synchronize n8n workflow JSON files between the git repository and the self-hosted n8n instance using n8n CLI commands.

## Objective

**What**: Bidirectional synchronization of n8n workflow definitions between git repository and n8n instance.

**Why**: This ensures:
- Git is the source of truth for workflow definitions
- Manual changes in n8n UI can be captured back to git
- Workflows can be deployed consistently across environments
- Version control and audit trail for all workflow changes
- Infrastructure-as-code approach for workflow management

**When**: Use before/after making changes in either git or n8n UI, during deployments, or for backup/restore operations.

---

## Prerequisites

**Environment Variables**: None required

**External Dependencies**:
- n8n instance running in Docker container
- n8n CLI available inside container (`n8n import:workflow`, `n8n export:workflow`)
- Docker CLI installed on host machine
- Access to n8n container (container ID required in script)

**Required Permissions**:
- Read/write access to `tools/n8n-flows/` directory
- Docker exec permissions for n8n container
- File copy permissions between host and container

**Optional**:
- `jq` command for JSON validation (recommended but not required)

---

## Implementation Details

**Tool Type**: Shell script

**Location**: `tools/scripts/sync-workflows.sh`

**Key Technologies**:
- n8n CLI commands (`import:workflow`, `export:workflow`)
- Docker CLI (`docker exec`, `docker cp`)
- Bash scripting
- JSON file format

**Architecture**: Uses `docker cp` for file transfer (explicit, safe) rather than volume mounts (which would require docker-compose changes).

---

## Usage

### Export (n8n → Git)

Backup workflows from n8n instance to git repository.

```bash
./tools/scripts/sync-workflows.sh export
```

**Parameters**: None

**When to use:**
- After making manual changes in n8n UI
- Before major refactoring (create backup/restore point)
- To capture newly created workflows
- Regular backups (e.g., daily, before deployments)
- After binding credentials to workflows (to capture credential references)

**What it does (step-by-step):**
1. Creates temporary directory `/tmp/n8n-export/` in n8n container
2. Runs `n8n export:workflow --backup --output=/tmp/n8n-export/`
3. Copies exported JSON files from container to host `tools/n8n-flows/`
4. Cleans up temporary directory in container

**Expected output:**
```
Exporting workflows from n8n to git...
Successfully exported N workflows to tools/n8n-flows/
```

Files created:
- One JSON file per workflow in `tools/n8n-flows/`
- Files named by workflow ID (e.g., `notify-discord-v1.json`)
- Pretty-printed JSON (git-friendly diffs)

**Exit codes:**
- 0: Success
- 1: Container not found or n8n CLI error
- 2: File copy failed

---

### Import (Git → n8n)

Deploy workflows from git repository to n8n instance.

```bash
./tools/scripts/sync-workflows.sh import
```

**Parameters**: None

**When to use:**
- After generating/authoring new workflow JSON
- After updating existing workflow JSON in git
- To restore workflows from git backup
- Initial deployment to fresh n8n instance
- After pulling changes from git (CI/CD scenario)

**What it does (step-by-step):**
1. Copies all JSON files from `tools/n8n-flows/` to container temp directory `/tmp/n8n-import/`
2. Runs `n8n import:workflow --separate --input=/tmp/n8n-import/`
3. Cleans up temporary directory in container

**Expected output:**
```
Importing workflows from git to n8n...
Successfully imported N workflows to n8n
```

**Behavior:**
- **New workflow** (ID doesn't exist in n8n): Creates new workflow
- **Existing workflow** (ID matches): Updates workflow in place (no duplicate created)
- **Idempotent**: Safe to run multiple times without side effects

**Exit codes:**
- 0: Success (all workflows imported)
- 1: Container not found or n8n CLI error
- 2: No JSON files found in `tools/n8n-flows/`

---

### Sync (Bidirectional)

Combines export and import to ensure git and n8n are synchronized.

```bash
./tools/scripts/sync-workflows.sh sync
```

**Parameters**: None

**When to use:**
- After making changes in both git and n8n UI
- To reconcile divergent states
- Periodic synchronization (e.g., at start/end of work session)
- When uncertain about git vs n8n state

**What it does (step-by-step):**
1. **Export first** - Captures any manual n8n UI changes to git
2. **Import second** - Ensures git version is deployed to n8n

**Effect:**
- Git becomes source of truth
- Manual changes are captured first, then git version is redeployed
- Any conflicts are resolved in favor of git
- Use with caution if unsure about git vs n8n state

**Exit codes:**
- 0: Success (both export and import succeeded)
- 1: Export or import failed (check logs for details)

---

## Technical Specifications

### Workflow ID Preservation

**Key Behavior**: Workflow IDs from JSON files are preserved on import.

**Implications:**
- Generate JSON with explicit ID: `"id": "notify-discord-v1"`
- Reimporting with same ID updates existing workflow (no duplicate)
- Filename should equal workflow ID for stability (e.g., `notify-discord-v1.json`)

**If ID is missing:**
- n8n assigns random UUID on import
- Must export after import to capture assigned ID
- Update git with exported JSON containing n8n-generated ID

**Best Practice**: Always specify IDs when generating workflows.

---

### File Format

Each workflow is a JSON file in `tools/n8n-flows/`:

```json
{
  "id": "workflow-unique-id",           // Preserved on import (CRITICAL)
  "name": "Human Readable Workflow Name",
  "description": "What this workflow does",
  "active": false,                      // true = auto-executes on triggers
  "nodes": [
    {
      "id": "node-id",
      "name": "Node Display Name",
      "type": "n8n-nodes-base.webhook",
      "parameters": {...},
      "position": [x, y]
    }
  ],
  "connections": {
    "node-name": {
      "main": [[{"node": "next-node", "type": "main", "index": 0}]]
    }
  },
  "settings": {},
  "versionId": "uuid",                  // n8n-generated, changes on update
  "shared": [{                          // Project assignment
    "projectId": "...",
    "project": {...}
  }]
}
```

**Note**: `versionId` changes on every update (n8n version tracking). This creates git diffs but is expected behavior.

---

### Container Configuration

**Container ID**: Hardcoded in script (must be updated if container recreated)

```bash
CONTAINER_ID="440742681e58b8049db5f7541c5ce24312bd348662e6a68bab55720f7d16d30e"
```

**To update container ID:**
```bash
docker ps | grep n8n
# Copy new container ID
# Edit tools/scripts/sync-workflows.sh
# Update CONTAINER_ID variable
```

---

## Security Considerations

**Authentication:**
- Script requires Docker access (no additional auth)
- n8n credentials are NOT exported/imported (handled separately)

**Authorization:**
- Script must have permissions to execute docker commands
- Container must allow `docker exec` and `docker cp` operations

**Data Handling:**
- **Credentials**: NOT stored in JSON files (stored in n8n database separately)
- **Workflow logic**: Visible in JSON (source code)
- **Sensitive data**: Ensure no hardcoded secrets in workflow parameters
- **Git commits**: Review before committing to avoid exposing sensitive logic

**Credentials Management:**
1. Credentials are managed in n8n's credential system (stored separately from workflow JSON)
2. Workflows reference credentials by NAME in JSON:
   ```json
   {
     "credentials": {
       "githubApi": {
         "id": "credential-uuid",
         "name": "github_token"
       }
     }
   }
   ```
3. Actual credential values (API keys, tokens) are stored in n8n database
4. Create credentials in n8n UI (one-time setup) before importing workflows that use them

**Missing credentials behavior:**
- Workflow imports successfully even if credential doesn't exist
- Execution fails at runtime if credential is missing
- Must create credential in n8n UI before workflow can run

---

## Testing

### Manual Testing

**Test Case 1: Export Existing Workflows**
```bash
# Setup
# (Ensure n8n has at least one workflow)

# Execute
./tools/scripts/sync-workflows.sh export

# Verify
ls tools/n8n-flows/*.json
# Expected: At least one JSON file appears
```

**Test Case 2: Import Workflows**
```bash
# Setup
# (Ensure tools/n8n-flows/ has JSON files)

# Execute
./tools/scripts/sync-workflows.sh import

# Verify
# Open https://n8n.labs.lair.nntin.xyz/
# Expected: Workflows appear in n8n UI with matching IDs
```

**Test Case 3: Workflow Update (Idempotency)**
```bash
# Execute import twice
./tools/scripts/sync-workflows.sh import
./tools/scripts/sync-workflows.sh import

# Verify
# Open n8n UI and check workflow count
# Expected: No duplicates created, workflows updated in place
```

**Test Case 4: Bidirectional Sync**
```bash
# Setup: Make change in n8n UI (e.g., rename a node)

# Execute
./tools/scripts/sync-workflows.sh sync

# Verify
git diff tools/n8n-flows/
# Expected: Changed workflow appears in git diff
```

---

### Testing via n8n UI

**After Import:**
1. Open `https://n8n.labs.lair.nntin.xyz/`
2. Navigate to imported workflow
3. Click "Test Workflow" or "Execute Workflow"
4. Review execution results
5. Verify credentials are bound correctly (if applicable)

---

## Error Handling

### Error: Import Fails - "Successfully imported 0 workflows"

**Symptom**: Command completes but reports 0 workflows imported

**Possible Causes:**
1. No JSON files in `tools/n8n-flows/` directory
2. Invalid JSON syntax in workflow files
3. n8n container not running
4. Incorrect container ID in script

**Resolution:**
```bash
# 1. Check for JSON files
ls tools/n8n-flows/*.json

# 2. Validate JSON syntax
jq . tools/n8n-flows/my-workflow.json

# 3. Verify container is running
docker ps | grep n8n

# 4. If container ID changed, update script
docker ps | grep n8n  # Copy new container ID
# Edit tools/scripts/sync-workflows.sh, update CONTAINER_ID
```

**Prevention**: Keep `tools/n8n-flows/` populated and validate JSON before committing.

---

### Error: Export Fails - No files created

**Symptom**: Export command completes but no files appear in `tools/n8n-flows/`

**Possible Causes:**
1. n8n has no workflows to export (empty instance)
2. Permissions issue (cannot write to `tools/n8n-flows/`)
3. Container not running
4. Wrong container ID

**Resolution:**
```bash
# 1. Check n8n UI for workflows
# Open https://n8n.labs.lair.nntin.xyz/

# 2. Check permissions
ls -la tools/n8n-flows/
chmod u+w tools/n8n-flows/

# 3. Verify container
docker ps | grep n8n

# 4. Check script permissions
chmod +x tools/scripts/sync-workflows.sh
```

**Prevention**: Regularly export to catch issues early.

---

### Error: Workflow Not Updating After Import

**Symptom**: Changes in JSON don't appear in n8n after running import

**Possible Causes:**
1. Wrong workflow ID (creating new workflow instead of updating existing)
2. Cached view in n8n UI (browser cache)
3. Different `versionId` causing conflict

**Resolution:**
```bash
# 1. Verify ID matches
cat tools/n8n-flows/my-workflow.json | grep '"id"'
# Compare with n8n UI workflow ID

# 2. Hard refresh n8n UI
# Press Ctrl+Shift+R in browser

# 3. Export to see actual n8n state
./tools/scripts/sync-workflows.sh export
git diff tools/n8n-flows/
```

**Prevention**: Always use consistent workflow IDs, never change ID of existing workflow.

---

### Error: "Container not found"

**Symptom**: Script fails with error about container not existing

**Resolution:**
```bash
# Find new container ID
docker ps | grep n8n

# Copy container ID (long hash)

# Edit script
# Update CONTAINER_ID variable in tools/scripts/sync-workflows.sh
```

---

### Error: "n8n command not found"

**Symptom**: Script fails when trying to run n8n CLI

**Resolution:**
```bash
# Verify n8n CLI exists in container
docker exec <container-id> which n8n
docker exec <container-id> n8n --version

# If not found, n8n installation in container is broken
# Restart container or rebuild image
```

---

## Edge Cases

**Edge Case 1: Workflow with missing credentials**
- **Condition**: Import workflow that references credential not yet created in n8n
- **Behavior**: Import succeeds, execution fails with "Credential not found" error
- **Rationale**: Credentials are managed separately; workflow structure is valid

**Edge Case 2: Workflow ID collision**
- **Condition**: Import workflow with ID that already exists but has different content
- **Behavior**: Existing workflow is updated (replaced) with new content
- **Rationale**: ID is primary key; reimporting is an update operation

**Edge Case 3: Empty tools/n8n-flows/ directory**
- **Condition**: Run import when no JSON files exist
- **Behavior**: Import completes successfully, reports 0 workflows imported
- **Rationale**: Valid operation (nothing to import)

**Edge Case 4: Export after manual deletion in n8n**
- **Condition**: Delete workflow in n8n UI, then export
- **Behavior**: Corresponding JSON file is NOT deleted from git (export only adds/updates)
- **Rationale**: Export is non-destructive; manual git cleanup required

**Edge Case 5: Large workflow files**
- **Condition**: Workflow JSON > 1MB (many nodes, complex logic)
- **Behavior**: Import/export may be slow but should succeed
- **Rationale**: n8n handles large workflows; docker cp has no practical size limit

---

## Performance Considerations

**Expected Load:**
- Typically < 20 workflows in repository
- Each workflow ~ 1-50 KB JSON
- Total transfer < 1MB per operation

**Timeouts:**
- Export: ~5-10 seconds for 10 workflows
- Import: ~5-10 seconds for 10 workflows
- No explicit timeout (relies on docker/n8n timeouts)

**Rate Limiting:**
- None (local operations only)
- Safe to run repeatedly

**Optimization Opportunities (future):**
- Use volume mount instead of `docker cp` for faster transfer
- Parallel import/export (if n8n CLI supports batch operations)
- Incremental sync (only changed files)

---

## Monitoring & Logging

**What Gets Logged:**
- Currently: stdout/stderr from script (basic success/failure messages)
- n8n CLI output (number of workflows imported/exported)

**Log Location:**
- Console output only (not persisted to file)
- Future: Consider logging to `.tmp/sync-logs/sync-YYYY-MM-DD-HH-MM-SS.log`

**Log Format:**
```
Exporting workflows from n8n to git...
Successfully exported 3 workflows to tools/n8n-flows/
```

**Alerts/Notifications:**
- None currently
- Future: Discord notification on sync failures

---

## Common Workflows

### Workflow 1: First Time Setup (Deploy to Fresh n8n Instance)

```bash
# 1. Ensure n8n container is running
docker ps | grep n8n

# 2. Create required credentials in n8n UI
# (e.g., GitHub token, Discord webhook URL, etc.)

# 3. Import all workflows from git
./tools/scripts/sync-workflows.sh import

# 4. Open n8n UI and verify workflows appear
# https://n8n.labs.lair.nntin.xyz/

# 5. Test each workflow (keep inactive until tested)

# 6. Activate workflows as needed
```

---

### Workflow 2: Create New Workflow

```bash
# 1. Write SOP in workflows/
# (e.g., workflows/n8n-webhook/my-new-workflow.md)

# 2. Generate/author workflow JSON with explicit ID
# Save to tools/n8n-flows/my-new-workflow-v1.json

# 3. Deploy to n8n
./tools/scripts/sync-workflows.sh import

# 4. Test in n8n UI
# Open workflow, click "Test Workflow"

# 5. Export to capture any n8n-generated metadata
./tools/scripts/sync-workflows.sh export

# 6. Commit both SOP and JSON to git
git add workflows/ tools/n8n-flows/
git commit -m "feat: add my-new-workflow"
```

---

### Workflow 3: Update Existing Workflow

```bash
# 1. Edit workflow JSON in tools/n8n-flows/
vim tools/n8n-flows/my-workflow-v1.json

# 2. Deploy changes
./tools/scripts/sync-workflows.sh import

# 3. Test in n8n UI

# 4. If satisfied, commit changes
git add tools/n8n-flows/my-workflow-v1.json
git commit -m "fix: update my-workflow validation logic"
```

---

### Workflow 4: Capture Manual UI Changes

```bash
# 1. Make changes in n8n UI
# (e.g., add nodes, change parameters, bind credentials)

# 2. Export to git
./tools/scripts/sync-workflows.sh export

# 3. Review changes
git diff tools/n8n-flows/

# 4. If changes are desired, commit
git add tools/n8n-flows/
git commit -m "chore: capture UI changes to my-workflow"

# 5. If changes were experimental, discard
git checkout tools/n8n-flows/
```

---

### Workflow 5: Restore from Backup (Disaster Recovery)

```bash
# Scenario: n8n database corrupted, workflows lost

# 1. Verify git has latest workflows
ls tools/n8n-flows/*.json

# 2. Import all workflows from git
./tools/scripts/sync-workflows.sh import

# 3. Verify in n8n UI
# All workflows should reappear with same IDs

# 4. Recreate credentials manually (not stored in git)
# Check SOPs for required credentials

# 5. Test workflows
```

---

### Workflow 6: Troubleshoot Failed Execution

```bash
# Workflow executes in n8n but fails

# 1. Check workflow in n8n UI for error message

# 2. Export current state to git
./tools/scripts/sync-workflows.sh export

# 3. Review JSON for issues
cat tools/n8n-flows/my-workflow-v1.json

# 4. Check for missing credentials
# Look for credential references in JSON

# 5. Fix in git or n8n UI, then re-sync
```

---

## Integration Points

**Upstream Dependencies:**
- n8n instance must be running
- Docker daemon must be accessible
- Git repository must be initialized

**Downstream Consumers:**
- n8n UI (displays imported workflows)
- n8n execution engine (runs workflows)
- Other workflows that depend on imported workflows

**Data Flow Diagram:**
```
Git (tools/n8n-flows/*.json)
    ↓ [import]
n8n Container (/tmp/n8n-import/)
    ↓ [n8n import:workflow]
n8n Database (workflow definitions)
    ↓ [n8n export:workflow]
n8n Container (/tmp/n8n-export/)
    ↓ [export]
Git (tools/n8n-flows/*.json)
```

---

## Rollback Procedure

If sync causes issues in n8n:

```bash
# 1. Identify last known good state in git
git log --oneline tools/n8n-flows/

# 2. Checkout previous version
git checkout <commit-hash> tools/n8n-flows/

# 3. Re-import to restore n8n state
./tools/scripts/sync-workflows.sh import

# 4. Verify in n8n UI
# Workflows should revert to previous state

# 5. If satisfied, commit the revert
git commit -m "revert: rollback workflows to <commit-hash>"

# 6. If not satisfied, restore current state
git checkout HEAD tools/n8n-flows/
./tools/scripts/sync-workflows.sh import
```

---

## Future Improvements

- [ ] Add verbose logging mode (`--verbose` flag)
- [ ] Persist logs to `.tmp/sync-logs/`
- [ ] Add `--dry-run` flag to preview changes without executing
- [ ] Implement volume mount for faster file transfer (requires docker-compose changes)
- [ ] Add workflow validation before import (JSON schema validation)
- [ ] Support selective import/export (`--workflow-id=<id>`)
- [ ] Discord notification on sync failures
- [ ] CI/CD integration (auto-sync on git push)
- [ ] Credential backup/restore (if possible without exposing secrets)
- [ ] Incremental sync (only changed workflows)

---

## Related Documentation

- **Architecture Decision**: `gsnake-specs/n8n/architecture-decision.md` - Why n8n CLI over docker volumes
- **Test Findings**: `gsnake-specs/n8n/test-findings.md` - Verified behaviors of import/export
- **Updates Log**: `gsnake-specs/n8n/UPDATES.md` - Recent changes and decisions
- **WAT Framework**: `gsnake-n8n/CLAUDE.md` - Agent instructions for WAT architecture
- **n8n Documentation**: [n8n CLI Reference](https://docs.n8n.io/hosting/cli-commands/)

---

## Changelog

**2026-02-07**: Updated SOP to follow template.md structure, added comprehensive sections
**2024-XX-XX**: Initial creation of sync script and basic documentation

---

## Implementation Checklist

- [x] Prerequisites met (Docker, n8n container, file permissions)
- [x] Tool created at `tools/scripts/sync-workflows.sh`
- [x] Manual testing completed (export, import, sync)
- [x] Error handling tested (container not found, no workflows, etc.)
- [x] Security review completed (credentials not exported)
- [x] Documentation updated (this SOP + CLAUDE.md)
- [x] Committed to git
- [x] Deployed and verified in production
- [x] Frontmatter updated: `implementation_status: implemented`
