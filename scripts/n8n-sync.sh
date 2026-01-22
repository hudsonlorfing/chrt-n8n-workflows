#!/bin/bash
# n8n Sync Script - Pre-flight checks and synchronization
# Run this BEFORE making any workflow changes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load environment - prefer Doppler, fall back to .env
if command -v doppler &> /dev/null && doppler secrets download --no-file --format env &>/dev/null; then
    eval $(doppler secrets download --no-file --format env)
elif [ -f .env ]; then
    source .env
else
    echo -e "${YELLOW}Warning: No secrets found. Run 'doppler setup' or create .env${NC}"
fi

N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"
CHRT_PROJECT_ID="O7lTivDfRl72aS23"

# Workflow IDs (simple variables instead of associative array for compatibility)
WF_SYNC="r4ICnvhdbQwejSdH"
WF_INGESTION="aLxwvqoSTkZAQ3fq"
WF_OUTREACH="kjjYKQEXv67Vl5MS"
WF_HUBSPOT="a56vnrPo9dsg5mmf"
WF_PIPELINE="dWFsEXELFTJU0W01"

# Workflow files mapping
FILE_SYNC="workflows/chrt-github-workflow-sync.json"
FILE_INGESTION="workflows/linkedin/1.-lead-ingestion-&-icp-scoring.json"
FILE_OUTREACH="workflows/linkedin/2.-linkedin-outreach-(phantombuster).json"
FILE_HUBSPOT="workflows/linkedin/3.-connection-sync-→-hubspot.json"
FILE_PIPELINE="workflows/linkedin/4.-lead-pipeline-monitor.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Check API key
check_api_key() {
    if [ -z "$N8N_API_KEY" ]; then
        echo -e "${RED}Error: N8N_API_KEY not set${NC}"
        echo "Setup Doppler: doppler login && doppler setup"
        echo "Or add to .env: N8N_API_KEY=your-key-here"
        exit 1
    fi
}

# Header
print_header() {
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN}n8n Workflow Sync - $1${NC}"
    echo -e "${CYAN}$(date)${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""
}

# Pull latest from GitHub
git_pull() {
    echo -e "${BLUE}Pulling latest from GitHub...${NC}"
    
    # Check for uncommitted changes (warning only, don't block)
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        echo -e "${YELLOW}⚠ You have uncommitted local changes:${NC}"
        git status --short
        echo ""
    fi
    
    # Check for untracked files
    local untracked=$(git status --porcelain | grep "^??" | wc -l | tr -d ' ')
    if [ "$untracked" -gt 0 ]; then
        echo -e "${YELLOW}⚠ You have $untracked untracked files${NC}"
    fi
    
    git fetch origin 2>/dev/null || true
    
    # Check if behind
    LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "none")
    REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "none")
    
    if [ "$LOCAL" != "$REMOTE" ] && [ "$REMOTE" != "none" ]; then
        echo -e "${YELLOW}Local is behind remote. Consider pulling:${NC}"
        echo "  git pull origin main"
    else
        echo -e "${GREEN}✓ Up to date with GitHub${NC}"
    fi
    echo ""
}

# Check recent executions for errors
check_errors() {
    echo -e "${BLUE}Checking recent executions for errors...${NC}"
    check_api_key
    
    local errors_found=0
    
    # Check each workflow
    for wf_pair in "sync:$WF_SYNC" "ingestion:$WF_INGESTION" "outreach:$WF_OUTREACH" "hubspot:$WF_HUBSPOT" "pipeline:$WF_PIPELINE"; do
        local name="${wf_pair%%:*}"
        local wf_id="${wf_pair#*:}"
        
        # Get last 5 executions
        local response=$(curl -s -X GET \
            "${N8N_BASE_URL}/api/v1/executions?workflowId=${wf_id}&limit=5" \
            -H "X-N8N-API-KEY: ${N8N_API_KEY}")
        
        local error_count=$(echo "$response" | jq '[.data[] | select(.status == "error")] | length' 2>/dev/null || echo "0")
        
        if [ "$error_count" -gt 0 ]; then
            echo -e "${RED}✗ $name: $error_count errors in last 5 executions${NC}"
            errors_found=$((errors_found + error_count))
            
            # Show error IDs
            echo "$response" | jq -r '.data[] | select(.status == "error") | "  - Execution \(.id) at \(.startedAt)"' 2>/dev/null
        else
            echo -e "${GREEN}✓ $name: No recent errors${NC}"
        fi
    done
    
    echo ""
    if [ "$errors_found" -gt 0 ]; then
        echo -e "${YELLOW}⚠ Found $errors_found total errors. Review in n8n UI.${NC}"
    else
        echo -e "${GREEN}✓ All workflows running cleanly${NC}"
    fi
    echo ""
}

# Get workflow status from n8n
get_n8n_status() {
    echo -e "${BLUE}Fetching workflow status from n8n...${NC}"
    check_api_key
    
    for wf_id in "$WF_SYNC" "$WF_INGESTION" "$WF_OUTREACH" "$WF_HUBSPOT" "$WF_PIPELINE"; do
        local response=$(curl -s -X GET \
            "${N8N_BASE_URL}/api/v1/workflows/${wf_id}" \
            -H "X-N8N-API-KEY: ${N8N_API_KEY}")
        
        local wf_name=$(echo "$response" | jq -r '.name' 2>/dev/null)
        local active=$(echo "$response" | jq -r '.active' 2>/dev/null)
        local updated=$(echo "$response" | jq -r '.updatedAt' 2>/dev/null)
        
        if [ "$active" = "true" ]; then
            echo -e "${GREEN}● $wf_name${NC} (active)"
        else
            echo -e "${YELLOW}○ $wf_name${NC} (inactive)"
        fi
        echo "  ID: $wf_id | Updated: $updated"
    done
    echo ""
}

# Download workflow from n8n to local
download_workflow() {
    local wf_id=$1
    local output_file=$2
    
    check_api_key
    
    echo -e "${BLUE}Downloading workflow $wf_id...${NC}"
    
    local response=$(curl -s -X GET \
        "${N8N_BASE_URL}/api/v1/workflows/${wf_id}" \
        -H "X-N8N-API-KEY: ${N8N_API_KEY}")
    
    # Save with formatting
    echo "$response" | jq '.' > "$output_file"
    echo -e "${GREEN}✓ Saved to $output_file${NC}"
}

# Download all workflows from n8n
download_all() {
    echo -e "${BLUE}Downloading all workflows from n8n...${NC}"
    check_api_key
    
    # Sync workflow
    download_workflow "$WF_SYNC" "$FILE_SYNC"
    
    # LinkedIn workflows
    download_workflow "$WF_INGESTION" "$FILE_INGESTION"
    download_workflow "$WF_OUTREACH" "$FILE_OUTREACH"
    download_workflow "$WF_HUBSPOT" "$FILE_HUBSPOT"
    download_workflow "$WF_PIPELINE" "$FILE_PIPELINE"
    
    echo ""
    echo -e "${GREEN}✓ All workflows downloaded${NC}"
    echo ""
}

# Push workflow to n8n
push_workflow() {
    local file=$1
    local wf_id=$2
    
    check_api_key
    
    echo -e "${BLUE}Pushing $file to n8n...${NC}"
    
    # Filter to only allowed properties
    local filtered=$(cat "$file" | jq '{
        name: .name,
        nodes: .nodes,
        connections: .connections,
        settings: .settings,
        staticData: .staticData
    }')
    
    local response=$(curl -s -X PUT \
        "${N8N_BASE_URL}/api/v1/workflows/${wf_id}" \
        -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$filtered")
    
    if echo "$response" | grep -q '"id"'; then
        echo -e "${GREEN}✓ Updated successfully${NC}"
    else
        echo -e "${RED}✗ Failed to update${NC}"
        echo "$response" | jq -r '.message // .' 2>/dev/null
    fi
}

# Push all workflows to n8n
push_all() {
    echo -e "${BLUE}Pushing all workflows to n8n...${NC}"
    
    push_workflow "$FILE_SYNC" "$WF_SYNC"
    push_workflow "$FILE_INGESTION" "$WF_INGESTION"
    push_workflow "$FILE_OUTREACH" "$WF_OUTREACH"
    push_workflow "$FILE_HUBSPOT" "$WF_HUBSPOT"
    push_workflow "$FILE_PIPELINE" "$WF_PIPELINE"
    
    echo ""
    echo -e "${GREEN}✓ All workflows pushed${NC}"
}

# Full pre-flight check
preflight() {
    print_header "Pre-Flight Check"
    
    echo -e "${YELLOW}Step 1/4: Git Status${NC}"
    git_pull
    
    echo -e "${YELLOW}Step 2/4: n8n Workflow Status${NC}"
    get_n8n_status
    
    echo -e "${YELLOW}Step 3/4: Recent Execution Errors${NC}"
    check_errors
    
    echo -e "${YELLOW}Step 4/4: Local vs Remote Comparison${NC}"
    echo "Local files:"
    ls -la workflows/*.json workflows/linkedin/*.json 2>/dev/null | tail -10
    echo ""
    
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}Pre-flight complete!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo "Ready to work. Remember to:"
    echo "  1. Deactivate workflows before major changes"
    echo "  2. Test changes before committing"
    echo "  3. Commit and push when done"
}

# Full status
status() {
    print_header "Status Report"
    
    echo -e "${BLUE}Git Status:${NC}"
    git status --short
    echo ""
    
    echo -e "${BLUE}n8n Workflows:${NC}"
    get_n8n_status
    
    echo -e "${BLUE}Recent Errors:${NC}"
    check_errors
}

# Scan for secrets before committing
scan_secrets() {
    echo -e "${YELLOW}🔍 Scanning for secrets...${NC}"
    
    # Check for hardcoded API keys or tokens (not variable references)
    # Look for actual secret values, not n8n credential references
    local secrets_found=$(grep -r -E '"(sk-|xoxb-|ghp_|gho_|AKIA)[A-Za-z0-9]{20,}"' workflows/ --include="*.json" 2>/dev/null | wc -l)
    
    if [ "$secrets_found" -gt 0 ]; then
        echo -e "${RED}⚠ Potential hardcoded secrets detected!${NC}"
        grep -r -E '"(sk-|xoxb-|ghp_|gho_|AKIA)[A-Za-z0-9]{20,}"' workflows/ --include="*.json" 2>/dev/null | head -5
        return 1
    else
        echo -e "${GREEN}✓ No secrets detected${NC}"
        return 0
    fi
}

# Full sync: Download from n8n → Commit → Force push to GitHub
# Use this when n8n is the source of truth
sync_to_github() {
    print_header "Sync n8n → GitHub"
    
    echo -e "${YELLOW}Step 1/4: Download from n8n...${NC}"
    download_all
    
    echo -e "${YELLOW}Step 2/4: Scan for secrets...${NC}"
    if ! scan_secrets; then
        echo -e "${RED}Aborting sync due to potential secrets.${NC}"
        echo "Review the files and remove secrets before syncing."
        exit 1
    fi
    echo ""
    
    echo -e "${YELLOW}Step 3/4: Commit changes...${NC}"
    if git diff --quiet && git diff --staged --quiet; then
        echo -e "${GREEN}✓ No changes to commit${NC}"
    else
        git add .
        local timestamp=$(date +"%Y-%m-%d %H:%M")
        git commit -m "sync: Pull latest from n8n ($timestamp)"
        echo -e "${GREEN}✓ Changes committed${NC}"
    fi
    echo ""
    
    echo -e "${YELLOW}Step 4/4: Push to GitHub (force)...${NC}"
    git push --force
    echo -e "${GREEN}✓ Pushed to GitHub${NC}"
    echo ""
    
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}Sync complete! n8n → GitHub${NC}"
    echo -e "${GREEN}============================================${NC}"
}

# Usage
usage() {
    echo "n8n Sync Script - Workflow synchronization and pre-flight checks"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  sync         Download from n8n and force push to GitHub (n8n = source of truth)"
    echo "  preflight    Run full pre-flight check (recommended before every session)"
    echo "  pull         Pull latest from GitHub"
    echo "  download     Download all workflows from n8n to local"
    echo "  push         Push all local workflows to n8n"
    echo "  errors       Check recent executions for errors"
    echo "  status       Show full status report"
    echo ""
    echo "Examples:"
    echo "  $0 sync          # Sync n8n → GitHub (most common)"
    echo "  $0 preflight     # Run before starting work"
    echo "  $0 download      # Get latest from n8n after UI changes"
    echo "  $0 push          # Deploy local changes to n8n"
}

# Main
case "${1:-}" in
    sync)
        sync_to_github
        ;;
    preflight)
        preflight
        ;;
    pull)
        git_pull
        ;;
    download)
        download_all
        ;;
    push)
        push_all
        ;;
    errors)
        check_errors
        ;;
    status)
        status
        ;;
    *)
        usage
        ;;
esac

