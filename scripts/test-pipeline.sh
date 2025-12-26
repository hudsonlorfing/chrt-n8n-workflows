#!/bin/bash

# Test script for Lead Pipeline Monitor workflow
# This script tests all branches of the pipeline automation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"
PIPELINE_WORKFLOW_ID="pipeline-monitor-id"  # Will be set after import
INGESTION_WORKFLOW_ID="aLxwvqoSTkZAQ3fq"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Lead Pipeline Monitor - Test Suite${NC}"
echo -e "${BLUE}============================================${NC}"

# Function to update a workflow
update_workflow() {
  local file=$1
  local workflow_id=$2
  
  echo -e "${YELLOW}Updating workflow from $file...${NC}"
  
  # Filter out read-only properties
  local filtered=$(cat "$file" | jq 'del(.updatedAt, .createdAt, .id, .isArchived, .versionId, .activeVersionId, .triggerCount, .shared, .activeVersion, .tags, ._folderPath, ._fileName)')
  
  response=$(curl -s -X PUT \
    "${N8N_BASE_URL}/api/v1/workflows/${workflow_id}" \
    -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$filtered")
  
  if echo "$response" | grep -q '"id"'; then
    echo -e "${GREEN}✓ Workflow updated successfully${NC}"
    return 0
  else
    echo -e "${RED}✗ Failed to update workflow${NC}"
    echo "$response" | jq -r '.message // .' 2>/dev/null || echo "$response"
    return 1
  fi
}

# Function to import a new workflow
import_workflow() {
  local file=$1
  
  echo -e "${YELLOW}Importing workflow from $file...${NC}"
  
  # Prepare workflow for import - remove metadata that shouldn't be set on import
  local workflow_data=$(cat "$file" | jq 'del(.updatedAt, .createdAt, .id, .isArchived, .versionId, .activeVersionId, .triggerCount, .shared, .activeVersion, ._folderPath, ._fileName)')
  
  response=$(curl -s -X POST \
    "${N8N_BASE_URL}/api/v1/workflows" \
    -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$workflow_data")
  
  local new_id=$(echo "$response" | jq -r '.id // empty')
  
  if [ -n "$new_id" ]; then
    echo -e "${GREEN}✓ Workflow imported with ID: $new_id${NC}"
    echo "$new_id"
    return 0
  else
    echo -e "${RED}✗ Failed to import workflow${NC}"
    echo "$response" | jq -r '.message // .' 2>/dev/null || echo "$response"
    return 1
  fi
}

# Function to activate a workflow
activate_workflow() {
  local workflow_id=$1
  
  echo -e "${YELLOW}Activating workflow $workflow_id...${NC}"
  
  response=$(curl -s -X PATCH \
    "${N8N_BASE_URL}/api/v1/workflows/${workflow_id}" \
    -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"active": true}')
  
  if echo "$response" | grep -q '"active":true'; then
    echo -e "${GREEN}✓ Workflow activated${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠ Workflow may not be active${NC}"
    return 0
  fi
}

# Function to deactivate a workflow
deactivate_workflow() {
  local workflow_id=$1
  
  echo -e "${YELLOW}Deactivating workflow $workflow_id...${NC}"
  
  response=$(curl -s -X PATCH \
    "${N8N_BASE_URL}/api/v1/workflows/${workflow_id}" \
    -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"active": false}')
  
  echo -e "${GREEN}✓ Workflow deactivated${NC}"
}

# Function to trigger webhook
trigger_webhook() {
  local path=$1
  local body=$2
  
  echo -e "${YELLOW}Triggering webhook: $path${NC}"
  
  response=$(curl -s -X POST \
    "${N8N_BASE_URL}/webhook/${path}" \
    -H "Content-Type: application/json" \
    -d "${body:-{}}")
  
  echo "$response"
}

# Function to get latest execution
get_latest_execution() {
  local workflow_id=$1
  
  response=$(curl -s -X GET \
    "${N8N_BASE_URL}/api/v1/executions?workflowId=${workflow_id}&limit=1&data=true" \
    -H "X-N8N-API-KEY: ${N8N_API_KEY}")
  
  echo "$response"
}

# Main test flow
main() {
  echo ""
  echo -e "${BLUE}Step 1: Update Lead Ingestion workflow (add webhook trigger)${NC}"
  echo "----------------------------------------------"
  update_workflow "workflows/linkedin/1.-lead-ingestion-&-icp-scoring.json" "$INGESTION_WORKFLOW_ID"
  
  echo ""
  echo -e "${BLUE}Step 2: Import Pipeline Monitor workflow${NC}"
  echo "----------------------------------------------"
  
  # Check if pipeline workflow already exists by searching
  existing_workflows=$(curl -s -X GET \
    "${N8N_BASE_URL}/api/v1/workflows" \
    -H "X-N8N-API-KEY: ${N8N_API_KEY}")
  
  PIPELINE_WORKFLOW_ID=$(echo "$existing_workflows" | jq -r '.data[] | select(.name == "4. Lead Pipeline Monitor") | .id' | head -1)
  
  if [ -n "$PIPELINE_WORKFLOW_ID" ] && [ "$PIPELINE_WORKFLOW_ID" != "null" ]; then
    echo -e "${YELLOW}Pipeline Monitor workflow already exists (ID: $PIPELINE_WORKFLOW_ID), updating...${NC}"
    update_workflow "workflows/linkedin/4.-lead-pipeline-monitor.json" "$PIPELINE_WORKFLOW_ID"
  else
    echo -e "${YELLOW}Creating new Pipeline Monitor workflow...${NC}"
    PIPELINE_WORKFLOW_ID=$(import_workflow "workflows/linkedin/4.-lead-pipeline-monitor.json")
  fi
  
  if [ -z "$PIPELINE_WORKFLOW_ID" ] || [ "$PIPELINE_WORKFLOW_ID" == "null" ]; then
    echo -e "${RED}Failed to get Pipeline Monitor workflow ID${NC}"
    exit 1
  fi
  
  echo ""
  echo -e "${BLUE}Step 3: Testing workflow paths${NC}"
  echo "----------------------------------------------"
  
  echo ""
  echo -e "${YELLOW}Test A: Trigger Pipeline Monitor via webhook${NC}"
  echo "This will check Dashboard metrics and run the appropriate path"
  
  # Activate the workflow first
  activate_workflow "$PIPELINE_WORKFLOW_ID"
  
  # Trigger the webhook
  echo ""
  echo "Triggering pipeline-monitor webhook..."
  trigger_webhook "pipeline-monitor" '{"testMode": true}'
  
  echo ""
  sleep 5
  
  echo -e "${YELLOW}Getting latest execution...${NC}"
  execution=$(get_latest_execution "$PIPELINE_WORKFLOW_ID")
  
  exec_id=$(echo "$execution" | jq -r '.data[0].id // empty')
  exec_status=$(echo "$execution" | jq -r '.data[0].status // empty')
  
  if [ -n "$exec_id" ]; then
    echo -e "${GREEN}✓ Execution ID: $exec_id${NC}"
    echo -e "Status: $exec_status"
    
    # Save execution details
    mkdir -p test-results
    echo "$execution" | jq '.' > "test-results/pipeline-execution-${exec_id}.json"
    echo -e "${GREEN}✓ Execution details saved to test-results/pipeline-execution-${exec_id}.json${NC}"
  fi
  
  echo ""
  echo -e "${BLUE}Step 4: Test Lead Ingestion webhook${NC}"
  echo "----------------------------------------------"
  
  # Activate lead ingestion
  activate_workflow "$INGESTION_WORKFLOW_ID"
  
  echo "Triggering lead-ingestion webhook with batchSize=5..."
  trigger_webhook "lead-ingestion" '{"batchSize": 5, "source": "test"}'
  
  echo ""
  sleep 5
  
  ingestion_exec=$(get_latest_execution "$INGESTION_WORKFLOW_ID")
  ingestion_exec_id=$(echo "$ingestion_exec" | jq -r '.data[0].id // empty')
  
  if [ -n "$ingestion_exec_id" ]; then
    echo -e "${GREEN}✓ Lead Ingestion Execution ID: $ingestion_exec_id${NC}"
    echo "$ingestion_exec" | jq '.' > "test-results/ingestion-execution-${ingestion_exec_id}.json"
  fi
  
  echo ""
  echo -e "${BLUE}============================================${NC}"
  echo -e "${GREEN}Test Complete!${NC}"
  echo -e "${BLUE}============================================${NC}"
  echo ""
  echo "Workflows deployed:"
  echo "  - Lead Ingestion (ID: $INGESTION_WORKFLOW_ID)"
  echo "  - Pipeline Monitor (ID: $PIPELINE_WORKFLOW_ID)"
  echo ""
  echo "To manually test specific paths, run:"
  echo "  curl -X POST ${N8N_BASE_URL}/webhook/pipeline-monitor"
  echo "  curl -X POST ${N8N_BASE_URL}/webhook/lead-ingestion -d '{\"batchSize\": 240}'"
  echo ""
  echo "To deactivate workflows after testing:"
  echo "  ./scripts/n8n-debug.sh deactivate $PIPELINE_WORKFLOW_ID"
  echo "  ./scripts/n8n-debug.sh deactivate $INGESTION_WORKFLOW_ID"
}

# Run with test mode
case "${1:-run}" in
  deploy)
    echo -e "${YELLOW}Deploying workflows only (no testing)...${NC}"
    update_workflow "workflows/linkedin/1.-lead-ingestion-&-icp-scoring.json" "$INGESTION_WORKFLOW_ID"
    
    existing_workflows=$(curl -s -X GET \
      "${N8N_BASE_URL}/api/v1/workflows" \
      -H "X-N8N-API-KEY: ${N8N_API_KEY}")
    
    PIPELINE_WORKFLOW_ID=$(echo "$existing_workflows" | jq -r '.data[] | select(.name == "4. Lead Pipeline Monitor") | .id' | head -1)
    
    if [ -n "$PIPELINE_WORKFLOW_ID" ] && [ "$PIPELINE_WORKFLOW_ID" != "null" ]; then
      update_workflow "workflows/linkedin/4.-lead-pipeline-monitor.json" "$PIPELINE_WORKFLOW_ID"
    else
      import_workflow "workflows/linkedin/4.-lead-pipeline-monitor.json"
    fi
    echo -e "${GREEN}✓ Workflows deployed${NC}"
    ;;
  run|*)
    main
    ;;
esac

