#!/usr/bin/env bash

# n8n Auto-Debug Script
# 
# This script checks for recent n8n execution errors and uses Claude to analyze them.
# Can be run manually or scheduled via cron.
#
# Usage:
#   ./auto-debug.sh                    # Check last 5 executions for errors
#   ./auto-debug.sh analyze <exec_id>  # Analyze specific execution
#   ./auto-debug.sh watch              # Continuous monitoring mode
#
# Requirements:
#   - N8N_API_KEY and N8N_BASE_URL in .env
#   - Claude Code CLI installed (optional, falls back to prompt file)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEBUG_LOGS_DIR="$PROJECT_DIR/debug-logs"

# Load .env
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Workflow IDs (format: name:id)
WORKFLOWS="sync:r4ICnvhdbQwejSdH ingestion:aLxwvqoSTkZAQ3fq outreach:kjjYKQEXv67Vl5MS hubspot:a56vnrPo9dsg5mmf pipeline:dWFsEXELFTJU0W01"

# Ensure debug logs directory exists
mkdir -p "$DEBUG_LOGS_DIR"

# Check for Claude Code CLI
check_claude() {
    if command -v claude &> /dev/null; then
        echo "claude"
    elif command -v cursor &> /dev/null; then
        echo "cursor"
    else
        echo ""
    fi
}

# Fetch execution details
fetch_execution() {
    local exec_id=$1
    curl -s "https://chrt.app.n8n.cloud/api/v1/executions/${exec_id}?data=true" \
        -H "X-N8N-API-KEY: $N8N_API_KEY"
}

# Find recent errors
find_errors() {
    local limit=${1:-5}
    echo -e "${CYAN}Checking last $limit executions for errors...${NC}"
    
    local errors_found=0
    
    for wf in $WORKFLOWS; do
        local wf_name="${wf%%:*}"
        local wf_id="${wf##*:}"
        local executions=$(curl -s "https://chrt.app.n8n.cloud/api/v1/executions?workflowId=${wf_id}&limit=${limit}" \
            -H "X-N8N-API-KEY: $N8N_API_KEY")
        
        # Find errors
        local error_execs=$(echo "$executions" | jq -r '.data[] | select(.status == "error") | "\(.id)|\(.startedAt)|\(.stoppedAt)"')
        
        if [ -n "$error_execs" ]; then
            echo -e "\n${RED}✗ Errors found in $wf_name:${NC}"
            while IFS='|' read -r exec_id started_at stopped_at; do
                if [ -n "$exec_id" ]; then
                    echo "  - Execution $exec_id at $started_at"
                    errors_found=$((errors_found + 1))
                fi
            done <<< "$error_execs"
        fi
    done
    
    if [ "$errors_found" -eq 0 ]; then
        echo -e "${GREEN}✓ No recent errors found${NC}"
    else
        echo -e "\n${YELLOW}Found $errors_found errors. Run './auto-debug.sh analyze <exec_id>' to analyze.${NC}"
    fi
    
    return $errors_found
}

# Analyze a specific execution
analyze_execution() {
    local exec_id=$1
    
    echo -e "${CYAN}Analyzing execution $exec_id...${NC}"
    
    # Fetch execution details
    local execution=$(fetch_execution "$exec_id")
    
    if [ -z "$execution" ] || [ "$execution" == "null" ]; then
        echo -e "${RED}Failed to fetch execution details${NC}"
        return 1
    fi
    
    # Extract error info
    local workflow_name=$(echo "$execution" | jq -r '.workflowData.name // "Unknown"')
    local workflow_id=$(echo "$execution" | jq -r '.workflowId // "Unknown"')
    local status=$(echo "$execution" | jq -r '.status')
    local mode=$(echo "$execution" | jq -r '.mode')
    local started_at=$(echo "$execution" | jq -r '.startedAt')
    
    # Get error details from last node that ran
    local run_data=$(echo "$execution" | jq -r '.data.resultData.runData // {}')
    local last_node=$(echo "$run_data" | jq -r 'keys[-1] // "Unknown"')
    local error_msg=$(echo "$execution" | jq -r '.data.resultData.error.message // "Unknown error"')
    local error_node=$(echo "$execution" | jq -r '.data.resultData.error.node.name // .data.resultData.lastNodeExecuted // "Unknown"')
    
    echo -e "\n${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BLUE}Execution Analysis${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "Workflow: ${YELLOW}$workflow_name${NC} (ID: $workflow_id)"
    echo -e "Execution: $exec_id"
    echo -e "Status: ${RED}$status${NC}"
    echo -e "Mode: $mode"
    echo -e "Started: $started_at"
    echo -e "Failed Node: ${RED}$error_node${NC}"
    echo -e "Error: $error_msg"
    
    # Save execution data for analysis
    local timestamp=$(date +"%Y%m%d-%H%M%S")
    local exec_file="$DEBUG_LOGS_DIR/execution-${exec_id}-${timestamp}.json"
    echo "$execution" > "$exec_file"
    echo -e "\n${GREEN}✓ Execution data saved to: $exec_file${NC}"
    
    # Build analysis prompt
    local prompt_file="$DEBUG_LOGS_DIR/prompt-${exec_id}-${timestamp}.md"
    
    cat > "$prompt_file" << EOF
# n8n Workflow Error Analysis

## Error Summary
- **Workflow**: $workflow_name (ID: $workflow_id)
- **Execution ID**: $exec_id
- **Failed Node**: $error_node
- **Error Message**: $error_msg
- **Started At**: $started_at
- **Mode**: $mode

## Execution Data
\`\`\`json
$(echo "$run_data" | jq '.')
\`\`\`

## Task
1. Analyze the error and identify the root cause
2. Explain what went wrong in simple terms
3. Provide a specific fix or configuration change
4. If this is a common n8n pattern issue, explain the correct approach

Please be concise and actionable.
EOF
    
    echo -e "${GREEN}✓ Analysis prompt saved to: $prompt_file${NC}"
    
    # Try to run Claude analysis
    local claude_cmd=$(check_claude)
    
    if [ -n "$claude_cmd" ]; then
        echo -e "\n${CYAN}Running Claude analysis...${NC}"
        local output_file="$DEBUG_LOGS_DIR/analysis-${exec_id}-${timestamp}.md"
        
        # Run claude in headless mode
        if $claude_cmd -p "$(cat $prompt_file)" > "$output_file" 2>&1; then
            echo -e "${GREEN}✓ Analysis complete! Saved to: $output_file${NC}"
            echo -e "\n${BLUE}═══════════════════════════════════════${NC}"
            echo -e "${BLUE}Claude Analysis:${NC}"
            echo -e "${BLUE}═══════════════════════════════════════${NC}"
            cat "$output_file"
        else
            echo -e "${YELLOW}Claude analysis failed. Use the prompt file for manual analysis.${NC}"
        fi
    else
        echo -e "\n${YELLOW}Claude CLI not found. To analyze:${NC}"
        echo "1. Open Cursor and use the prompt file:"
        echo "   $prompt_file"
        echo ""
        echo "2. Or install Claude Code CLI:"
        echo "   npm install -g @anthropic-ai/claude-code"
    fi
}

# Watch mode - continuous monitoring
watch_errors() {
    echo -e "${CYAN}Starting continuous error monitoring...${NC}"
    echo "Press Ctrl+C to stop"
    
    local last_check=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    while true; do
        sleep 60  # Check every minute
        
        local current_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        echo -e "\n${BLUE}[$(date)] Checking for new errors...${NC}"
        
        for wf in $WORKFLOWS; do
            local wf_name="${wf%%:*}"
            local wf_id="${wf##*:}"
            local executions=$(curl -s "https://chrt.app.n8n.cloud/api/v1/executions?workflowId=${wf_id}&limit=3" \
                -H "X-N8N-API-KEY: $N8N_API_KEY")
            
            # Find recent errors
            local new_errors=$(echo "$executions" | jq -r --arg last "$last_check" \
                '.data[] | select(.status == "error" and .startedAt > $last) | .id')
            
            if [ -n "$new_errors" ]; then
                while read -r exec_id; do
                    if [ -n "$exec_id" ]; then
                        echo -e "\n${RED}🚨 New error detected in $wf_name!${NC}"
                        analyze_execution "$exec_id"
                    fi
                done <<< "$new_errors"
            fi
        done
        
        last_check=$current_time
    done
}

# Main
case "${1:-check}" in
    check)
        find_errors "${2:-5}"
        ;;
    analyze)
        if [ -z "$2" ]; then
            echo "Usage: $0 analyze <execution_id>"
            exit 1
        fi
        analyze_execution "$2"
        ;;
    watch)
        watch_errors
        ;;
    *)
        echo "Usage: $0 {check|analyze <exec_id>|watch}"
        echo ""
        echo "Commands:"
        echo "  check [limit]      - Check last N executions for errors (default: 5)"
        echo "  analyze <exec_id>  - Analyze a specific execution"
        echo "  watch              - Continuous monitoring mode"
        exit 1
        ;;
esac

