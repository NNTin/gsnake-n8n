# Agent Instructions

You're working inside the **WAT framework** (Workflows, Agents, Tools). This architecture separates concerns so that probabilistic AI handles reasoning while deterministic code handles execution. That separation is what makes this system reliable.

## The WAT Architecture

**Layer 1: Workflows (The Instructions)**
- Markdown SOPs stored in `workflows/`  
- Each workflow defines the objective, required inputs, which tools to use, expected outputs, and how to handle edge cases
- Written in plain language, the same way you'd brief someone on your team

**Layer 2: Agents (The Decision-Maker)**
- This is your role. You're responsible for intelligent coordination.
- Read the relevant workflow, run tools in the correct sequence, handle failures gracefully, and ask clarifying questions when needed
- You connect intent to execution without trying to do everything yourself
- Example: If you need to sync n8n-flows with self-hosted n8n instance, read `workflows/infra/n8n-sync.md`, then use the `tools/scripts/sync-workflows.sh` script (import/export/sync commands).

**Layer 3: Tools (The Execution)**
- n8n workflows in `tools/n8n-flows/` that implement the SOPs
- Shell scripts in `tools/scripts/` for deployment and management
- API calls, data transformations, file operations, database queries, webhook endpoints
- Credentials and API keys are stored in `.env` and n8n credential system
- These tools are consistent, testable, and fast

**Why this matters:** When AI tries to handle every step directly, accuracy drops fast. If each step is 90% accurate, you're down to 59% success after just five steps. By offloading execution to deterministic scripts, you stay focused on orchestration and decision-making where you excel.

## How to Operate

**1. Look for existing tools first**
Before building anything new, check `tools/` based on what your workflow requires. Only create new scripts when nothing exists for that task.

**2. Learn and adapt when things fail**
When you hit an error:
- Read the full error message and trace
- Fix the script and retest
- Document what you learned in the workflow (timing quirks, unexpected behavior)
- Example: You get rate-limited on an API, so you dig into the docs, discover a batch endpoint, refactor the tool to use it, verify it works, then update the workflow so this never happens again

**3. Keep workflows current**
Workflows should evolve as you learn. When you find better methods, discover certain contraints, or encounter recurring issues, update the workflow. That said, don't create or overwrite workflows without asking unless I explicitely tell you to. These are your instructions and need to be preserved and refined, not tossed after one use.

**4. Use the template for new SOPs**
When creating a new SOP, start with `workflows/template.md`. The template is structured to capture all information needed for implementation without ambiguity. Fill in all applicable sections - this ensures:
- No critical details are missed (credentials, error handling, security)
- Tools can be implemented without follow-up questions
- Future debugging is easier with comprehensive documentation
- Consistent structure across all SOPs makes the system easier to navigate

## The Self-Improvement Loop

Every failure is a chance to make the system stronger:
1. Identify what broke
2. Fix the tool
3. Verify the fix works
4. Update the workflow with the new approach
5. Move on with a more robust system

This loop is how the framework improves over time.

## File Structure

**What goes where**
- **Deliverables**: Final outputs go to tools/n8n-flows where automations live  
- **Intermediates**: Temporary processing files that can be regenerated

**Directory layout**
```sh
.tmp/                    # temporary files, regenerated as needed
workflows/
  ├── n8n-nodes/         # SOP specs for custom n8n nodes (reusable components)
  ├── n8n-webhook/       # SOP specs for n8n webhook endpoints (external triggers)
  └── infra/             # SOP specs for infrastructure/deployment workflows
tools/
  ├── n8n-flows/         # Implemented n8n workflow JSON files (git-tracked)
  │   ├── {id-1}.json    # Each file = one workflow, named by workflow ID
  │   ├── {id-2}.json
  │   └── CLAUDE.md      # Documentation for n8n-flows
  └── scripts/
      └── sync-workflows.sh  # Sync script (import/export/sync n8n workflows)
.env                     # API keys and environment variables (NEVER store secrets anywhere else)
.mcp.json                # MCP server configuration (n8n-mcp connection)
```

**Core principles:**
- Everything in `.tmp/` is disposable
- **Workflows (SOPs)** in `workflows/*.md` define WHAT to automate (human-readable specs)
- **Tools (JSON)** in `tools/n8n-flows/*.json` implement the SOPs (machine-executable workflows)
- **Sync** between git and n8n using `tools/scripts/sync-workflows.sh`:
  - `./sync-workflows.sh export` - Download workflows from n8n to git
  - `./sync-workflows.sh import` - Deploy workflows from git to n8n
  - `./sync-workflows.sh sync` - Bidirectional sync (export then import)
- Workflow IDs are preserved on import/export (stable, deterministic)
- Filenames = workflow IDs (e.g., `test-id-12345.json`)
- Git is the source of truth; export before modifying in n8n UI

## SOP to Tools Mapping

Each markdown SOP in `workflows/` should have a corresponding implementation in `tools/`.

**Current Status:**

| SOP File | Implementation | Status |
|----------|---------------|--------|
| `workflows/template.md` | **Template for new SOPs** | 📝 Template |
| `workflows/infra/n8n-sync.md` | `tools/scripts/sync-workflows.sh` | ✅ Implemented |
| `workflows/infra/trigger-github-push-event.md` | `tools/scripts/trigger-github-push-event.sh` | ✅ Implemented |
| `workflows/n8n-webhook/notify-discord.md` | `tools/n8n-flows/github-discord-notify.json` | ✅ Implemented (HMAC validation working) |
| `workflows/n8n-workflow/dispatch-github-ci-and-capture-result.md` | `tools/n8n-flows/github-ci-dispatch-result.json` | ✅ Implemented |

**When creating new workflows:**
1. **Copy the template**: Start with `workflows/template.md` as your base
   - Fill in the YAML frontmatter (implementation_status, tool_type, tool_location, etc.)
   - Complete all relevant sections - the template ensures no critical information is missing
   - Delete sections that don't apply (e.g., if not using webhooks, remove webhook-specific sections)
   - The template is designed so tools can be implemented without open questions
2. **Save your SOP** in the appropriate subdirectory:
   - `workflows/n8n-webhook/` for webhook endpoints
   - `workflows/n8n-nodes/` for custom node specs
   - `workflows/infra/` for infrastructure/deployment workflows
3. **Generate/author the implementation** (n8n workflow JSON or shell script)
4. **Save to tools/** at the location specified in your SOP's frontmatter
   - n8n workflows: `tools/n8n-flows/{workflow-id}.json`
   - Scripts: `tools/scripts/{script-name}.sh`
5. **Deploy** (for n8n workflows): Run `./tools/scripts/sync-workflows.sh import`
6. **Test** via n8n MCP server, UI, or direct execution
7. **Update the SOP** with any learnings from implementation/testing
8. **Update frontmatter**: Set `implementation_status: implemented` and `last_updated`
9. **Commit** both SOP and implementation to git

**Note**: The old docker volume sync approach (mounting n8n data directory) has been replaced with n8n CLI import/export. See `gsnake-specs/n8n/architecture-decision.md` for details.

---

## n8n Workflow Management

### Sync Script Usage

```bash
# Export workflows from n8n to git (backup current state)
./tools/scripts/sync-workflows.sh export

# Import workflows from git to n8n (deploy changes)
./tools/scripts/sync-workflows.sh import

# Full sync (export then import - captures manual changes, then restores git as source of truth)
./tools/scripts/sync-workflows.sh sync
```

### Key Technical Details

**Workflow ID Preservation:**
- IDs from JSON are preserved on import (no regeneration)
- Reimporting with same ID updates workflow in place (idempotent)
- Use workflow ID as filename for stability

**File Format:**
- One JSON file per workflow in `tools/n8n-flows/`
- Filename = workflow ID (e.g., `test-id-12345.json`)
- Pretty-printed for git diffs
- Contains complete workflow definition (nodes, connections, settings)

**Credentials:**
- Stored in n8n credential system (not in JSON files)
- Referenced by name in workflows (e.g., `$credentials.github_token`)
- Manual one-time setup in n8n UI required
- After binding credentials, export to capture changes

**Environment Variables:**
- Access in workflows via `{{ $env.VARIABLE_NAME }}`
- Must be set in n8n environment (docker-compose, .env, etc.)
- Common pattern: Store secrets in .env, reference in n8n
- **Important**: Variable names are case-sensitive
- Example: `{{ $env.N8N_WEBHOOK_SECRET }}`

**Webhook Data Structure:**
- Webhook node wraps data under `$json.body` (not `$json` directly)
- Headers accessible via `$json.headers`
- Query params via `$json.query`
- URL params via `$json.params`
- **Critical**: Always access webhook payload via `$json.body.fieldName`

**Code Nodes:**
- Use `$input.all()` for all items (recommended for most cases)
- Use `$input.first()` for single item access
- Must return array format: `[{json: {...}}]`
- Can use Node.js built-ins: `crypto`, `fs`, `path`
- Use `console.log()` for debugging (visible in n8n execution logs)
- Set `continueOnFail: true` for non-critical nodes

**File Operations in Code Nodes:**
- Paths are relative to n8n container working directory
- Use `fs.mkdirSync(path, {recursive: true})` to create directories
- Wrap in try-catch for error handling
- Consider using Write Binary node for simpler file operations

**Testing:**
- Workflows imported as `active: false` by default
- Must activate in n8n UI before webhook endpoints become available
- Use n8n MCP server to execute workflows programmatically
- Or test manually in n8n UI
- Always test after import before activating
- Webhook endpoints: `https://n8n-host/webhook/path-name`

### Deleting Workflows from n8n

Since n8n CLI doesn't have a delete command, use the REST API:

```bash
# Login and get session cookie
N8N_HOST="https://n8n.labs.lair.nntin.xyz"
COOKIE_FILE=$(mktemp)
curl -s -c "$COOKIE_FILE" -X POST "${N8N_HOST}/rest/login" \
  -H "Content-Type: application/json" \
  -d "{\"emailOrLdapLoginId\":\"$N8N_EMAIL\",\"password\":\"$N8N_PASSWORD}\"}"

# Delete workflow by ID
WORKFLOW_ID="workflow-id-here"
curl -s -b "$COOKIE_FILE" -X DELETE "${N8N_HOST}/rest/workflows/${WORKFLOW_ID}"

# Cleanup
rm -f "$COOKIE_FILE"
```

**Note**: Login requires `emailOrLdapLoginId` field, not `email`. Successful delete returns `{"data":true}`.

### n8n Workflow Implementation Best Practices

When implementing n8n workflows from SOPs:

**1. Node Configuration:**
- Use descriptive node names that match SOP sections
- Set `typeVersion` to latest for each node type (check n8n docs)
- Use `runOnceForAllItems` mode for Code nodes (default, most efficient)
- Position nodes left-to-right in execution order (x: 250, 450, 650, ...)

**2. Environment Variables:**
- Always use `{{ $env.VAR_NAME }}` syntax, never hardcode secrets
- Verify .env variable names match workflow references exactly
- Document required env vars in SOP Prerequisites section

**3. Error Handling:**
- Use `continueOnFail: true` for non-critical nodes (logging, notifications)
- Add try-catch in Code nodes for external API calls or file operations
- Return meaningful error messages in response nodes

**4. Webhook Workflows:**
- Set `responseMode: "onReceived"` for async processing (fire-and-forget)
- Set `responseMode: "lastNode"` for synchronous responses
- Always validate webhook data early (signature, required fields)
- Remember: webhook data is under `$json.body`, not `$json`

**5. Code Node Patterns:**
- Access headers: `$input.first().json.headers['header-name']`
- Access body: `$input.first().json.body.fieldName`
- Reference other nodes: `$node["Node Name"].json`
- Always return `[{json: {...}}]` format

**6. Testing Strategy:**
- Import workflow → Activate in UI → Test webhook endpoint
- Test localhost first (bypass auth) then production (with auth)
- Verify all paths (success, validation failure, error cases)
- Check n8n execution logs for errors

**7. File Operations:**
- Paths in Code nodes are relative to n8n container
- Create directories with `{recursive: true}` option
- Use try-catch and log errors
- Consider absolute paths or env vars for portability

---

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.  
The credential for n8n login can be found at gsnake-n8n/.env

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Bottom Line
You sit between what I want (workflows) and what actually gets done (tools). Your job is to read instructions, make smart decisions, call the right tools, recover from errors, and keep improving the system as you go.

Stay pragmatic. Stay reliable. Keep learning.
