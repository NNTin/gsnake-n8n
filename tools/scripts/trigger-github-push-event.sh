#!/bin/bash
set -e

# Trigger GitHub Push Event
# Dispatches the counter.yml workflow on NNTin/test repository
# Usage: ./trigger-github-push-event.sh [ref]

# Configuration
REPO_OWNER="NNTin"
REPO_NAME="test"
WORKFLOW_FILE="counter.yml"
DEFAULT_REF="master"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Parse arguments
REF="${1:-$DEFAULT_REF}"

# Validate prerequisites
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}✗ Error: GITHUB_TOKEN not set${NC}"
    echo "Set it in .env or export it manually:"
    echo "  source .env"
    echo "  export GITHUB_TOKEN=your_token"
    exit 1
fi

# GitHub API endpoint
API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches"

# Make API request
echo "Triggering workflow dispatch..."
echo "Repository: ${REPO_OWNER}/${REPO_NAME}"
echo "Workflow: ${WORKFLOW_FILE}"
echo "Ref: ${REF}"
echo ""

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "Content-Type: application/json" \
    -d "{\"ref\":\"${REF}\"}" \
    "${API_URL}")

# Check response
if [ "$HTTP_CODE" -eq 204 ]; then
    echo -e "${GREEN}✓ Workflow dispatch triggered successfully${NC}"
    echo "Workflow will run on ref: ${REF}"
    echo "GitHub Actions: https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
    exit 0
else
    echo -e "${RED}✗ Failed to trigger workflow dispatch${NC}"
    echo "HTTP Status Code: ${HTTP_CODE}"

    # Provide specific error messages
    case $HTTP_CODE in
        401)
            echo "Error: Unauthorized - Check your GITHUB_TOKEN"
            ;;
        404)
            echo "Error: Not Found - Check repository or workflow file path"
            ;;
        403)
            echo "Error: Forbidden - Token may lack required permissions or rate limited"
            ;;
        *)
            echo "Error: Unexpected response from GitHub API"
            ;;
    esac

    exit 2
fi
