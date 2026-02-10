#!/bin/bash
# n8n Debug Helper Script
# Enables full debug loop from Cursor without switching to n8n UI

# Get script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
cd "$PROJECT_DIR"

# Load environment - prefer Doppler (CLI authenticated), fall back to .env
if command -v doppler &> /dev/null && doppler secrets download --no-file --format env &>/dev/null; then
    eval $(doppler secrets download --no-file --format env)
elif [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
else
    echo "Warning: No secrets found. Run 'doppler setup' or create .env"
fi

# Configuration (env vars take precedence)
N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"
N8N_API_KEY="${N8N_API_KEY:-}"
WORKFLOW_ID="${WORKFLOW_ID:-r4ICnvhdbQwejSdH}"

# Workflow IDs
SYNC_WORKFLOW_ID="r4ICnvhdbQwejSdH"
LINKEDIN_LEAD_WORKFLOW_ID="aLxwvqoSTkZAQ3fq"
CHRT_PROJECT_ID="O7lTivDfRl72aS23"
# Test folder (Chrt project): https://chrt.app.n8n.cloud/projects/O7lTivDfRl72aS23/folders/B94lBTvcz1TgfA0l/workflows
CHRT_TEST_FOLDER_ID="B94lBTvcz1TgfA0l"
# Production LinkedIn workflow IDs (update these when promoting from test)
CONNECTION_SYNC_PROD_ID="a56vnrPo9dsg5mmf"
LEAD_INGESTION_PROD_ID="aLxwvqoSTkZAQ3fq"
PIPELINE_MONITOR_PROD_ID="dWFsEXELFTJU0W01"
# Test folder LinkedIn workflow IDs (use these for all testing so executions stay in test folder)
CONNECTION_SYNC_TEST_ID="wjlyzhs95MWvnTAt"
LEAD_INGESTION_TEST_ID="MQantT1gLLP8NEn4"   # 1. Lead Ingestion & ICP Scoring (TEST) — move to test folder in n8n UI
PIPELINE_MONITOR_TEST_ID="atJokUdeDsap4lJO" # 4. Lead Pipeline Monitor (TEST) — move to test folder in n8n UI
OUTREACH_TEST_ID="RdeXvr6pEAFkOpwN"          # 2. LinkedIn Outreach (TEST) — move to test folder in n8n UI

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check for API key
check_api_key() {
    if [ -z "$N8N_API_KEY" ]; then
        echo -e "${RED}Error: N8N_API_KEY environment variable not set${NC}"
        echo "Set it with: export N8N_API_KEY='your-api-key'"
        exit 1
    fi
}

# Common curl options
curl_opts() {
    echo "-s -H 'accept: application/json' -H 'X-N8N-API-KEY: $N8N_API_KEY'"
}

# Download workflow by ID to a JSON file. Prefer saving to workflows/linkedin/testing/ for isolation (pass output_file to save there).
download_workflow() {
    check_api_key
    local workflow_id="${1:?Usage: $0 download <workflow_id> [output_file]}"
    local out_file="${2:-}"
    if [ -z "$out_file" ]; then
        out_file="$PROJECT_DIR/workflows/linkedin/downloaded-${workflow_id}.json"
    fi
    echo -e "${BLUE}Downloading workflow $workflow_id...${NC}"
    response=$(curl -s "$N8N_BASE_URL/api/v1/workflows/$workflow_id" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    if echo "$response" | grep -q '"id"'; then
        echo "$response" | jq '.' > "$out_file"
        echo -e "${GREEN}✓ Saved to $out_file${NC}"
    else
        echo -e "${RED}✗ Failed${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
        exit 1
    fi
}

# Update workflow from local JSON file
update_workflow() {
    check_api_key
    local json_file="${1:-workflows/chrt-github-workflow-sync.json}"
    local target_workflow_id="${2:-$WORKFLOW_ID}"
    
    if [ ! -f "$json_file" ]; then
        echo -e "${RED}Error: File not found: $json_file${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}Updating workflow $target_workflow_id from $json_file...${NC}"
    
    # Filter out read-only properties that the API doesn't accept
    # Keep only: name, nodes, connections, settings, staticData
    filtered_json=$(cat "$json_file" | jq '{
        name: .name,
        nodes: .nodes,
        connections: .connections,
        settings: .settings,
        staticData: .staticData
    }')
    
    response=$(curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$target_workflow_id" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        -d "$filtered_json")
    
    if echo "$response" | grep -q '"id"'; then
        echo -e "${GREEN}✓ Workflow updated successfully${NC}"
        echo "$response" | jq -r '.name + " (ID: " + .id + ")"' 2>/dev/null || echo "$response"
    else
        echo -e "${RED}✗ Failed to update workflow${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
        exit 1
    fi
}

# Activate workflow
activate_workflow() {
    check_api_key
    local target_workflow_id="${1:-$WORKFLOW_ID}"
    echo -e "${BLUE}Activating workflow $target_workflow_id...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$target_workflow_id/activate" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    if echo "$response" | grep -q '"active":true'; then
        echo -e "${GREEN}✓ Workflow activated${NC}"
    else
        echo -e "${YELLOW}Workflow may already be active or activation failed${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    fi
}

# Deactivate workflow
deactivate_workflow() {
    check_api_key
    local target_workflow_id="${1:-$WORKFLOW_ID}"
    echo -e "${BLUE}Deactivating workflow $target_workflow_id...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$target_workflow_id/deactivate" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    if echo "$response" | grep -q '"active":false'; then
        echo -e "${GREEN}✓ Workflow deactivated${NC}"
    else
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    fi
}

# Import a new workflow
import_workflow() {
    check_api_key
    local json_file="${1:-workflows/chrt-github-workflow-sync.json}"
    local project_id="${2:-$CHRT_PROJECT_ID}"
    
    if [ ! -f "$json_file" ]; then
        echo -e "${RED}Error: File not found: $json_file${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}Importing new workflow from $json_file to project $project_id...${NC}"
    
    # Filter to only required properties for import (projectId is NOT supported in body)
    filtered_json=$(cat "$json_file" | jq '{
        name: .name,
        nodes: .nodes,
        connections: .connections,
        settings: .settings
    }')
    
    # Create workflow first
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        -d "$filtered_json")
    
    new_id=$(echo "$response" | jq -r '.id // empty')
    
    if [ -n "$new_id" ]; then
        echo -e "${GREEN}✓ Workflow imported successfully${NC}"
        echo "$response" | jq -r '.name + " (ID: " + .id + ")"' 2>/dev/null || echo "$response"
        
        # Now transfer to the target project
        if [ -n "$project_id" ]; then
            echo -e "${BLUE}Transferring to project $project_id...${NC}"
            transfer_response=$(curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$new_id/transfer" \
                -H "accept: application/json" \
                -H "Content-Type: application/json" \
                -H "X-N8N-API-KEY: $N8N_API_KEY" \
                -d "{\"destinationProjectId\": \"$project_id\"}")
            
            # Verify
            verify=$(curl -s "$N8N_BASE_URL/api/v1/workflows/$new_id" \
                -H "accept: application/json" \
                -H "X-N8N-API-KEY: $N8N_API_KEY")
            
            actual_project=$(echo "$verify" | jq -r '.projectId // "null"')
            if [ "$actual_project" = "$project_id" ]; then
                echo -e "${GREEN}✓ Workflow is in project $project_id${NC}"
            else
                echo -e "${YELLOW}⚠ Workflow created but transfer may have failed (project: $actual_project)${NC}"
            fi
        fi
        
        echo "$new_id"
    else
        echo -e "${RED}✗ Failed to import workflow${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
        exit 1
    fi
}

# Import workflow(s) to Chrt project for testing in the test folder.
# Workflows are created in the project; move them to folder B94lBTvcz1TgfA0l in the n8n UI.
# Usage: import-to-test [file1 [file2 ...]]
import_to_test() {
    check_api_key
    local files=("$@")
    if [ ${#files[@]} -eq 0 ]; then
        files=(
            "workflows/linkedin/3.-connection-sync-→-hubspot.json"
            "workflows/linkedin/4.-lead-pipeline-monitor.json"
        )
    fi
    local test_folder_url="$N8N_BASE_URL/projects/$CHRT_PROJECT_ID/folders/$CHRT_TEST_FOLDER_ID/workflows"
    echo -e "${BLUE}Importing ${#files[@]} workflow(s) to Chrt project for testing...${NC}"
    echo ""
    for json_file in "${files[@]}"; do
        if [ ! -f "$json_file" ]; then
            echo -e "${RED}Skip (not found): $json_file${NC}"
            continue
        fi
        output=$(import_workflow "$json_file" "$CHRT_PROJECT_ID" 2>&1) || true
        echo "$output"
        new_id=$(echo "$output" | grep -oE '[a-zA-Z0-9]{16}' | tail -1)
        if [ -n "$new_id" ]; then
            echo -e "${GREEN}✓ Imported: $json_file → ID: $new_id${NC}"
        fi
    done
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "  1. Open the test folder and move each workflow into it (n8n API does not set folderId):"
    echo "     $test_folder_url"
    echo "  2. In each workflow, set the 'Doppler API' credential on the Fetch Doppler cookies node (Connection Sync) or as needed."
    echo "  3. Run manually / trigger and check executions."
    echo "  4. When ready for production, run:"
    echo "     $0 push-linkedin-to-prod"
    echo ""
}

# Update TEST folder LinkedIn workflows from local JSON. Pushes only workflows that have a file in workflows/linkedin/testing/ AND a non-empty TEST_ID set in this script. Test workflow names include " (TEST)" so they are clearly marked in n8n; do not edit production workflow files or production URLs when working in the testing folder.
update_linkedin_test() {
    check_api_key
    updated=0
    if [ -f "workflows/linkedin/testing/1.-lead-ingestion-&-icp-scoring.json" ] && [ -n "$LEAD_INGESTION_TEST_ID" ]; then
        echo -e "${BLUE}Updating TEST folder Lead Ingestion (1) from workflows/linkedin/testing/...${NC}"
        update_workflow "workflows/linkedin/testing/1.-lead-ingestion-&-icp-scoring.json" "$LEAD_INGESTION_TEST_ID"
        echo -e "${GREEN}✓ Lead Ingestion (TEST) updated.${NC}"
        updated=1
    elif [ -f "workflows/linkedin/testing/1.-lead-ingestion-&-icp-scoring.json" ]; then
        echo -e "${YELLOW}workflows/linkedin/testing/1.-lead-ingestion-&-icp-scoring.json exists but LEAD_INGESTION_TEST_ID is not set.${NC}"
        echo "  Run: import-to-test workflows/linkedin/1.-lead-ingestion-&-icp-scoring.json, move to test folder in n8n UI, set LEAD_INGESTION_TEST_ID in this script."
    fi
    if [ -f "workflows/linkedin/testing/4.-lead-pipeline-monitor.json" ] && [ -n "$PIPELINE_MONITOR_TEST_ID" ]; then
        echo -e "${BLUE}Updating TEST folder Lead Pipeline Monitor (4) from workflows/linkedin/testing/...${NC}"
        update_workflow "workflows/linkedin/testing/4.-lead-pipeline-monitor.json" "$PIPELINE_MONITOR_TEST_ID"
        echo -e "${GREEN}✓ Lead Pipeline Monitor (TEST) updated.${NC}"
        updated=1
    elif [ -f "workflows/linkedin/testing/4.-lead-pipeline-monitor.json" ]; then
        echo -e "${YELLOW}workflows/linkedin/testing/4.-lead-pipeline-monitor.json exists but PIPELINE_MONITOR_TEST_ID is not set.${NC}"
        echo "  Run: import-to-test workflows/linkedin/4.-lead-pipeline-monitor.json, move to test folder in n8n UI, set PIPELINE_MONITOR_TEST_ID in this script."
    fi
    if [ -f "workflows/linkedin/testing/2.-linkedin-outreach-(phantombuster).json" ] && [ -n "$OUTREACH_TEST_ID" ]; then
        echo -e "${BLUE}Updating TEST folder LinkedIn Outreach (2) from workflows/linkedin/testing/...${NC}"
        update_workflow "workflows/linkedin/testing/2.-linkedin-outreach-(phantombuster).json" "$OUTREACH_TEST_ID"
        echo -e "${GREEN}✓ LinkedIn Outreach (TEST) updated.${NC}"
        updated=1
    elif [ -f "workflows/linkedin/testing/2.-linkedin-outreach-(phantombuster).json" ]; then
        echo -e "${YELLOW}workflows/linkedin/testing/2.-linkedin-outreach-(phantombuster).json exists but OUTREACH_TEST_ID is not set.${NC}"
    fi
    if [ $updated -eq 0 ] && [ ! -f "workflows/linkedin/testing/1.-lead-ingestion-&-icp-scoring.json" ] && [ ! -f "workflows/linkedin/testing/4.-lead-pipeline-monitor.json" ] && [ ! -f "workflows/linkedin/testing/2.-linkedin-outreach-(phantombuster).json" ]; then
        echo -e "${YELLOW}No test workflow files in workflows/linkedin/testing/ (or test IDs not set).${NC}"
        echo "  Add JSON to testing/ and set LEAD_INGESTION_TEST_ID / PIPELINE_MONITOR_TEST_ID / OUTREACH_TEST_ID to push to test folder."
    fi
}

# Copy workflows/linkedin/testing/* to workflows/linkedin/ (main). Run after finalizing test workflows; then use push-linkedin-to-prod.
promote_linkedin_test_to_main() {
    local testing_dir="$PROJECT_DIR/workflows/linkedin/testing"
    if [ ! -d "$testing_dir" ]; then
        echo -e "${YELLOW}No workflows/linkedin/testing/ folder. Nothing to promote.${NC}"
        return 0
    fi
    echo -e "${BLUE}Promoting testing workflows to main (overwrite workflows/linkedin/*.json)...${NC}"
    for f in "$testing_dir"/*.json; do
        [ -f "$f" ] || continue
        base=$(basename "$f")
        # Keep production id and remove " (TEST)" from name when promoting
        if [ "$base" = "1.-lead-ingestion-&-icp-scoring.json" ]; then
            jq '.id = "'"$LEAD_INGESTION_PROD_ID"'" | .name = "1. Lead Ingestion & ICP Scoring"' "$f" > "$PROJECT_DIR/workflows/linkedin/$base"
            echo -e "  ${GREEN}✓ $base → main (id set to production)${NC}"
        elif [ "$base" = "3.-connection-sync-→-hubspot.json" ]; then
            jq '.id = "a56vnrPo9dsg5mmf"' "$f" > "$PROJECT_DIR/workflows/linkedin/$base"
            echo -e "  ${GREEN}✓ $base → main (id set to production)${NC}"
        elif [ "$base" = "4.-lead-pipeline-monitor.json" ]; then
            jq '.id = "'"$PIPELINE_MONITOR_PROD_ID"'" | .name = "4. Lead Pipeline Monitor"' "$f" > "$PROJECT_DIR/workflows/linkedin/$base"
            echo -e "  ${GREEN}✓ $base → main (id set to production)${NC}"
        elif [ "$base" = "2.-linkedin-outreach-(phantombuster).json" ]; then
            jq '.name = "2. LinkedIn Outreach (PhantomBuster)" | .id = "kjjYKQEXv67Vl5MS"' "$f" > "$PROJECT_DIR/workflows/linkedin/$base"
            echo -e "  ${GREEN}✓ $base → main (id set to production)${NC}"
        else
            cp "$f" "$PROJECT_DIR/workflows/linkedin/$base"
            echo -e "  ${GREEN}✓ $base → main${NC}"
        fi
    done
    echo -e "${GREEN}✓ Promote done. Push to production: $0 push-linkedin-to-prod${NC}"
}

# Run TEST folder LinkedIn workflows (Connection Sync via webhook; executions stay in test folder).
# n8n Cloud does not allow POST /workflows/:id/run or POST /executions; trigger via webhook. Test workflow must be active.
run_linkedin_test() {
    echo -e "${BLUE}Running Connection Sync (test) via webhook...${NC}"
    echo "  (Ensure test workflow $CONNECTION_SYNC_TEST_ID is active so it receives the webhook.)"
    response=$(curl -s -X POST "$N8N_BASE_URL/webhook/connection-sync-test" \
        -H "Content-Type: application/json" \
        -d '{}' \
        -w "\n%{http_code}")
    http_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓ Webhook triggered (HTTP 200). Workflow started.${NC}"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
        if [ -n "$N8N_API_KEY" ]; then
            echo ""
            echo -e "${BLUE}Recent executions (test workflow):${NC}"
            WORKFLOW_ID="$CONNECTION_SYNC_TEST_ID" list_executions 3
        else
            echo "  Set N8N_API_KEY to list executions: WORKFLOW_ID=$CONNECTION_SYNC_TEST_ID $0 list 5"
        fi
    else
        echo -e "${YELLOW}HTTP $http_code${NC}"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
    fi
    echo ""
    echo -e "${BLUE}To run Lead Pipeline Monitor (test): activate it in n8n and trigger its webhook, or run manually in UI.${NC}"
}

# Update production LinkedIn workflows from local JSON (after testing in test folder).
push_linkedin_to_prod() {
    check_api_key
    echo -e "${BLUE}Updating production LinkedIn workflows from local files...${NC}"
    update_workflow "workflows/linkedin/1.-lead-ingestion-&-icp-scoring.json" "$LEAD_INGESTION_PROD_ID"
    update_workflow "workflows/linkedin/2.-linkedin-outreach-(phantombuster).json" "kjjYKQEXv67Vl5MS"
    update_workflow "workflows/linkedin/3.-connection-sync-→-hubspot.json" "$CONNECTION_SYNC_PROD_ID"
    update_workflow "workflows/linkedin/4.-lead-pipeline-monitor.json" "$PIPELINE_MONITOR_PROD_ID"
    echo -e "${GREEN}✓ Production workflows updated. Activate if needed: $0 activate <workflow_id>${NC}"
}

# Delete a workflow from n8n (use with care; e.g. remove test copy after promoting to prod)
delete_workflow() {
    check_api_key
    local workflow_id="$1"
    if [ -z "$workflow_id" ]; then
        echo -e "${RED}Error: Workflow ID required${NC}"
        echo "Usage: $0 delete <workflow_id>"
        exit 1
    fi
    echo -e "${YELLOW}Deleting workflow $workflow_id from n8n...${NC}"
    response=$(curl -s -X DELETE \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        "$N8N_BASE_URL/api/v1/workflows/$workflow_id")
    if echo "$response" | jq -e '.id' &>/dev/null; then
        echo -e "${GREEN}✓ Deleted workflow $workflow_id${NC}"
    else
        echo -e "${RED}✗ Delete failed${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
        exit 1
    fi
}

# Transfer a workflow to a different project
transfer_workflow() {
    check_api_key
    local workflow_id="$1"
    local destination_project="${2:-$CHRT_PROJECT_ID}"
    
    if [ -z "$workflow_id" ]; then
        echo -e "${RED}Error: Workflow ID required${NC}"
        echo "Usage: $0 transfer <workflow_id> [project_id]"
        exit 1
    fi
    
    echo -e "${BLUE}Transferring workflow $workflow_id to project $destination_project...${NC}"
    
    response=$(curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$workflow_id/transfer" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        -d "{\"destinationProjectId\": \"$destination_project\"}")
    
    if [ -z "$response" ] || echo "$response" | grep -q '"message"'; then
        echo -e "${YELLOW}Transfer response:${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "Empty response - may have succeeded"
        
        # Verify by fetching the workflow
        verify=$(curl -s "$N8N_BASE_URL/api/v1/workflows/$workflow_id" \
            -H "accept: application/json" \
            -H "X-N8N-API-KEY: $N8N_API_KEY")
        
        actual_project=$(echo "$verify" | jq -r '.projectId // "null"')
        if [ "$actual_project" = "$destination_project" ]; then
            echo -e "${GREEN}✓ Transfer verified - workflow is in project $destination_project${NC}"
        else
            echo -e "${RED}✗ Transfer may have failed - workflow is in project: $actual_project${NC}"
        fi
    else
        echo -e "${GREEN}✓ Transfer response received${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    fi
}

# Trigger the debug webhook
trigger_webhook() {
    echo -e "${BLUE}Triggering debug webhook...${NC}"
    
    # The webhook URL - may need adjustment based on your n8n setup
    webhook_url="$N8N_BASE_URL/webhook/sync-debug"
    
    response=$(curl -s "$webhook_url")
    
    echo -e "${GREEN}✓ Webhook triggered${NC}"
    echo "Response: $response"
}

# Trigger workflow execution via API (manual run)
run_workflow() {
    check_api_key
    local target_workflow_id="${1:-$WORKFLOW_ID}"
    echo -e "${BLUE}Running workflow $target_workflow_id manually...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$target_workflow_id/run" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    execution_id=$(echo "$response" | jq -r '.id // .executionId // empty' 2>/dev/null)
    
    if [ -n "$execution_id" ]; then
        echo -e "${GREEN}✓ Workflow execution started${NC}"
        echo "Execution ID: $execution_id"
        echo ""
        echo "To get execution details, run:"
        echo "  $0 execution $execution_id"
    else
        echo -e "${YELLOW}Execution response:${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    fi
}

# List recent executions
list_executions() {
    check_api_key
    local limit="${1:-10}"
    
    echo -e "${BLUE}Listing last $limit executions for workflow $WORKFLOW_ID...${NC}"
    echo ""
    
    response=$(curl -s "$N8N_BASE_URL/api/v1/executions?workflowId=$WORKFLOW_ID&limit=$limit" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    echo "$response" | jq -r '.data[] | 
        "ID: \(.id) | Status: \(.status) | Started: \(.startedAt) | Mode: \(.mode)"' 2>/dev/null || echo "$response"
}

# Get execution details
get_execution() {
    check_api_key
    local execution_id="$1"
    local node_name="$2"
    
    if [ -z "$execution_id" ]; then
        echo -e "${RED}Error: Execution ID required${NC}"
        echo "Usage: $0 execution <execution_id> [node_name]"
        exit 1
    fi
    
    echo -e "${BLUE}Getting execution details for $execution_id...${NC}"
    echo ""
    
    response=$(curl -s "$N8N_BASE_URL/api/v1/executions/$execution_id?includeData=true" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    # Get basic execution info
    echo -e "${GREEN}=== Execution Summary ===${NC}"
    echo "$response" | jq -r '"Status: \(.status)\nStarted: \(.startedAt)\nFinished: \(.stoppedAt)\nMode: \(.mode)"' 2>/dev/null
    echo ""
    
    # If a specific node is requested, show its data
    if [ -n "$node_name" ]; then
        echo -e "${GREEN}=== Node: $node_name ===${NC}"
        echo "$response" | jq --arg node "$node_name" '.data.resultData.runData[$node]' 2>/dev/null
    else
        # Show all nodes that were executed
        echo -e "${GREEN}=== Executed Nodes ===${NC}"
        echo "$response" | jq -r '.data.resultData.runData | keys[]' 2>/dev/null
        echo ""
        echo "To see a specific node's data, run:"
        echo "  $0 execution $execution_id \"Node Name\""
    fi
}

# Get execution with full I/O for all nodes
get_full_execution() {
    check_api_key
    local execution_id="$1"
    
    if [ -z "$execution_id" ]; then
        echo -e "${RED}Error: Execution ID required${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}Getting full execution data for $execution_id...${NC}"
    
    response=$(curl -s "$N8N_BASE_URL/api/v1/executions/$execution_id?includeData=true" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    # Save to file for easier inspection
    output_file="execution-$execution_id.json"
    echo "$response" | jq '.' > "$output_file"
    echo -e "${GREEN}✓ Full execution saved to $output_file${NC}"
    
    # Show summary
    echo ""
    echo -e "${GREEN}=== Execution Summary ===${NC}"
    echo "$response" | jq -r '"Status: \(.status)\nWorkflow: \(.workflowData.name)\nStarted: \(.startedAt)\nFinished: \(.stoppedAt)"' 2>/dev/null
    
    # Show node execution order
    echo ""
    echo -e "${GREEN}=== Node Execution Order ===${NC}"
    echo "$response" | jq -r '.data.resultData.runData | to_entries | .[] | "\(.key): \(.value[0].executionStatus // "unknown")"' 2>/dev/null
    
    # Show any errors
    echo ""
    echo -e "${GREEN}=== Errors (if any) ===${NC}"
    echo "$response" | jq -r '.data.resultData.runData | to_entries[] | select(.value[0].error != null) | "\(.key): \(.value[0].error.message)"' 2>/dev/null || echo "No errors found"
}

# Resume Connection Sync: extract profiles from execution and POST to test-from-merge webhook
# Usage: resume <execution_id> [--file <path>] [--node <name>] [--exclude-completed] [--webhook-url <url>] [--dry-run]
# If --file not given and N8N_API_KEY is set, fetches execution via API. Otherwise expects execution-<id>.json in cwd or PROJECT_DIR.
resume() {
    local execution_id="$1"
    shift || true
    local exec_file=""
    local node_name="Merge Connection + Email Data"
    local exclude_completed=0
    local webhook_url="${N8N_BASE_URL}/webhook/test-from-merge"
    local dry_run=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --file) exec_file="$2"; shift 2 ;;
            --node) node_name="$2"; shift 2 ;;
            --exclude-completed) exclude_completed=1; shift ;;
            --webhook-url) webhook_url="$2"; shift 2 ;;
            --dry-run) dry_run=1; shift ;;
            *) shift ;;
        esac
    done

    if [ -z "$execution_id" ]; then
        echo -e "${RED}Error: Execution ID required${NC}"
        echo "Usage: $0 resume <execution_id> [--file path] [--node name] [--exclude-completed] [--webhook-url url] [--dry-run]"
        exit 1
    fi

    if [ -z "$exec_file" ]; then
        if [ -n "$N8N_API_KEY" ]; then
            echo -e "${BLUE}Fetching execution $execution_id from n8n...${NC}"
            response=$(curl -s "$N8N_BASE_URL/api/v1/executions/$execution_id?includeData=true" \
                -H "accept: application/json" \
                -H "X-N8N-API-KEY: $N8N_API_KEY")
            exec_file="$PROJECT_DIR/execution-$execution_id.json"
            echo "$response" | jq '.' > "$exec_file"
            echo -e "${GREEN}✓ Saved to $exec_file${NC}"
        else
            exec_file="$PROJECT_DIR/execution-$execution_id.json"
            if [ ! -f "$exec_file" ]; then
                exec_file="execution-$execution_id.json"
            fi
        fi
    fi

    if [ ! -f "$exec_file" ]; then
        echo -e "${RED}Error: Execution file not found: $exec_file${NC}"
        echo "Run: $0 full $execution_id  (with N8N_API_KEY set) or provide --file <path>"
        exit 1
    fi

    echo -e "${BLUE}Extracting items from node: $node_name${NC}"
    # n8n runData: runData[nodeName] is array of runs; first run .data.main[0] is array of { json: {...} }
    local all_items
    all_items=$(jq -c --arg node "$node_name" '
        .data.resultData.runData[$node] // empty
        | if type == "array" then .[0].data.main[0] else . end
        | if . then . else [] end
    ' "$exec_file" 2>/dev/null)

    if [ -z "$all_items" ] || [ "$all_items" = "[]" ]; then
        echo -e "${RED}Error: No data found for node \"$node_name\" in $exec_file${NC}"
        echo "Check node name (e.g. \"Merge Connection + Email Data\" or \"Loop Over Items\")"
        exit 1
    fi

    local count
    count=$(echo "$all_items" | jq 'length')
    echo -e "${GREEN}✓ Found $count items${NC}"

    local body_json
    if [ "$exclude_completed" -eq 1 ]; then
        # Get profileUrls from Update HubSpot Status1 output (completed items) as JSON array
        completed_urls=$(jq -c '
            [.data.resultData.runData["Update HubSpot Status1"] // empty
            | if type == "array" then .[0].data.main[0][]? | .json.profileUrl // .json.linkedinProfileUrl // empty else empty end
            | select(. != null and . != "")] | unique
        ' "$exec_file" 2>/dev/null)
        [ -z "$completed_urls" ] && completed_urls="[]"
        # Filter out items whose profileUrl/linkedinProfileUrl is in completed_urls
        body_json=$(jq -c --argjson completed "$completed_urls" '
            [.[] | .json] | map(select((.profileUrl // .linkedinProfileUrl // "") as $u | ($u == "") or (($completed | index($u)) | not))) | { body: . }
        ' <<< "$all_items" 2>/dev/null)
        [ -z "$body_json" ] && body_json=$(jq -c '[.[] | .json] | { body: . }' <<< "$all_items")
    else
        body_json=$(jq -c '[.[] | .json] | { body: . }' <<< "$all_items")
    fi

    local remaining_count
    remaining_count=$(echo "$body_json" | jq '.body | length')
    echo -e "${BLUE}Profiles to send: $remaining_count${NC}"

    if [ "$dry_run" -eq 1 ]; then
        echo -e "${YELLOW}Dry run: not POSTing to webhook${NC}"
        echo "$body_json" | jq '.'
        return 0
    fi

    echo -e "${BLUE}POSTing to $webhook_url...${NC}"
    response=$(curl -s -X POST "$webhook_url" \
        -H "Content-Type: application/json" \
        -d "$body_json")
    echo -e "${GREEN}✓ Webhook triggered${NC}"
    if [ -n "$response" ]; then
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    fi
}

# Resume one-by-one: POST each profile separately with delay (for workflows that hang at Wait node)
# Usage: resume-one-by-one <execution_id> [--delay SECS] [--file path] [--node name] [--exclude-completed] [--webhook-url url] [--dry-run]
resume_one_by_one() {
    local execution_id="$1"
    shift || true
    local delay=90
    local exec_file=""
    local node_name="Merge Connection + Email Data"
    local exclude_completed=0
    local webhook_url="${N8N_BASE_URL}/webhook/test-from-merge"
    local dry_run=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --delay) delay="$2"; shift 2 ;;
            --file) exec_file="$2"; shift 2 ;;
            --node) node_name="$2"; shift 2 ;;
            --exclude-completed) exclude_completed=1; shift ;;
            --webhook-url) webhook_url="$2"; shift 2 ;;
            --dry-run) dry_run=1; shift ;;
            *) shift ;;
        esac
    done

    if [ -z "$execution_id" ]; then
        echo -e "${RED}Error: Execution ID required${NC}"
        echo "Usage: $0 resume-one-by-one <execution_id> [--delay SECS] [--file path] [--node name] [--exclude-completed] [--webhook-url url] [--dry-run]"
        exit 1
    fi

    # Reuse resume logic to get exec_file and all_items (but we need raw items, not body_json)
    if [ -z "$exec_file" ]; then
        if [ -n "$N8N_API_KEY" ]; then
            echo -e "${BLUE}Fetching execution $execution_id from n8n...${NC}"
            response=$(curl -s "$N8N_BASE_URL/api/v1/executions/$execution_id?includeData=true" \
                -H "accept: application/json" \
                -H "X-N8N-API-KEY: $N8N_API_KEY")
            exec_file="$PROJECT_DIR/execution-$execution_id.json"
            echo "$response" | jq '.' > "$exec_file"
            echo -e "${GREEN}✓ Saved to $exec_file${NC}"
        else
            exec_file="$PROJECT_DIR/execution-$execution_id.json"
            [ ! -f "$exec_file" ] && exec_file="execution-$execution_id.json"
        fi
    fi

    [ ! -f "$exec_file" ] && { echo -e "${RED}Error: Execution file not found: $exec_file${NC}"; exit 1; }

    local all_items
    all_items=$(jq -c --arg node "$node_name" '.data.resultData.runData[$node] // empty | if type == "array" then .[0].data.main[0] else . end | if . then . else [] end' "$exec_file" 2>/dev/null)
    [ -z "$all_items" ] || [ "$all_items" = "[]" ] && { echo -e "${RED}Error: No data for node \"$node_name\"${NC}"; exit 1; }

    local count
    count=$(echo "$all_items" | jq 'length')
    echo -e "${GREEN}✓ Found $count items; will POST one at a time with ${delay}s delay${NC}"

    if [ "$exclude_completed" -eq 1 ]; then
        completed_urls=$(jq -c '[.data.resultData.runData["Update HubSpot Status1"] // empty | if type == "array" then .[0].data.main[0][]? | .json.profileUrl // .json.linkedinProfileUrl // empty else empty end | select(. != null and . != "")] | unique' "$exec_file" 2>/dev/null)
        [ -z "$completed_urls" ] && completed_urls="[]"
        all_items=$(jq -c --argjson completed "$completed_urls" '[.[] | .json] | map(select((.profileUrl // .linkedinProfileUrl // "") as $u | ($u == "") or (($completed | index($u)) | not))) | map({ json: . })' <<< "$all_items" 2>/dev/null)
        count=$(echo "$all_items" | jq 'length')
    else
        all_items=$(jq -c '[.[] | .json] | map({ json: . })' <<< "$all_items")
    fi

    for i in $(seq 0 $((count - 1))); do
        item=$(echo "$all_items" | jq -c ".[$i]")
        body_one=$(jq -c '{ body: [ .json ] }' <<< "$item")
        echo -e "${BLUE}POSTing profile $((i+1))/$count...${NC}"
        if [ "$dry_run" -eq 0 ]; then
            curl -s -X POST "$webhook_url" -H "Content-Type: application/json" -d "$body_one" > /dev/null
            echo -e "${GREEN}✓ Triggered${NC}"
            if [ "$i" -lt $((count - 1)) ]; then
                echo -e "${YELLOW}Waiting ${delay}s before next...${NC}"
                sleep "$delay"
            fi
        else
            echo "$body_one" | jq -c '.body[0] | { profileUrl, fullName }'
        fi
    done
    echo -e "${GREEN}✓ Done: $count webhook calls${NC}"
}

# Update and run LinkedIn Lead workflow
run_linkedin() {
    check_api_key
    local json_file="workflows/linkedin/1.-lead-ingestion-&-icp-scoring.json"
    
    echo -e "${BLUE}Updating LinkedIn Lead Ingestion workflow...${NC}"
    
    # Filter out read-only properties
    filtered_json=$(cat "$json_file" | jq '{
        name: .name,
        nodes: .nodes,
        connections: .connections,
        settings: .settings,
        staticData: .staticData
    }')
    
    response=$(curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$LINKEDIN_LEAD_WORKFLOW_ID" \
        -H "accept: application/json" \
        -H "Content-Type: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        -d "$filtered_json")
    
    if echo "$response" | grep -q '"id"'; then
        echo -e "${GREEN}✓ LinkedIn workflow updated${NC}"
        
        # Try to execute via test endpoint
        echo -e "${BLUE}Executing workflow...${NC}"
        exec_response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$LINKEDIN_LEAD_WORKFLOW_ID/run" \
            -H "accept: application/json" \
            -H "X-N8N-API-KEY: $N8N_API_KEY")
        
        # Check for execution ID
        exec_id=$(echo "$exec_response" | jq -r '.id // .executionId // empty' 2>/dev/null)
        if [ -n "$exec_id" ]; then
            echo -e "${GREEN}✓ Execution started: $exec_id${NC}"
            echo "Run: $0 full $exec_id (with WORKFLOW_ID=$LINKEDIN_LEAD_WORKFLOW_ID)"
        else
            echo -e "${YELLOW}Note: Manual execution may not be available via API${NC}"
            echo "Run the workflow manually in n8n UI or activate it"
            echo "$exec_response" | jq '.' 2>/dev/null || echo "$exec_response"
        fi
    else
        echo -e "${RED}✗ Failed to update workflow${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    fi
}

# Show usage
usage() {
    echo "n8n Debug Helper - Full test/debug loop from Cursor"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  download <workflow_id> [file] Download workflow from n8n to JSON (e.g. pull test workflow)"
    echo "  update <file> [workflow_id]  Update workflow in n8n from local JSON file"
    echo "  import <file> [project_id]   Import new workflow from local JSON file (default: ChrtWorkflows)"
    echo "  import-to-test [file...]     Import LinkedIn workflows to Chrt project for test folder (then move in UI)"
    echo "  update-linkedin-test         Update TEST folder Lead Pipeline Monitor from workflows/linkedin/testing/4.-lead-pipeline-monitor.json"
    echo "  run-linkedin-test            Run Connection Sync (test folder); executions stay in test folder"
    echo "  promote-linkedin-to-main    Copy workflows/linkedin/testing/* to main (then push-linkedin-to-prod)"
    echo "  push-linkedin-to-prod        Update production LinkedIn workflows from main folder (after promote)"
    echo "  delete <workflow_id>         Delete workflow from n8n (e.g. test copy after promote)"
    echo "  transfer <id> [project_id]   Transfer workflow to project (default: ChrtWorkflows)"
    echo "  activate [workflow_id]       Activate the workflow"
    echo "  deactivate [workflow_id]     Deactivate the workflow"
    echo "  trigger                      Trigger the debug webhook"
    echo "  run [workflow_id]            Run workflow manually via API"
    echo "  list [limit]                 List recent executions (default: 10)"
    echo "  execution <id>               Get execution details"
    echo "  node <id> <name>             Get specific node data from execution"
    echo "  full <id>                    Get full execution with all I/O (saves to file)"
    echo "  resume <id> [opts]           Extract profiles from execution and POST to test-from-merge webhook"
    echo "                              Options: --file <path> --node <name> --exclude-completed --webhook-url <url> --dry-run"
    echo "  resume-one-by-one <id> [opts] POST one profile at a time with delay (for Wait-node hangs)"
    echo "                              Options: --delay SECS --file --node --exclude-completed --webhook-url --dry-run"
    echo "  linkedin                     Update and run LinkedIn Lead Ingestion workflow"
    echo ""
    echo "Environment variables:"
    echo "  N8N_API_KEY       Required - Your n8n API key"
    echo "  N8N_BASE_URL      Optional - n8n instance URL (default: https://chrt.app.n8n.cloud)"
    echo "  WORKFLOW_ID       Optional - Default Workflow ID (default: r4ICnvhdbQwejSdH)"
    echo ""
    echo "Examples:"
    echo "  export N8N_API_KEY='your-api-key'"
    echo "  $0 update file.json                # Update default workflow from file"
    echo "  $0 update file.json abc123         # Update specific workflow from file"
    echo "  $0 import file.json                # Import new workflow from file"
    echo "  $0 activate abc123                 # Activate specific workflow"
    echo "  $0 run abc123                      # Run specific workflow"
    echo "  $0 list 5                          # List last 5 executions"
    echo "  $0 execution abc123                # Get execution summary"
    echo "  $0 node abc123 'Decode to json'    # Get specific node data"
    echo "  $0 full abc123                     # Save full execution to file"
    echo "  $0 resume 999 --exclude-completed # Extract remaining profiles and POST to webhook"
    echo "  $0 resume 999 --dry-run            # Extract only, do not POST"
    echo "  $0 linkedin                        # Update and run LinkedIn workflow"
}

# Main command handler
case "$1" in
    download)
        download_workflow "$2" "$3"
        ;;
    update)
        update_workflow "$2" "$3"
        ;;
    import)
        import_workflow "$2" "$3"
        ;;
    import-to-test)
        shift
        import_to_test "$@"
        ;;
    update-linkedin-test)
        update_linkedin_test
        ;;
    run-linkedin-test)
        run_linkedin_test
        ;;
    promote-linkedin-to-main)
        promote_linkedin_test_to_main
        ;;
    push-linkedin-to-prod)
        push_linkedin_to_prod
        ;;
    delete)
        delete_workflow "$2"
        ;;
    transfer)
        transfer_workflow "$2" "$3"
        ;;
    activate)
        activate_workflow "$2"
        ;;
    deactivate)
        deactivate_workflow "$2"
        ;;
    trigger)
        trigger_webhook
        ;;
    run)
        run_workflow "$2"
        ;;
    list)
        list_executions "$2"
        ;;
    execution)
        get_execution "$2" "$3"
        ;;
    node)
        get_execution "$2" "$3"
        ;;
    full)
        get_full_execution "$2"
        ;;
    resume)
        shift
        resume "$@"
        ;;
    resume-one-by-one)
        shift
        resume_one_by_one "$@"
        ;;
    linkedin)
        run_linkedin
        ;;
    *)
        usage
        ;;
esac

