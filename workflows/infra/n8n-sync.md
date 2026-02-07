# n8n Workflow Synchronization

## Objective

Synchronize n8n workflow JSON files between the git repository and the self-hosted n8n instance using n8n CLI commands.

This ensures:
- Git is the source of truth for workflow definitions
- Manual changes in n8n UI can be captured back to git
- Workflows can be deployed consistently across environments
- Version control and audit trail for all workflow changes

## Implementation

**Tool**: `tools/scripts/sync-workflows.sh`

**Underlying Technology**: n8n CLI (`import:workflow`, `export:workflow`) accessed via `docker exec`

## Commands

### Export (n8n → Git)

Backup workflows from n8n instance to git repository.

```bash
./tools/scripts/sync-workflows.sh export
```

**When to use:**
- After making manual changes in n8n UI
- Before major refactoring (create backup point)
- To capture newly created workflows
- Regular backups (e.g., daily, before deployments)

**What it does:**
1. Creates temp directory in n8n container
2. Runs `n8n export:workflow --backup --output=/tmp/`
3. Copies exported JSON files to `tools/n8n-flows/`
4. Cleans up temp directory

**Output:**
- One JSON file per workflow in `tools/n8n-flows/`
- Files named by workflow ID (e.g., `test-id-12345.json`)
- Pretty-printed JSON (git-friendly)

---

### Import (Git → n8n)

Deploy workflows from git repository to n8n instance.

```bash
./tools/scripts/sync-workflows.sh import
```

**When to use:**
- After generating/authoring new workflow JSON
- After updating existing workflow JSON
- To restore workflows from git backup
- Initial deployment to fresh n8n instance

**What it does:**
1. Copies all JSON files from `tools/n8n-flows/` to container temp directory
2. Runs `n8n import:workflow --separate --input=/tmp/`
3. Cleans up temp directory

**Behavior:**
- **New workflow** (ID doesn't exist): Creates new workflow
- **Existing workflow** (ID matches): Updates workflow in place
- **Idempotent**: Safe to run multiple times

---

### Sync (Bidirectional)

Combines export and import to ensure git and n8n are synchronized.

```bash
./tools/scripts/sync-workflows.sh sync
```

**When to use:**
- After making changes in both git and n8n UI
- To reconcile divergent states
- Periodic synchronization (e.g., at start/end of work session)

**What it does:**
1. **Export first** - Captures any manual n8n UI changes to git
2. **Import second** - Ensures git version is deployed to n8n

**Effect:**
- Git becomes source of truth
- Manual changes are preserved but then overwritten if git differs
- Use with caution if unsure about git vs n8n state

---

## Workflow ID Preservation

**Key Behavior**: Workflow IDs from JSON files are preserved on import.

**Implications:**
- Generate JSON with explicit ID: `"id": "notify-discord-v1"`
- Reimporting with same ID updates existing workflow (no duplicate)
- Filename = workflow ID for stability (e.g., `notify-discord-v1.json`)

**If ID is missing:**
- n8n assigns random ID on import
- Must export after import to capture assigned ID
- Update git with exported JSON containing n8n-generated ID

**Best Practice**: Always specify IDs when generating workflows.

---

## File Format

Each workflow is a JSON file in `tools/n8n-flows/`:

```json
{
  "id": "workflow-unique-id",           // Preserved on import
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

## Credentials

**Important**: Credentials are NOT stored in JSON files.

**How it works:**
1. Credentials are managed in n8n's credential system (stored separately)
2. Workflows reference credentials by NAME in JSON:
   ```json
   {
     "type": "n8n-nodes-base.webhook",
     "credentials": {
       "githubApi": {
         "id": "credential-uuid",
         "name": "github_token"
       }
     }
   }
   ```
3. Actual credential values (API keys, tokens) are stored in n8n database

**Workflow:**
1. Create credential in n8n UI (one-time setup)
2. Reference credential name in workflow JSON
3. Import workflow (credential binding is preserved)
4. Test workflow to verify credential access

**Missing credentials:**
- Workflow imports successfully
- Execution fails if credential doesn't exist
- Must create credential in n8n UI before workflow can run

---

## Testing Workflows

After import, test workflows before activating:

### Option 1: n8n UI
1. Open `https://n8n.labs.lair.nntin.xyz/`
2. Navigate to workflow
3. Click "Test Workflow" or "Execute Workflow"
4. Review execution results

### Option 2: n8n MCP Server
```javascript
// Via MCP server (if available)
execute_workflow({
  workflow_id: "workflow-unique-id",
  input_data: {...}
})
```

### Option 3: Manual Trigger
For webhook workflows:
```bash
curl -X POST https://n8n.labs.lair.nntin.xyz/webhook/path \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

---

## Workflow Activation

**Default**: Import workflows as `"active": false` for safety.

**To activate:**
1. Test workflow thoroughly
2. Set `"active": true` in JSON, OR
3. Activate manually in n8n UI
4. Export to capture activation state

**Safety consideration**: Active workflows with webhooks/triggers will execute automatically. Always test inactive first.

---

## Common Workflows

### Create New Workflow
```bash
# 1. Write SOP in workflows/n8n-webhook/my-workflow.md or workflows/n8n-nodes/my-node.md
# 2. Generate/author workflow JSON
# 3. Save to tools/n8n-flows/my-workflow-id.json
# 4. Deploy to n8n
./tools/scripts/sync-workflows.sh import

# 5. Test in n8n UI
# 6. Export to capture any n8n-generated metadata
./tools/scripts/sync-workflows.sh export

# 7. Commit both SOP and JSON to git
git add workflows/ tools/n8n-flows/
git commit -m "feat: add my-workflow"
```

### Update Existing Workflow
```bash
# 1. Update workflow JSON in tools/n8n-flows/
# 2. Deploy changes
./tools/scripts/sync-workflows.sh import

# 3. Test
# 4. Commit changes
git add tools/n8n-flows/
git commit -m "fix: update my-workflow logic"
```

### Capture Manual UI Changes
```bash
# 1. Make changes in n8n UI
# 2. Export to git
./tools/scripts/sync-workflows.sh export

# 3. Review changes
git diff tools/n8n-flows/

# 4. Commit if desired
git add tools/n8n-flows/
git commit -m "chore: capture UI changes to my-workflow"
```

### Restore from Backup
```bash
# If n8n state is broken, restore from git
./tools/scripts/sync-workflows.sh import

# This recreates all workflows from tools/n8n-flows/
```

---

## Error Handling

### Import Fails
**Symptom**: "Successfully imported 0 workflows" or error message

**Possible causes:**
1. No JSON files in `tools/n8n-flows/`
2. Invalid JSON syntax
3. n8n container not running
4. Incorrect container ID in script

**Resolution:**
- Check `tools/n8n-flows/` has `.json` files
- Validate JSON syntax: `jq . tools/n8n-flows/file.json`
- Verify container: `docker ps | grep n8n`
- Update container ID in script if needed

### Export Fails
**Symptom**: No files created or error message

**Possible causes:**
1. n8n has no workflows to export
2. Permissions issue
3. Container not running

**Resolution:**
- Check n8n UI for workflows
- Verify container: `docker ps | grep n8n`
- Check script permissions: `chmod +x tools/scripts/sync-workflows.sh`

### Workflow Not Updating
**Symptom**: Changes in JSON don't appear in n8n after import

**Possible causes:**
1. Wrong workflow ID (creating new instead of updating)
2. Cached view in n8n UI

**Resolution:**
- Verify ID matches: compare JSON `"id"` field with n8n UI
- Refresh n8n UI (hard refresh: Ctrl+Shift+R)
- Export to see actual n8n state

---

## Architecture

**File Transfer Method**: `docker cp`
- Copies files between host and container
- No docker-compose changes required
- Explicit, safe operations

**Alternative Considered**: Volume mount
- Would be faster
- Requires docker-compose modification
- Deferred for future optimization

**Container Access**:
```bash
# Script uses this container ID
CONTAINER_ID="440742681e58b8049db5f7541c5ce24312bd348662e6a68bab55720f7d16d30e"

# If container is recreated, update in sync-workflows.sh
docker ps | grep n8n
```

---

## Best Practices

1. **Always export before major changes** - Create restore point
2. **Test imported workflows** - Don't activate untested workflows
3. **Commit JSON after export** - Capture n8n-generated metadata
4. **Use descriptive workflow IDs** - e.g., `notify-discord-v1`, not random UUIDs
5. **Keep SOPs in sync** - Update markdown docs when JSON changes
6. **Review diffs before commit** - Ensure changes are intentional
7. **Export after credential binding** - Capture credential references

---

## Related Documentation

- **Architecture Decision**: `gsnake-specs/n8n/architecture-decision.md` - Why this approach
- **Test Findings**: `gsnake-specs/n8n/test-findings.md` - Verified behaviors
- **Updates Log**: `gsnake-specs/n8n/UPDATES.md` - Recent changes
- **CLAUDE.md**: Main agent instructions for WAT framework

---

## Troubleshooting

### "Container not found"
Update container ID in script:
```bash
docker ps | grep n8n
# Copy container ID
# Edit tools/scripts/sync-workflows.sh
# Update CONTAINER_ID variable
```

### "n8n command not found"
Verify n8n CLI in container:
```bash
docker exec <container-id> which n8n
docker exec <container-id> n8n --version
```

### Workflows out of sync
Run bidirectional sync:
```bash
./tools/scripts/sync-workflows.sh sync
```

### Need to see raw n8n CLI output
Run commands manually:
```bash
CONTAINER_ID="440742681e58b8049db5f7541c5ce24312bd348662e6a68bab55720f7d16d30e"

# Export
docker exec $CONTAINER_ID n8n export:workflow --backup --output=/tmp/test/
docker cp $CONTAINER_ID:/tmp/test/. ./backup/

# Import
docker cp ./tools/n8n-flows/. $CONTAINER_ID:/tmp/import/
docker exec $CONTAINER_ID n8n import:workflow --separate --input=/tmp/import/
```
