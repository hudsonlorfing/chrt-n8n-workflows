#!/bin/bash

# Test ALL sync workflow paths with real data
# This creates actual test files/workflows to trigger each branch

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$(dirname "$0")/.."

# Load environment
if [ -f .env ]; then
    export $(cat .env | xargs)
fi

N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"
SYNC_WORKFLOW_ID="r4ICnvhdbQwejSdH"
CHRT_PROJECT_ID="O7lTivDfRl72aS23"
GITHUB_OWNER="hudsonlorfing"
GITHUB_REPO="chrt-n8n-workflows"

log() {
    echo -e "$1"
}

check_api_key() {
    if [ -z "$N8N_API_KEY" ]; then
        log "${RED}Error: N8N_API_KEY not set${NC}"
        exit 1
    fi
}

# ============================================
# TEST 1: Only in n8n → Create in GitHub
# ============================================
test_only_in_n8n() {
    log ""
    log "${BLUE}============================================${NC}"
    log "${BLUE}TEST 1: Only in n8n → Create in GitHub${NC}"
    log "${BLUE}============================================${NC}"
    
    # Create a simple test workflow in n8n
    local workflow_json='{
        "name": "TEST-SyncPath-OnlyInN8n",
        "nodes": [
            {
                "parameters": {},
                "id": "test-manual-trigger",
                "name": "Manual Trigger",
                "type": "n8n-nodes-base.manualTrigger",
                "typeVersion": 1,
                "position": [0, 0]
            },
            {
                "parameters": {},
                "id": "test-noop",
                "name": "Test Node",
                "type": "n8n-nodes-base.noOp",
                "typeVersion": 1,
                "position": [200, 0]
            }
        ],
        "connections": {
            "Manual Trigger": {
                "main": [[{"node": "Test Node", "type": "main", "index": 0}]]
            }
        },
        "settings": {"executionOrder": "v1"}
    }'
    
    log "${YELLOW}Creating test workflow in n8n...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        -d "$workflow_json")
    
    workflow_id=$(echo "$response" | jq -r '.id // empty')
    
    if [ -n "$workflow_id" ]; then
        log "${GREEN}✓ Created workflow: $workflow_id${NC}"
        
        # Move it to the Chrt project
        log "${YELLOW}Moving to Chrt project...${NC}"
        curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$workflow_id/transfer" \
            -H "accept: application/json" \
            -H "Content-Type: application/json" \
            -H "X-N8N-API-KEY: $N8N_API_KEY" \
            -d "{\"destinationProjectId\": \"$CHRT_PROJECT_ID\"}" > /dev/null
        log "${GREEN}✓ Moved to Chrt project${NC}"
        
        echo "$workflow_id" > /tmp/test_workflow_1_id
    else
        log "${RED}✗ Failed to create workflow${NC}"
        echo "$response"
        return 1
    fi
}

# ============================================
# TEST 2: GitHub newer → Update n8n
# ============================================
test_github_newer() {
    log ""
    log "${BLUE}============================================${NC}"
    log "${BLUE}TEST 2: GitHub newer → Update n8n${NC}"
    log "${BLUE}============================================${NC}"
    
    # Create a test workflow file directly in GitHub
    local test_content=$(cat << 'EOF'
{
  "name": "TEST-SyncPath-GitHubNewer",
  "nodes": [
    {
      "parameters": {},
      "id": "test-manual",
      "name": "Manual",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {"values": {"string": [{"name": "test", "value": "from-github-UPDATED"}]}},
      "id": "test-set",
      "name": "Set Test Value",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [200, 0]
    }
  ],
  "connections": {
    "Manual": {"main": [[{"node": "Set Test Value", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1"},
  "updatedAt": "2099-12-31T23:59:59.999Z"
}
EOF
)
    
    # First, create a workflow in n8n that we'll update via GitHub
    local n8n_workflow='{
        "name": "TEST-SyncPath-GitHubNewer",
        "nodes": [
            {"parameters": {}, "id": "test-manual", "name": "Manual", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0]},
            {"parameters": {"values": {"string": [{"name": "test", "value": "from-n8n-ORIGINAL"}]}}, "id": "test-set", "name": "Set Test Value", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [200, 0]}
        ],
        "connections": {"Manual": {"main": [[{"node": "Set Test Value", "type": "main", "index": 0}]]}},
        "settings": {"executionOrder": "v1"}
    }'
    
    log "${YELLOW}Creating workflow in n8n (will be updated by GitHub)...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        -d "$n8n_workflow")
    
    workflow_id=$(echo "$response" | jq -r '.id // empty')
    
    if [ -n "$workflow_id" ]; then
        log "${GREEN}✓ Created n8n workflow: $workflow_id${NC}"
        
        # Move to Chrt project
        curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$workflow_id/transfer" \
            -H "accept: application/json" \
            -H "Content-Type: application/json" \
            -H "X-N8N-API-KEY: $N8N_API_KEY" \
            -d "{\"destinationProjectId\": \"$CHRT_PROJECT_ID\"}" > /dev/null
        
        # Add the workflow ID to the GitHub file
        test_content=$(echo "$test_content" | jq --arg id "$workflow_id" '. + {id: $id}')
        
        # Create file in GitHub with future timestamp (so GitHub appears newer)
        log "${YELLOW}Creating file in GitHub with future timestamp...${NC}"
        
        local encoded_content=$(echo "$test_content" | base64)
        
        gh_response=$(curl -s -X PUT "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/contents/workflows/test-syncpath-githubnewer.json" \
            -H "Authorization: token $(echo $N8N_API_KEY | cut -d'_' -f1)_placeholder" \
            -H "Accept: application/vnd.github.v3+json" \
            -H "X-N8N-API-KEY: $N8N_API_KEY" \
            -d "{\"message\": \"Test: GitHub newer workflow\", \"content\": \"$encoded_content\"}")
        
        # Alternative: Create file locally and push
        log "${YELLOW}Creating local file and pushing to GitHub...${NC}"
        echo "$test_content" > "workflows/test-syncpath-githubnewer.json"
        
        echo "$workflow_id" > /tmp/test_workflow_2_id
        log "${GREEN}✓ Test file created${NC}"
    else
        log "${RED}✗ Failed to create workflow${NC}"
        echo "$response"
        return 1
    fi
}

# ============================================
# TEST 3: Tag change → Create at new path
# ============================================
test_path_change() {
    log ""
    log "${BLUE}============================================${NC}"
    log "${BLUE}TEST 3: Tag change → Create at new path${NC}"
    log "${BLUE}============================================${NC}"
    
    # Create a workflow WITHOUT a tag first, then add a tag
    local workflow_json='{
        "name": "TEST-SyncPath-NewTag",
        "nodes": [
            {"parameters": {}, "id": "test-trigger", "name": "Trigger", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0]}
        ],
        "connections": {},
        "settings": {"executionOrder": "v1"}
    }'
    
    log "${YELLOW}Creating workflow without tag (will be in root)...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        -d "$workflow_json")
    
    workflow_id=$(echo "$response" | jq -r '.id // empty')
    
    if [ -n "$workflow_id" ]; then
        log "${GREEN}✓ Created workflow: $workflow_id${NC}"
        
        # Move to Chrt project
        curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$workflow_id/transfer" \
            -H "accept: application/json" \
            -H "Content-Type: application/json" \
            -H "X-N8N-API-KEY: $N8N_API_KEY" \
            -d "{\"destinationProjectId\": \"$CHRT_PROJECT_ID\"}" > /dev/null
        
        echo "$workflow_id" > /tmp/test_workflow_3_id
        log "${GREEN}✓ Workflow ready (run sync, then add 'linkedin' tag to test path change)${NC}"
    else
        log "${RED}✗ Failed to create workflow${NC}"
        echo "$response"
        return 1
    fi
}

# ============================================
# TEST 4: Only in GitHub → Create in n8n
# ============================================
test_only_in_github() {
    log ""
    log "${BLUE}============================================${NC}"
    log "${BLUE}TEST 4: Only in GitHub → Create in n8n${NC}"
    log "${BLUE}============================================${NC}"
    
    # Create a workflow JSON that only exists in GitHub (no ID = not in n8n)
    local test_content=$(cat << 'EOF'
{
  "name": "TEST-SyncPath-OnlyInGitHub",
  "nodes": [
    {
      "parameters": {},
      "id": "github-only-trigger",
      "name": "From GitHub",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {"values": {"string": [{"name": "source", "value": "Created from GitHub!"}]}},
      "id": "github-only-set",
      "name": "Mark Source",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [200, 0]
    }
  ],
  "connections": {
    "From GitHub": {"main": [[{"node": "Mark Source", "type": "main", "index": 0}]]}
  },
  "settings": {"executionOrder": "v1"}
}
EOF
)
    
    log "${YELLOW}Creating workflow file only in GitHub (no n8n ID)...${NC}"
    
    # Create file locally
    echo "$test_content" > "workflows/test-syncpath-onlyingithub.json"
    
    log "${GREEN}✓ Test file created: workflows/test-syncpath-onlyingithub.json${NC}"
    log "${YELLOW}This should be imported to n8n when sync runs${NC}"
}

# ============================================
# Run sync and verify
# ============================================
run_sync() {
    log ""
    log "${BLUE}============================================${NC}"
    log "${BLUE}Running Sync Workflow${NC}"
    log "${BLUE}============================================${NC}"
    
    # Activate
    log "${YELLOW}Activating workflow...${NC}"
    curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$SYNC_WORKFLOW_ID/activate" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" > /dev/null
    log "${GREEN}✓ Activated${NC}"
    
    sleep 2
    
    # Trigger
    log "${YELLOW}Triggering sync...${NC}"
    curl -s "$N8N_BASE_URL/webhook/sync-debug" > /dev/null
    log "${GREEN}✓ Triggered${NC}"
    
    # Wait
    log "${YELLOW}Waiting for execution...${NC}"
    sleep 15
    
    # Get latest execution
    local latest=$(curl -s "$N8N_BASE_URL/api/v1/executions?workflowId=$SYNC_WORKFLOW_ID&limit=1" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" | jq -r '.data[0].id')
    
    log "Execution ID: $latest"
    
    # Get execution data
    local exec_data=$(curl -s "$N8N_BASE_URL/api/v1/executions/$latest?includeData=true" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    local status=$(echo "$exec_data" | jq -r '.status')
    log "Status: $status"
    
    # Check which branches executed
    local nodes=$(echo "$exec_data" | jq -r '.data.resultData.runData | keys[]' 2>/dev/null)
    
    log ""
    log "${BLUE}=== Branch Results ===${NC}"
    
    if echo "$nodes" | grep -q "Upload file"; then
        log "${GREEN}✓ Upload file executed (Only in n8n → GitHub)${NC}"
    else
        log "${YELLOW}○ Upload file not executed${NC}"
    fi
    
    if echo "$nodes" | grep -q "Update workflow in n8n"; then
        log "${GREEN}✓ Update workflow in n8n executed (GitHub → n8n)${NC}"
    else
        log "${YELLOW}○ Update workflow in n8n not executed${NC}"
    fi
    
    if echo "$nodes" | grep -q "Create at New Path"; then
        log "${GREEN}✓ Create at New Path executed (Tag change)${NC}"
    else
        log "${YELLOW}○ Create at New Path not executed${NC}"
    fi
    
    if echo "$nodes" | grep -q "Create new workflow in n8n"; then
        log "${GREEN}✓ Create new workflow in n8n executed (GitHub only → n8n)${NC}"
    else
        log "${YELLOW}○ Create new workflow in n8n not executed${NC}"
    fi
    
    # Deactivate
    log ""
    log "${YELLOW}Deactivating workflow...${NC}"
    curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$SYNC_WORKFLOW_ID/deactivate" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" > /dev/null
    log "${GREEN}✓ Deactivated${NC}"
    
    echo "$latest"
}

# ============================================
# Cleanup test workflows
# ============================================
cleanup() {
    log ""
    log "${BLUE}============================================${NC}"
    log "${BLUE}Cleaning Up Test Workflows${NC}"
    log "${BLUE}============================================${NC}"
    
    # Delete test workflows from n8n
    for id_file in /tmp/test_workflow_*_id; do
        if [ -f "$id_file" ]; then
            wf_id=$(cat "$id_file")
            log "${YELLOW}Deleting n8n workflow: $wf_id${NC}"
            curl -s -X DELETE "$N8N_BASE_URL/api/v1/workflows/$wf_id" \
                -H "accept: application/json" \
                -H "X-N8N-API-KEY: $N8N_API_KEY" > /dev/null
            rm "$id_file"
            log "${GREEN}✓ Deleted${NC}"
        fi
    done
    
    # Delete test files locally
    log "${YELLOW}Removing local test files...${NC}"
    rm -f workflows/test-syncpath-*.json
    log "${GREEN}✓ Removed${NC}"
    
    # Commit and push cleanup
    log "${YELLOW}Pushing cleanup to GitHub...${NC}"
    git add -A
    git commit -m "Cleanup: Remove sync test files" 2>/dev/null || true
    git push origin main 2>/dev/null || true
    log "${GREEN}✓ Done${NC}"
}

# ============================================
# Main
# ============================================
check_api_key

case "${1:-all}" in
    setup)
        test_only_in_n8n
        test_github_newer
        test_path_change
        test_only_in_github
        
        log ""
        log "${BLUE}============================================${NC}"
        log "${GREEN}Setup complete! Test files created.${NC}"
        log "${BLUE}============================================${NC}"
        log ""
        log "Next steps:"
        log "  1. Run: git add -A && git commit -m 'Add test files' && git push"
        log "  2. Run: $0 sync"
        log "  3. Check results in n8n UI and GitHub"
        log "  4. Run: $0 cleanup"
        ;;
    sync)
        run_sync
        ;;
    cleanup)
        cleanup
        ;;
    all)
        test_only_in_n8n
        test_github_newer  
        test_path_change
        test_only_in_github
        
        log ""
        log "${YELLOW}Committing test files to GitHub...${NC}"
        git add -A
        git commit -m "Test: Add sync path test files"
        git push origin main
        
        sleep 3
        
        run_sync
        
        log ""
        log "${YELLOW}Waiting before cleanup...${NC}"
        sleep 5
        
        cleanup
        ;;
    *)
        echo "Usage: $0 [setup|sync|cleanup|all]"
        echo ""
        echo "  setup   - Create test workflows/files without running sync"
        echo "  sync    - Run the sync workflow"
        echo "  cleanup - Remove all test workflows/files"
        echo "  all     - Run complete test cycle (default)"
        exit 1
        ;;
esac

