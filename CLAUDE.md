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
| `workflows/infra/n8n-sync.md` | `tools/scripts/sync-workflows.sh` | ✅ Implemented |
| `workflows/n8n-webhook/notify-discord.md` | `tools/n8n-flows/{workflow-id}.json` | ⏳ To be created |

**When creating new workflows:**
1. Write/update the SOP in `workflows/` (define WHAT and WHY)
2. Generate/author n8n workflow JSON
3. Save to `tools/n8n-flows/{workflow-id}.json`
4. Run `./tools/scripts/sync-workflows.sh import` to deploy
5. Test via n8n MCP server or UI
6. Commit both SOP and JSON to git

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

**Testing:**
- Use n8n MCP server to execute workflows programmatically
- Or test manually in n8n UI
- Always test after import before activating

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
