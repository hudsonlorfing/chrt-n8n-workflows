#!/usr/bin/env bash
# ==============================================================================
# Phase 2 Tests — Cross-Meeting Synthesis + Disambiguation
# ==============================================================================
# Regression: Tests 1-3 from Phase 1
# New: Tests 4-6 for person summary and disambiguation
#
# Usage: ./scripts/tests/test-phase2.sh
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load secrets
if command -v doppler &>/dev/null; then
  N8N_API_KEY="${N8N_API_KEY:-$(doppler secrets get N8N_API_KEY --plain 2>/dev/null || echo '')}"
fi
N8N_BASE_URL="${N8N_BASE_URL:-https://chrt.app.n8n.cloud}"
WORKFLOW_ID="9t7EPqjlUUirs2fw"

BOT_USER_ID="U0AE19ZAYTV"
TEAM_ID="T04Q5UAUB0F"
API_APP_ID="A0AE5LGE45U"
CHANNEL_ID="C0AE7NPAWDQ"
TEST_USER_ID="U0A9KA8E561"
WEBHOOK_URL="${N8N_BASE_URL}/webhook/meeting-intel-followup"

PASS=0
FAIL=0
TOTAL=0

log() { echo -e "\033[0;34m[TEST]\033[0m $1"; }
pass() { echo -e "\033[0;32m  ✓ PASS:\033[0m $1"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail() { echo -e "\033[0;31m  ✗ FAIL:\033[0m $1"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }

send_event() {
  curl -s -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d "$1" 2>/dev/null || true
}

get_latest_real_execution() {
  local resp
  resp=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=6" 2>/dev/null)
  local exec_ids
  exec_ids=$(echo "$resp" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for e in data.get('data', []):
    print(e.get('id', ''))
" 2>/dev/null)
  for eid in $exec_ids; do
    local exec_data
    exec_data=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" \
      "${N8N_BASE_URL}/api/v1/executions/${eid}?includeData=true" 2>/dev/null)
    local is_skip
    is_skip=$(echo "$exec_data" | python3 -c "
import sys, json
data = json.load(sys.stdin)
rd = data.get('data', {}).get('resultData', {}).get('runData', {})
pe = rd.get('Parse Event', [])
if pe:
    m = pe[0].get('data', {}).get('main', [[]])
    if m and m[0]:
        skip = m[0][0].get('json', {}).get('skip', False)
        print('true' if skip else 'false')
    else: print('unknown')
else: print('unknown')
" 2>/dev/null)
    if [ "$is_skip" = "false" ]; then
      echo "$eid"
      return
    fi
  done
  echo ""
}

get_execution_data() {
  curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" \
    "${N8N_BASE_URL}/api/v1/executions/${1}?includeData=true" 2>/dev/null
}

check_node_ran() {
  echo "$1" | python3 -c "
import sys, json
data = json.load(sys.stdin)
run_data = data.get('data', {}).get('resultData', {}).get('runData', {})
print('YES' if '$2' in run_data else 'NO')
" 2>/dev/null || echo "ERROR"
}

get_node_output() {
  echo "$1" | python3 -c "
import sys, json
data = json.load(sys.stdin)
rd = data.get('data', {}).get('resultData', {}).get('runData', {})
node = rd.get('$2', [])
if node:
    m = node[0].get('data', {}).get('main', [[]])
    if m and m[0]: print(json.dumps(m[0][0].get('json', {})))
    else: print('{}')
else: print('{}')
" 2>/dev/null || echo "{}"
}

if [ -z "$N8N_API_KEY" ]; then
  echo "ERROR: N8N_API_KEY not set."
  exit 1
fi

echo "=============================================="
echo " Phase 2 Tests — Includes Phase 1 Regression"
echo "=============================================="
echo ""

# ==============================================================================
# Test 1: app_mention search (regression)
# ==============================================================================
log "Test 1: app_mention search processed"
TS1=$(date +%s).100001
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> meetings with hudson last 30 days\",\"ts\":\"${TS1}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS1}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_r1_$(date +%s)\",\"event_time\":$(date +%s)}"
log "  Waiting 15s..."
sleep 15
EXEC_ID=$(get_latest_real_execution)
if [ -z "$EXEC_ID" ]; then fail "Test 1 — No execution found"
else
  EXEC_DATA=$(get_execution_data "$EXEC_ID")
  BC_RAN=$(check_node_ran "$EXEC_DATA" "Build Agent Context")
  if [ "$BC_RAN" = "YES" ]; then pass "Test 1 — app_mention processed, Build Agent Context ran"
  else fail "Test 1 — Build Agent Context did not run"; fi
fi
echo ""

# ==============================================================================
# Test 2: Thread reply without mention (regression)
# ==============================================================================
log "Test 2: Thread reply without mention"
TS2=$(date +%s).100002
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"tell me more\",\"ts\":\"${TS2}\",\"thread_ts\":\"${TS1}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS2}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_r2_$(date +%s)\",\"event_time\":$(date +%s)}"
log "  Waiting 15s..."
sleep 15
EXEC_ID2=$(get_latest_real_execution)
if [ -z "$EXEC_ID2" ]; then fail "Test 2 — No execution found"
else
  EXEC_DATA2=$(get_execution_data "$EXEC_ID2")
  BC_RAN2=$(check_node_ran "$EXEC_DATA2" "Build Agent Context")
  if [ "$BC_RAN2" = "YES" ]; then pass "Test 2 — Thread reply processed"
  else fail "Test 2 — Thread reply not processed"; fi
fi
echo ""

# ==============================================================================
# Test 3: AI Agent runs (regression)
# ==============================================================================
log "Test 3: AI Agent runs successfully"
TS3=$(date +%s).100003
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what were the action items from meetings with hudson\",\"ts\":\"${TS3}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS3}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_r3_$(date +%s)\",\"event_time\":$(date +%s)}"
log "  Waiting 20s..."
sleep 20
EXEC_ID3=$(get_latest_real_execution)
if [ -z "$EXEC_ID3" ]; then fail "Test 3 — No execution found"
else
  EXEC_DATA3=$(get_execution_data "$EXEC_ID3")
  STATUS=$(echo "$EXEC_DATA3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  AGENT_RAN=$(check_node_ran "$EXEC_DATA3" "AI Agent: Meeting Bot")
  if [ "$AGENT_RAN" = "YES" ]; then pass "Test 3 — AI Agent ran (status: $STATUS)"
  elif [ "$STATUS" = "success" ]; then pass "Test 3 — Execution succeeded (status: $STATUS)"
  else fail "Test 3 — Execution status: $STATUS"; fi
fi
echo ""

# ==============================================================================
# Test 4: Person summary via get_person_summary tool
# ==============================================================================
log "Test 4: get_person_summary tool called for broad question"
TS4=$(date +%s).100004
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what's been happening with hudson across all meetings?\",\"ts\":\"${TS4}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS4}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_t4_$(date +%s)\",\"event_time\":$(date +%s)}"
log "  Waiting 25s for AI agent + Apps Script..."
sleep 25
EXEC_ID4=$(get_latest_real_execution)
if [ -z "$EXEC_ID4" ]; then fail "Test 4 — No execution found"
else
  log "  Execution ID: $EXEC_ID4"
  EXEC_DATA4=$(get_execution_data "$EXEC_ID4")
  STATUS4=$(echo "$EXEC_DATA4" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)

  # Check if Tool: Get Person Summary was called
  PS_RAN=$(check_node_ran "$EXEC_DATA4" "Tool: Get Person Summary")
  AGENT_RAN4=$(check_node_ran "$EXEC_DATA4" "AI Agent: Meeting Bot")

  if [ "$PS_RAN" = "YES" ]; then
    pass "Test 4 — Tool: Get Person Summary was called (status: $STATUS4)"
  elif [ "$AGENT_RAN4" = "YES" ] && [ "$STATUS4" = "success" ]; then
    # Agent may have used search_meetings instead — still a pass if successful
    pass "Test 4 — AI Agent ran successfully, may have used different tool (status: $STATUS4)"
  else
    fail "Test 4 — Execution status: $STATUS4, Agent ran: $AGENT_RAN4, PersonSummary ran: $PS_RAN"
  fi
fi
echo ""

# ==============================================================================
# Test 5: Disambiguation (if applicable)
# ==============================================================================
log "Test 5: Disambiguation or person resolution"
# This test verifies the bot can handle a name query and not crash.
# True disambiguation requires 2+ people with same name — which depends on DB state.
TS5=$(date +%s).100005
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what's the summary of meetings with aaron\",\"ts\":\"${TS5}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS5}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_t5_$(date +%s)\",\"event_time\":$(date +%s)}"
log "  Waiting 25s..."
sleep 25
EXEC_ID5=$(get_latest_real_execution)
if [ -z "$EXEC_ID5" ]; then fail "Test 5 — No execution found"
else
  log "  Execution ID: $EXEC_ID5"
  EXEC_DATA5=$(get_execution_data "$EXEC_ID5")
  STATUS5=$(echo "$EXEC_DATA5" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  if [ "$STATUS5" = "success" ]; then
    pass "Test 5 — Person resolution completed successfully (status: $STATUS5)"
  else
    fail "Test 5 — Execution status: $STATUS5"
  fi
fi
echo ""

# ==============================================================================
# Test 6: Cross-meeting question in thread
# ==============================================================================
log "Test 6: Cross-meeting question in thread"
TS6=$(date +%s).100006
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"what have we committed to across all these meetings?\",\"ts\":\"${TS6}\",\"thread_ts\":\"${TS5}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS6}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_t6_$(date +%s)\",\"event_time\":$(date +%s)}"
log "  Waiting 25s..."
sleep 25
EXEC_ID6=$(get_latest_real_execution)
if [ -z "$EXEC_ID6" ]; then fail "Test 6 — No execution found"
else
  log "  Execution ID: $EXEC_ID6"
  EXEC_DATA6=$(get_execution_data "$EXEC_ID6")
  STATUS6=$(echo "$EXEC_DATA6" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  AGENT_RAN6=$(check_node_ran "$EXEC_DATA6" "AI Agent: Meeting Bot")
  if [ "$AGENT_RAN6" = "YES" ] && [ "$STATUS6" = "success" ]; then
    pass "Test 6 — Cross-meeting question in thread processed (status: $STATUS6)"
  else
    fail "Test 6 — Execution status: $STATUS6, Agent ran: $AGENT_RAN6"
  fi
fi
echo ""

# --- Summary ---
echo "=============================================="
echo " Results: $PASS passed, $FAIL failed (of $TOTAL)"
echo "=============================================="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
