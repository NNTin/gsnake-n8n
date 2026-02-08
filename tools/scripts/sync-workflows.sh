#!/bin/bash
# Sync workflows between git repository and n8n instance
#
# Usage:
#   ./sync-workflows.sh import    # Deploy workflows from git to n8n
#   ./sync-workflows.sh export    # Backup workflows from n8n to git
#   ./sync-workflows.sh sync      # Export then import (capture manual changes, then ensure git is source of truth)
#
# Architecture:
#   - Uses n8n CLI (import:workflow, export:workflow) inside the container
#   - File transfer via docker cp
#   - Workflows stored as separate JSON files named by workflow ID
#   - Import is idempotent (reimporting with same ID updates in place)

set -e  # Exit on error

# Configuration
CONTAINER_ID="n8n"  # Use container name instead of ID (survives restarts)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLOWS_DIR="$SCRIPT_DIR/../n8n-flows"
CONTAINER_TMP="/tmp/n8n-sync-$$"  # Unique temp dir per script invocation

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary directory in container..."
    docker exec "$CONTAINER_ID" rm -rf "$CONTAINER_TMP" 2>/dev/null || true
}

# Ensure cleanup on exit
trap cleanup EXIT

# Check if container is running
check_container() {
    if ! docker inspect "$CONTAINER_ID" > /dev/null 2>&1; then
        log_error "Container $CONTAINER_ID not found"
        exit 1
    fi

    if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_ID")" != "true" ]; then
        log_error "Container $CONTAINER_ID is not running"
        exit 1
    fi
}

# Import workflows from git to n8n
import_workflows() {
    log_info "Importing workflows from $FLOWS_DIR to n8n..."

    # Check if flows directory exists and has JSON files
    if [ ! -d "$FLOWS_DIR" ]; then
        log_error "Flows directory not found: $FLOWS_DIR"
        exit 1
    fi

    local json_count=$(find "$FLOWS_DIR" -maxdepth 1 -name "*.json" -type f | wc -l)
    if [ "$json_count" -eq 0 ]; then
        log_warning "No JSON files found in $FLOWS_DIR"
        return 0
    fi

    log_info "Found $json_count workflow file(s) to import"

    # Create temp directory in container
    docker exec "$CONTAINER_ID" mkdir -p "$CONTAINER_TMP"

    # Copy all JSON files from host to container
    log_info "Copying workflows to container..."
    docker cp "$FLOWS_DIR/." "$CONTAINER_ID:$CONTAINER_TMP/"

    # Import workflows using n8n CLI
    log_info "Running n8n import:workflow..."
    docker exec "$CONTAINER_ID" n8n import:workflow --separate --input="$CONTAINER_TMP"

    log_success "Import completed"
}

# Export workflows from n8n to git
export_workflows() {
    log_info "Exporting workflows from n8n to $FLOWS_DIR..."

    # Ensure flows directory exists
    mkdir -p "$FLOWS_DIR"

    # Create temp directory in container
    docker exec "$CONTAINER_ID" mkdir -p "$CONTAINER_TMP"

    # Export workflows using n8n CLI with --backup flag
    # (--backup = --all --pretty --separate)
    log_info "Running n8n export:workflow..."
    docker exec "$CONTAINER_ID" n8n export:workflow --backup --output="$CONTAINER_TMP/"

    # Copy exported files from container to host
    log_info "Copying workflows from container..."
    docker cp "$CONTAINER_ID:$CONTAINER_TMP/." "$FLOWS_DIR/"

    # Count exported files
    local exported_count=$(find "$FLOWS_DIR" -maxdepth 1 -name "*.json" -type f | wc -l)

    log_success "Exported $exported_count workflow(s) to $FLOWS_DIR"
}

# Bidirectional sync
sync_workflows() {
    log_info "Performing bidirectional sync..."
    log_info "Step 1: Export (capture any manual changes in n8n UI)"
    export_workflows
    echo
    log_info "Step 2: Import (ensure git is source of truth)"
    import_workflows
    log_success "Sync completed"
}

# Main script logic
main() {
    check_container

    case "${1:-}" in
        import)
            import_workflows
            ;;
        export)
            export_workflows
            ;;
        sync)
            sync_workflows
            ;;
        *)
            echo "Usage: $0 {import|export|sync}"
            echo ""
            echo "Commands:"
            echo "  import  - Deploy workflows from git to n8n"
            echo "  export  - Backup workflows from n8n to git"
            echo "  sync    - Export then import (capture manual changes, then ensure git is source of truth)"
            exit 1
            ;;
    esac
}

main "$@"
