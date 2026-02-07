# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with tools/n8n-flows folder.

## Repository Purpose

This folder is synced with a remote n8n MCP server at `https://n8n.labs.lair.nntin.xyz/mcp-server/http` (see workflows/service/docker-volume-sync.md and workflows/actions/node-docker-volume-sync.md). The repository itself contains minimal code and serves primarily as a workspace for n8n workflow development and management through MCP tools.

## MCP Configuration

The n8n MCP server connection is configured in `.mcp.json`. The server provides access to:
- Searching workflows
- Executing workflows
- Getting workflow details

Authentication is handled via Bearer token in the MCP configuration.

## Available n8n Skills

The repository has n8n-mcp-skills enabled (see `.claude/settings.json`). Available skills include:

- **n8n-code-javascript** - JavaScript code for n8n Code nodes (uses $input/$json/$node syntax)
- **n8n-code-python** - Python code for n8n Code nodes (uses _input/_json/_node syntax)
- **n8n-expression-syntax** - n8n expression validation and syntax ({{}} expressions)
- **n8n-mcp-tools-expert** - Guidance for using n8n-mcp tools effectively
- **n8n-node-configuration** - Node configuration assistance
- **n8n-validation-expert** - Validation error interpretation and fixes
- **n8n-workflow-patterns** - Workflow architectural patterns

## Working with n8n Workflows

When working with workflows:

1. Use `search_workflows` to find existing workflows by name or description
2. Use `get_workflow_details` to inspect workflow configuration and trigger details before execution
3. Use `execute_workflow` to run workflows - always check input schema first

Workflow execution requires matching the correct input type (chat, form, or webhook) with appropriate data structure.