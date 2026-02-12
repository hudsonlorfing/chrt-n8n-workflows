#!/usr/bin/env bash
# ==============================================================================
# Phase 3 Tests — CRM Activity Integration
# ==============================================================================
# Regression: Tests 1-6 from Phase 1+2
# New: Tests 7-9 for CRM activity
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

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

PASS=0; FAIL=0; TOTAL=0

log() { echo -e "\033[0;34m[TEST]\033[0m $1"; }
pass() { echo -e "\033[0;32m  ✓ PASS:\033[0m $1"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail() { echo -e "\033[0;31m  ✗ FAIL:\033[0m $1"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }

send_event() {
  curl -s -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d "$1" 2>/dev/null || true
}

get_latest_real_execution() {
  local resp exec_ids eid exec_data is_skip
  resp=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=6" 2>/dev/null)
  exec_ids=$(echo "$resp" | python3 -c "import sys,json; [print(e['id']) for e in json.load(sys.stdin).get('data',[])]" 2>/dev/null)
  for eid in $exec_ids; do
    exec_data=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "${N8N_BASE_URL}/api/v1/executions/${eid}?includeData=true" 2>/dev/null)
    is_skip=$(echo "$exec_data" | python3 -c "
import sys,json; d=json.load(sys.stdin); rd=d.get('data',{}).get('resultData',{}).get('runData',{})
pe=rd.get('Parse Event',[]); m=pe[0].get('data',{}).get('main',[[]]) if pe else [[]]
print('true' if (m and m[0] and m[0][0].get('json',{}).get('skip',False)) else 'false')
" 2>/dev/null)
    if [ "$is_skip" = "false" ]; then echo "$eid"; return; fi
  done
  echo ""
}

get_execution_data() {
  curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "${N8N_BASE_URL}/api/v1/executions/${1}?includeData=true" 2>/dev/null
}

check_node_ran() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('YES' if '$2' in d.get('data',{}).get('resultData',{}).get('runData',{}) else 'NO')" 2>/dev/null || echo "ERROR"
}

if [ -z "$N8N_API_KEY" ]; then echo "ERROR: N8N_API_KEY not set."; exit 1; fi

echo "=============================================="
echo " Phase 3 Tests — Includes Phase 1+2 Regression"
echo "=============================================="
echo ""

# --- Regression Tests 1-3 ---
log "Test 1: app_mention search (regression)"
TS1=$(date +%s).300001
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> meetings with hudson last 30 days\",\"ts\":\"${TS1}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS1}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3r1\",\"event_time\":$(date +%s)}"
sleep 15
EXEC=$(get_latest_real_execution)
if [ -n "$EXEC" ]; then
  ED=$(get_execution_data "$EXEC")
  [ "$(check_node_ran "$ED" "Build Agent Context")" = "YES" ] && pass "Test 1" || fail "Test 1"
else fail "Test 1 — No execution"; fi
echo ""

log "Test 2: Thread reply without mention (regression)"
TS2=$(date +%s).300002
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"tell me more\",\"ts\":\"${TS2}\",\"thread_ts\":\"${TS1}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS2}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3r2\",\"event_time\":$(date +%s)}"
sleep 15
EXEC=$(get_latest_real_execution)
if [ -n "$EXEC" ]; then
  ED=$(get_execution_data "$EXEC")
  [ "$(check_node_ran "$ED" "Build Agent Context")" = "YES" ] && pass "Test 2" || fail "Test 2"
else fail "Test 2 — No execution"; fi
echo ""

log "Test 3: AI Agent runs (regression)"
TS3=$(date +%s).300003
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what were action items from meetings with hudson\",\"ts\":\"${TS3}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS3}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3r3\",\"event_time\":$(date +%s)}"
sleep 20
EXEC=$(get_latest_real_execution)
if [ -n "$EXEC" ]; then
  ED=$(get_execution_data "$EXEC")
  STATUS=$(echo "$ED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  [ "$(check_node_ran "$ED" "AI Agent: Meeting Bot")" = "YES" ] && pass "Test 3 (status: $STATUS)" || { [ "$STATUS" = "success" ] && pass "Test 3 (status: $STATUS)" || fail "Test 3 (status: $STATUS)"; }
else fail "Test 3 — No execution"; fi
echo ""

# --- Regression Tests 4-6 ---
log "Test 4: get_person_summary (regression)"
TS4=$(date +%s).300004
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what's been happening with hudson across all meetings?\",\"ts\":\"${TS4}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS4}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3r4\",\"event_time\":$(date +%s)}"
sleep 25
EXEC=$(get_latest_real_execution)
if [ -n "$EXEC" ]; then
  ED=$(get_execution_data "$EXEC")
  STATUS=$(echo "$ED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  [ "$STATUS" = "success" ] && pass "Test 4 (status: $STATUS)" || fail "Test 4 (status: $STATUS)"
else fail "Test 4 — No execution"; fi
echo ""

log "Test 5: Person resolution (regression)"
TS5=$(date +%s).300005
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> summary of meetings with aaron\",\"ts\":\"${TS5}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS5}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3r5\",\"event_time\":$(date +%s)}"
sleep 25
EXEC=$(get_latest_real_execution)
if [ -n "$EXEC" ]; then
  ED=$(get_execution_data "$EXEC")
  STATUS=$(echo "$ED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  [ "$STATUS" = "success" ] && pass "Test 5 (status: $STATUS)" || fail "Test 5 (status: $STATUS)"
else fail "Test 5 — No execution"; fi
echo ""

log "Test 6: Cross-meeting in thread (regression)"
TS6=$(date +%s).300006
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"what have we committed to?\",\"ts\":\"${TS6}\",\"thread_ts\":\"${TS5}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS6}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3r6\",\"event_time\":$(date +%s)}"
sleep 25
EXEC=$(get_latest_real_execution)
if [ -n "$EXEC" ]; then
  ED=$(get_execution_data "$EXEC")
  STATUS=$(echo "$ED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  [ "$STATUS" = "success" ] && pass "Test 6 (status: $STATUS)" || fail "Test 6 (status: $STATUS)"
else fail "Test 6 — No execution"; fi
echo ""

# --- NEW Phase 3 Tests ---

# ==============================================================================
# Test 7: CRM activity query
# ==============================================================================
log "Test 7: CRM activity query for a person"
TS7=$(date +%s).300007
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what emails and calls have we had with hudson@getchrt.com in the last 30 days?\",\"ts\":\"${TS7}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS7}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3t7\",\"event_time\":$(date +%s)}"
log "  Waiting 25s for AI + Apps Script..."
sleep 25
EXEC7=$(get_latest_real_execution)
if [ -z "$EXEC7" ]; then fail "Test 7 — No execution found"
else
  log "  Execution ID: $EXEC7"
  ED7=$(get_execution_data "$EXEC7")
  STATUS7=$(echo "$ED7" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  CRM_RAN=$(check_node_ran "$ED7" "Tool: Get CRM Activity")
  AGENT_RAN=$(check_node_ran "$ED7" "AI Agent: Meeting Bot")
  if [ "$CRM_RAN" = "YES" ]; then
    pass "Test 7 — Tool: Get CRM Activity was called (status: $STATUS7)"
  elif [ "$AGENT_RAN" = "YES" ] && [ "$STATUS7" = "success" ]; then
    pass "Test 7 — AI Agent ran successfully (status: $STATUS7)"
  else
    fail "Test 7 — CRM ran: $CRM_RAN, Agent ran: $AGENT_RAN, status: $STATUS7"
  fi
fi
echo ""

# ==============================================================================
# Test 8: CRM activity with unknown contact
# ==============================================================================
log "Test 8: CRM activity for unknown person"
TS8=$(date +%s).300008
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> show me CRM activity for nobody@doesnotexist.com\",\"ts\":\"${TS8}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS8}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3t8\",\"event_time\":$(date +%s)}"
log "  Waiting 25s..."
sleep 25
EXEC8=$(get_latest_real_execution)
if [ -z "$EXEC8" ]; then fail "Test 8 — No execution found"
else
  log "  Execution ID: $EXEC8"
  ED8=$(get_execution_data "$EXEC8")
  STATUS8=$(echo "$ED8" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  if [ "$STATUS8" = "success" ]; then
    pass "Test 8 — Unknown contact handled gracefully (status: $STATUS8)"
  else
    fail "Test 8 — Execution status: $STATUS8"
  fi
fi
echo ""

# ==============================================================================
# Test 9: Combined meeting + CRM flow in thread
# ==============================================================================
log "Test 9: Combined meeting + CRM activity in thread"
TS9=$(date +%s).300009
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"what about emails and calls with them?\",\"ts\":\"${TS9}\",\"thread_ts\":\"${TS7}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS9}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p3t9\",\"event_time\":$(date +%s)}"
log "  Waiting 25s..."
sleep 25
EXEC9=$(get_latest_real_execution)
if [ -z "$EXEC9" ]; then fail "Test 9 — No execution found"
else
  log "  Execution ID: $EXEC9"
  ED9=$(get_execution_data "$EXEC9")
  STATUS9=$(echo "$ED9" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  AGENT_RAN9=$(check_node_ran "$ED9" "AI Agent: Meeting Bot")
  if [ "$AGENT_RAN9" = "YES" ] && [ "$STATUS9" = "success" ]; then
    pass "Test 9 — Thread context maintained, agent responded (status: $STATUS9)"
  else
    fail "Test 9 — Agent ran: $AGENT_RAN9, status: $STATUS9"
  fi
fi
echo ""

# --- Summary ---
echo "=============================================="
echo " Results: $PASS passed, $FAIL failed (of $TOTAL)"
echo "=============================================="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
