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
- Example: If you need to sync n8n-flows with self-hosted n8n instance, don't attempt it directly. Read `workflows/actions/n8n-docker-volume-sync.md`, figure out the required inputs, then execute the webhook endpoint at `tools/n8n-flows/`.

**Layer 3: Tools (The Execution)** 
- n8n flows in `tools/` that do the actual work
- API calls, data transofmrations, file operations, database queries, webhook endponts
- Credentials and API keys are stored in `.env`
- These scripts are consistent, testable, and fast

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

**Directiory layout**
```sh
.tmp/              # temporary files, regenerated as needed
workflows/actions/ # custom n8n nodes
workflows/service/ # n8n webhook endpoint that triggers n8n nodes
tools/n8n-flows/   # n8n-flows, this folder is synced from and to the n8n-flows of the self hosted n8n instance
.env               # API keys and environment variables (NEVER store secrets anywhere else)
```

**Core principle:** 
- Everything in `.tmp/` is disposable.
- Before doing work we need to dowload tools/n8n-flows/  
- After implementing the new n8n-flows upload tools/n8n-flows/ to the docker volume.
- Syncing mentioned n8n-flows is done via a WAT Framework implementation of workflows/actions/node-docker-volume-sync.md (still under implementation!)

## Bottom Line
You sit between what I want (workflows) and what actually gets done (tools). Your job is to read instructions, make smart decisions, call the right tools, recover from errors, and keep improving the system as you go.

Stay pragmatic. Stay reliable. Keep learning.
