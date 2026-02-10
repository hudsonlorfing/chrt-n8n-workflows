#!/bin/bash

# Test all branches of the Chrt GitHub Workflow Sync
# This script tests each path in the sync workflow and documents results

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load environment
cd "$(dirname "$0")/.."
if [ -f .env ]; then
    export $(cat .env | xargs)
fi

N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"
SYNC_WORKFLOW_ID="r4ICnvhdbQwejSdH"
TEST_LOG="test-results/sync-test-$(date +%Y%m%d-%H%M%S).log"

# Create test results directory
mkdir -p test-results

log() {
    echo -e "$1" | tee -a "$TEST_LOG"
}

check_api_key() {
    if [ -z "$N8N_API_KEY" ]; then
        log "${RED}Error: N8N_API_KEY not set${NC}"
        exit 1
    fi
}

# Get execution details
get_execution() {
    local exec_id=$1
    curl -s "$N8N_BASE_URL/api/v1/executions/$exec_id?includeData=true" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY"
}

# Analyze which branches were executed
analyze_branches() {
    local exec_id=$1
    local exec_data=$(get_execution "$exec_id")
    
    log ""
    log "${BLUE}=== Execution $exec_id Branch Analysis ===${NC}"
    
    # Get executed nodes
    local nodes=$(echo "$exec_data" | jq -r '.data.resultData.runData | keys[]' 2>/dev/null)
    
    # Check each branch
    log ""
    log "${YELLOW}Branch 1: Normal Sync (n8n newer than GitHub)${NC}"
    if echo "$nodes" | grep -q "Code - InputA"; then
        log "  ${GREEN}✓ Code - InputA executed${NC}"
        if echo "$nodes" | grep -q "If Path Changed"; then
            log "  ${GREEN}✓ If Path Changed executed${NC}"
            if echo "$nodes" | grep -q "Edit Fields"; then
                log "  ${GREEN}✓ Edit Fields (same path) executed${NC}"
            fi
            if echo "$nodes" | grep -q "Edit Fields (Move)"; then
                log "  ${GREEN}✓ Edit Fields (Move) executed - path changed${NC}"
            fi
        fi
        if echo "$nodes" | grep -q "Update file"; then
            log "  ${GREEN}✓ Update file executed${NC}"
        fi
        if echo "$nodes" | grep -q "Create at New Path"; then
            log "  ${GREEN}✓ Create at New Path executed${NC}"
        fi
    else
        log "  ${YELLOW}○ Not triggered (no n8n-newer workflows)${NC}"
    fi
    
    log ""
    log "${YELLOW}Branch 2: GitHub newer than n8n${NC}"
    if echo "$nodes" | grep -q "Code - InputB"; then
        log "  ${GREEN}✓ Code - InputB executed${NC}"
        if echo "$nodes" | grep -q "Update workflow in n8n"; then
            log "  ${GREEN}✓ Update workflow in n8n executed${NC}"
        fi
    else
        log "  ${YELLOW}○ Not triggered (no GitHub-newer workflows)${NC}"
    fi
    
    log ""
    log "${YELLOW}Branch 3: Only in n8n (new workflow)${NC}"
    if echo "$nodes" | grep -q "Json file"; then
        log "  ${GREEN}✓ Json file executed${NC}"
        if echo "$nodes" | grep -q "Upload file"; then
            log "  ${GREEN}✓ Upload file executed${NC}"
        fi
    else
        log "  ${YELLOW}○ Not triggered (no n8n-only workflows)${NC}"
    fi
    
    log ""
    log "${YELLOW}Branch 4: Only in GitHub (new workflow to import)${NC}"
    if echo "$nodes" | grep -q "Create new workflow in n8n"; then
        log "  ${GREEN}✓ Create new workflow in n8n executed${NC}"
    else
        log "  ${YELLOW}○ Not triggered (no GitHub-only workflows)${NC}"
    fi
    
    # Summary
    log ""
    log "${BLUE}=== Executed Nodes ===${NC}"
    echo "$nodes" | while read node; do
        local status=$(echo "$exec_data" | jq -r ".data.resultData.runData[\"$node\"][0].executionStatus // \"unknown\"" 2>/dev/null)
        if [ "$status" = "success" ]; then
            log "  ${GREEN}✓${NC} $node"
        else
            log "  ${RED}✗${NC} $node ($status)"
        fi
    done
    
    # Check for errors
    local errors=$(echo "$exec_data" | jq -r '.data.resultData.error.message // empty' 2>/dev/null)
    if [ -n "$errors" ]; then
        log ""
        log "${RED}=== Errors ===${NC}"
        log "$errors"
    fi
}

# Run the sync and analyze
run_test() {
    check_api_key
    
    log "${BLUE}========================================${NC}"
    log "${BLUE}Sync Workflow Branch Test${NC}"
    log "${BLUE}$(date)${NC}"
    log "${BLUE}========================================${NC}"
    
    # Activate workflow
    log ""
    log "${BLUE}Activating workflow...${NC}"
    curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$SYNC_WORKFLOW_ID/activate" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" > /dev/null
    log "${GREEN}✓ Activated${NC}"
    
    sleep 2
    
    # Trigger via webhook
    log ""
    log "${BLUE}Triggering sync via webhook...${NC}"
    curl -s "$N8N_BASE_URL/webhook/sync-debug" > /dev/null
    log "${GREEN}✓ Triggered${NC}"
    
    # Wait for execution
    log ""
    log "${BLUE}Waiting for execution to complete...${NC}"
    sleep 10
    
    # Get latest execution
    local latest=$(curl -s "$N8N_BASE_URL/api/v1/executions?workflowId=$SYNC_WORKFLOW_ID&limit=1" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" | jq -r '.data[0].id')
    
    log "Latest execution: $latest"
    
    # Analyze branches
    analyze_branches "$latest"
    
    # Deactivate workflow
    log ""
    log "${BLUE}Deactivating workflow...${NC}"
    curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$SYNC_WORKFLOW_ID/deactivate" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" > /dev/null
    log "${GREEN}✓ Deactivated${NC}"
    
    log ""
    log "${BLUE}========================================${NC}"
    log "${GREEN}Test complete. Results saved to: $TEST_LOG${NC}"
    log "${BLUE}========================================${NC}"
}

# Main
case "${1:-run}" in
    run)
        run_test
        ;;
    analyze)
        if [ -z "$2" ]; then
            echo "Usage: $0 analyze <execution_id>"
            exit 1
        fi
        check_api_key
        analyze_branches "$2"
        ;;
    *)
        echo "Usage: $0 [run|analyze <execution_id>]"
        exit 1
        ;;
esac

