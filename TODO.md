## Claude.md

see TODO comments in gsnake-n8n/CLAUDE.md

## Fulfill requirements

n8n:
- claude: n8n-mcp-skills
- n8n mcp server
- running n8n instance

secrets:
- GITHUB_WEBHOOK_SECRET for GitHub -> n8n webhook communication (see security)
- GITHUB_TOKEN for n8n -> GitHub Workflow Dispatch communication
- DISCORD_WEBHOOKURL for notification

## Proof of Concept

Getting data from and to n8n instance: gsnake-n8n/workflows/actions/n8n-docker-volume-sync.md  
Working with a limitation due to free and self hosted n8n

Implementing proof of concept n8n workflow gsnake-n8n/workflows/service/n8n-endpoint.md
GitHub push event -> Discord notification