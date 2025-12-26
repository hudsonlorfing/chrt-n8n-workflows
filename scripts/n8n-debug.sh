#!/bin/bash
# n8n Debug Helper Script
# Enables full debug loop from Cursor without switching to n8n UI

# Get script directory to find .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env file if it exists (for Cursor/IDE usage)
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

# Configuration (env vars take precedence)
N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"
N8N_API_KEY="${N8N_API_KEY:-}"
WORKFLOW_ID="${WORKFLOW_ID:-r4ICnvhdbQwejSdH}"

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

# Update workflow from local JSON file
update_workflow() {
    check_api_key
    local json_file="${1:-workflows/chrt-github-workflow-sync.json}"
    
    if [ ! -f "$json_file" ]; then
        echo -e "${RED}Error: File not found: $json_file${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}Updating workflow from $json_file...${NC}"
    
    # Filter out read-only properties that the API doesn't accept
    # Keep only: name, nodes, connections, settings, staticData
    filtered_json=$(cat "$json_file" | jq '{
        name: .name,
        nodes: .nodes,
        connections: .connections,
        settings: .settings,
        staticData: .staticData
    }')
    
    response=$(curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID" \
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
    echo -e "${BLUE}Activating workflow...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID/activate" \
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
    echo -e "${BLUE}Deactivating workflow...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID/deactivate" \
        -H "accept: application/json" \
        -H "X-N8N-API-KEY: $N8N_API_KEY")
    
    if echo "$response" | grep -q '"active":false'; then
        echo -e "${GREEN}✓ Workflow deactivated${NC}"
    else
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
    echo -e "${BLUE}Running workflow manually...${NC}"
    
    response=$(curl -s -X POST "$N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID/run" \
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

# Show usage
usage() {
    echo "n8n Debug Helper - Full test/debug loop from Cursor"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  update [file]     Update workflow in n8n from local JSON file"
    echo "  activate          Activate the workflow"
    echo "  deactivate        Deactivate the workflow"
    echo "  trigger           Trigger the debug webhook"
    echo "  run               Run workflow manually via API"
    echo "  list [limit]      List recent executions (default: 10)"
    echo "  execution <id>    Get execution details"
    echo "  node <id> <name>  Get specific node data from execution"
    echo "  full <id>         Get full execution with all I/O (saves to file)"
    echo ""
    echo "Environment variables:"
    echo "  N8N_API_KEY       Required - Your n8n API key"
    echo "  N8N_BASE_URL      Optional - n8n instance URL (default: https://chrt.app.n8n.cloud)"
    echo "  WORKFLOW_ID       Optional - Workflow ID (default: r4ICnvhdbQwejSdH)"
    echo ""
    echo "Examples:"
    echo "  export N8N_API_KEY='your-api-key'"
    echo "  $0 update                          # Update workflow from local file"
    echo "  $0 run                             # Run workflow"
    echo "  $0 list 5                          # List last 5 executions"
    echo "  $0 execution abc123                # Get execution summary"
    echo "  $0 node abc123 'Decode to json'    # Get specific node data"
    echo "  $0 full abc123                     # Save full execution to file"
}

# Main command handler
case "$1" in
    update)
        update_workflow "$2"
        ;;
    activate)
        activate_workflow
        ;;
    deactivate)
        deactivate_workflow
        ;;
    trigger)
        trigger_webhook
        ;;
    run)
        run_workflow
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
    *)
        usage
        ;;
esac

