#!/bin/bash
# =============================================================================
# n8n Duplicate Workflow Cleanup Script
# =============================================================================
# This script removes duplicate/test workflows from n8n, keeping only:
# - Production workflows (tracked in workflows/ folder)
# - ShedPro project workflows
#
# ALWAYS review the list before confirming deletion!
# =============================================================================

set -e

# Load environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [[ -f .env ]]; then
    source .env
fi

# Set n8n base URL if not in .env
N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Production workflow IDs (from local files - DO NOT DELETE THESE)
PRODUCTION_IDS=(
    "aLxwvqoSTkZAQ3fq"  # 1. Lead Ingestion & ICP Scoring
    "kjjYKQEXv67Vl5MS"  # 2. LinkedIn Outreach (PhantomBuster)
    "a56vnrPo9dsg5mmf"  # 3. Connection Sync → HubSpot
    "dWFsEXELFTJU0W01"  # 4. Lead Pipeline Monitor
    "YWP69Qgq0ZlCN7Gj"  # 5. Error Monitor Webhook
    "D8nDH8ECyadToNHp"  # 6. Fireflies Meeting Processor
    "0PjeQ9VgbUgE5lnD"  # 7. Slack Interaction Handler
    "w8FzfVMwIFAhUwNG"  # 8. Google Sheets Reader (Claude Tool)
    "r4ICnvhdbQwejSdH"  # Chrt GitHub Workflow Sync
)

# Check requirements
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed${NC}"
    exit 1
fi

if [[ -z "$N8N_API_KEY" ]]; then
    echo -e "${RED}Error: N8N_API_KEY not set. Check .env file${NC}"
    exit 1
fi

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}n8n Duplicate Workflow Cleanup${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Fetch all workflows
echo -e "${YELLOW}Fetching all workflows from n8n...${NC}"
ALL_WORKFLOWS=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_BASE_URL/api/v1/workflows")

if [[ -z "$ALL_WORKFLOWS" ]] || [[ "$ALL_WORKFLOWS" == "null" ]]; then
    echo -e "${RED}Error: Could not fetch workflows from n8n${NC}"
    exit 1
fi

# Build list of duplicates to delete
echo ""
echo -e "${YELLOW}Identifying duplicates...${NC}"
echo ""

DUPLICATES_TO_DELETE=()
KEPT_COUNT=0

# Process each workflow
while IFS= read -r line; do
    id=$(echo "$line" | jq -r '.id')
    name=$(echo "$line" | jq -r '.name')
    active=$(echo "$line" | jq -r '.active')
    
    # Skip if it's a production ID
    is_production=false
    for prod_id in "${PRODUCTION_IDS[@]}"; do
        if [[ "$id" == "$prod_id" ]]; then
            is_production=true
            break
        fi
    done
    
    if $is_production; then
        echo -e "${GREEN}✓ KEEP (production):${NC} $name ($id) [active: $active]"
        ((KEPT_COUNT++))
        continue
    fi
    
    # Skip ShedPro workflows
    if [[ "$name" == *"ShedPro"* ]]; then
        echo -e "${GREEN}✓ KEEP (ShedPro):${NC} $name ($id) [active: $active]"
        ((KEPT_COUNT++))
        continue
    fi
    
    # Check if it's a Chrt-related duplicate
    if [[ "$name" == *"Lead"* ]] || \
       [[ "$name" == *"LinkedIn"* ]] || \
       [[ "$name" == *"Connection"* ]] || \
       [[ "$name" == *"Pipeline"* ]] || \
       [[ "$name" == *"Error"* ]] || \
       [[ "$name" == *"Fireflies"* ]] || \
       [[ "$name" == *"Slack"* ]] || \
       [[ "$name" == *"Google Sheets"* ]] || \
       [[ "$name" == *"GitHub"* ]] || \
       [[ "$name" == *"Linq"* ]] || \
       [[ "$name" == *"AI Agent"* ]]; then
        echo -e "${RED}✗ DELETE (duplicate):${NC} $name ($id) [active: $active]"
        DUPLICATES_TO_DELETE+=("$id|$name")
    else
        echo -e "${GREEN}✓ KEEP (other):${NC} $name ($id) [active: $active]"
        ((KEPT_COUNT++))
    fi
done < <(echo "$ALL_WORKFLOWS" | jq -c '.data[]')

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}============================================${NC}"
echo -e "Workflows to keep: ${GREEN}$KEPT_COUNT${NC}"
echo -e "Duplicates to delete: ${RED}${#DUPLICATES_TO_DELETE[@]}${NC}"
echo ""

if [[ ${#DUPLICATES_TO_DELETE[@]} -eq 0 ]]; then
    echo -e "${GREEN}No duplicates found! Nothing to clean up.${NC}"
    exit 0
fi

# List duplicates
echo -e "${YELLOW}Duplicates to be deleted:${NC}"
for item in "${DUPLICATES_TO_DELETE[@]}"; do
    id=$(echo "$item" | cut -d'|' -f1)
    name=$(echo "$item" | cut -d'|' -f2)
    echo "  - $name ($id)"
done
echo ""

# Confirm deletion
echo -e "${RED}WARNING: This action cannot be undone!${NC}"
read -p "Type 'DELETE' to confirm deletion of ${#DUPLICATES_TO_DELETE[@]} workflows: " confirm

if [[ "$confirm" != "DELETE" ]]; then
    echo -e "${YELLOW}Aborted. No workflows were deleted.${NC}"
    exit 0
fi

# Delete duplicates
echo ""
echo -e "${YELLOW}Deleting duplicates...${NC}"

deleted_count=0
failed_count=0

for item in "${DUPLICATES_TO_DELETE[@]}"; do
    id=$(echo "$item" | cut -d'|' -f1)
    name=$(echo "$item" | cut -d'|' -f2)
    
    response=$(curl -s -X DELETE -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_BASE_URL/api/v1/workflows/$id")
    
    # Check if deletion was successful (n8n returns the deleted workflow on success)
    if echo "$response" | jq -e '.id' > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Deleted:${NC} $name ($id)"
        ((deleted_count++))
    else
        error=$(echo "$response" | jq -r '.message // "Unknown error"')
        echo -e "${RED}✗ Failed to delete:${NC} $name ($id) - $error"
        ((failed_count++))
    fi
done

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Cleanup Complete${NC}"
echo -e "${BLUE}============================================${NC}"
echo -e "Successfully deleted: ${GREEN}$deleted_count${NC}"
echo -e "Failed: ${RED}$failed_count${NC}"

