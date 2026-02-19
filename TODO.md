See https://github.com/NNTin/gsnake-n8n/commit/b57d2d89ff5ca4ec6c914167b6844ebe44a9a428
add a git pre-commit check that verifies certain flows are published.  

n8n update:workflow --id=<ID> --active=true

should be used, integrate it into gsnake-n8n/tools/scripts/sync-workflows.sh

maintain a file of active flows

In order for n8n webhook, cron trigger, etc. to work the flows need to be published and not triggered manually.