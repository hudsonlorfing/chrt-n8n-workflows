#!/usr/bin/env bash
# ==============================================================================
# Phase 4 Tests — Full Sales Context Bot
# ==============================================================================
# All tests 1-12: Phase 1 regression, Phase 2 regression, Phase 3 regression,
# plus Phase 4 meeting prep and full conversational flow.
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

get_status() {
  echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null
}

get_agent_output() {
  echo "$1" | python3 -c "
import sys,json; d=json.load(sys.stdin); rd=d.get('data',{}).get('resultData',{}).get('runData',{})
a=rd.get('AI Agent: Meeting Bot',[]); m=a[0].get('data',{}).get('main',[[]]) if a else [[]]
print((m[0][0].get('json',{}).get('output','') if m and m[0] else '')[:500])
" 2>/dev/null || echo ""
}

if [ -z "$N8N_API_KEY" ]; then echo "ERROR: N8N_API_KEY not set."; exit 1; fi

echo "=============================================="
echo " Phase 4 Tests — Full Sales Context Bot"
echo " All 12 tests (regression + new)"
echo "=============================================="
echo ""

# ---- PHASE 1 REGRESSION (Tests 1-3) ----

log "Test 1: app_mention search (regression)"
TS1=$(date +%s).400001
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> meetings with hudson last 30 days\",\"ts\":\"${TS1}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS1}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_1\",\"event_time\":$(date +%s)}"
sleep 15
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); [ "$(check_node_ran "$ED" "Build Agent Context")" = "YES" ] && pass "Test 1" || fail "Test 1"
else fail "Test 1 — No execution"; fi
echo ""

log "Test 2: Thread reply without mention (regression)"
TS2=$(date +%s).400002
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"tell me more\",\"ts\":\"${TS2}\",\"thread_ts\":\"${TS1}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS2}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_2\",\"event_time\":$(date +%s)}"
sleep 15
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); [ "$(check_node_ran "$ED" "Build Agent Context")" = "YES" ] && pass "Test 2" || fail "Test 2"
else fail "Test 2 — No execution"; fi
echo ""

log "Test 3: AI Agent runs (regression)"
TS3=$(date +%s).400003
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what were action items from meetings with hudson\",\"ts\":\"${TS3}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS3}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_3\",\"event_time\":$(date +%s)}"
sleep 20
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); S=$(get_status "$ED")
  [ "$(check_node_ran "$ED" "AI Agent: Meeting Bot")" = "YES" ] && pass "Test 3 ($S)" || { [ "$S" = "success" ] && pass "Test 3 ($S)" || fail "Test 3 ($S)"; }
else fail "Test 3 — No execution"; fi
echo ""

# ---- PHASE 2 REGRESSION (Tests 4-6) ----

log "Test 4: Person summary (regression)"
TS4=$(date +%s).400004
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what's been happening with hudson across all meetings?\",\"ts\":\"${TS4}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS4}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_4\",\"event_time\":$(date +%s)}"
sleep 25
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); S=$(get_status "$ED"); [ "$S" = "success" ] && pass "Test 4 ($S)" || fail "Test 4 ($S)"
else fail "Test 4 — No execution"; fi
echo ""

log "Test 5: Person resolution (regression)"
TS5=$(date +%s).400005
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> summary of meetings with aaron\",\"ts\":\"${TS5}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS5}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_5\",\"event_time\":$(date +%s)}"
sleep 25
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); S=$(get_status "$ED"); [ "$S" = "success" ] && pass "Test 5 ($S)" || fail "Test 5 ($S)"
else fail "Test 5 — No execution"; fi
echo ""

log "Test 6: Cross-meeting in thread (regression)"
TS6=$(date +%s).400006
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"what have we committed to?\",\"ts\":\"${TS6}\",\"thread_ts\":\"${TS5}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS6}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_6\",\"event_time\":$(date +%s)}"
sleep 25
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); S=$(get_status "$ED"); [ "$S" = "success" ] && pass "Test 6 ($S)" || fail "Test 6 ($S)"
else fail "Test 6 — No execution"; fi
echo ""

# ---- PHASE 3 REGRESSION (Tests 7-9) ----

log "Test 7: CRM activity query (regression)"
TS7=$(date +%s).400007
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> what emails and calls have we had with hudson@getchrt.com in the last 30 days?\",\"ts\":\"${TS7}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS7}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_7\",\"event_time\":$(date +%s)}"
sleep 25
E=$(get_latest_real_execution)
if [ -n "$E" ]; then
  ED=$(get_execution_data "$E"); S=$(get_status "$ED")
  CRM_RAN=$(check_node_ran "$ED" "Tool: Get CRM Activity")
  AGENT_RAN=$(check_node_ran "$ED" "AI Agent: Meeting Bot")
  if [ "$CRM_RAN" = "YES" ]; then pass "Test 7 — CRM tool called ($S)"
  elif [ "$AGENT_RAN" = "YES" ] && [ "$S" = "success" ]; then pass "Test 7 ($S)"
  else fail "Test 7 ($S)"; fi
else fail "Test 7 — No execution"; fi
echo ""

log "Test 8: Unknown CRM contact (regression)"
TS8=$(date +%s).400008
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> show me CRM activity for nobody@doesnotexist.com\",\"ts\":\"${TS8}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS8}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_8\",\"event_time\":$(date +%s)}"
sleep 25
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); S=$(get_status "$ED"); [ "$S" = "success" ] && pass "Test 8 ($S)" || fail "Test 8 ($S)"
else fail "Test 8 — No execution"; fi
echo ""

log "Test 9: Combined thread flow (regression)"
TS9=$(date +%s).400009
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"what about emails with them?\",\"ts\":\"${TS9}\",\"thread_ts\":\"${TS7}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS9}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_9\",\"event_time\":$(date +%s)}"
sleep 25
E=$(get_latest_real_execution)
if [ -n "$E" ]; then ED=$(get_execution_data "$E"); S=$(get_status "$ED")
  [ "$(check_node_ran "$ED" "AI Agent: Meeting Bot")" = "YES" ] && [ "$S" = "success" ] && pass "Test 9 ($S)" || fail "Test 9 ($S)"
else fail "Test 9 — No execution"; fi
echo ""

# ---- PHASE 4 NEW TESTS (Tests 10-12) ----

# ==============================================================================
# Test 10: Meeting prep brief
# ==============================================================================
log "Test 10: Meeting prep brief"
TS10=$(date +%s).400010
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> prep me for my call with hudson\",\"ts\":\"${TS10}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS10}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_10\",\"event_time\":$(date +%s)}"
log "  Waiting 30s for AI + Apps Script..."
sleep 30
E10=$(get_latest_real_execution)
if [ -z "$E10" ]; then fail "Test 10 — No execution found"
else
  log "  Execution ID: $E10"
  ED10=$(get_execution_data "$E10")
  S10=$(get_status "$ED10")
  PREP_RAN=$(check_node_ran "$ED10" "Tool: Get Meeting Prep")
  AGENT_RAN10=$(check_node_ran "$ED10" "AI Agent: Meeting Bot")
  if [ "$PREP_RAN" = "YES" ]; then
    pass "Test 10 — Tool: Get Meeting Prep was called ($S10)"
  elif [ "$AGENT_RAN10" = "YES" ] && [ "$S10" = "success" ]; then
    pass "Test 10 — AI Agent handled prep request ($S10)"
  else
    fail "Test 10 — Prep ran: $PREP_RAN, Agent ran: $AGENT_RAN10, status: $S10"
  fi
fi
echo ""

# ==============================================================================
# Test 11: Full conversational flow in thread
# ==============================================================================
log "Test 11: Multi-turn thread flow"

# Step 1: Search meetings
TS11a=$(date +%s).400011
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> find meetings with hudson this month\",\"ts\":\"${TS11a}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS11a}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_11a\",\"event_time\":$(date +%s)}"
log "  Step 1: Search meetings, waiting 20s..."
sleep 20
E11a=$(get_latest_real_execution)
if [ -z "$E11a" ]; then fail "Test 11 — Step 1 no execution"
else
  ED11a=$(get_execution_data "$E11a"); S11a=$(get_status "$ED11a")
  if [ "$S11a" = "success" ]; then log "  Step 1 OK ($S11a)"
  else fail "Test 11 — Step 1 status: $S11a"; fi
fi

# Step 2: Thread reply - select meeting
TS11b=$(date +%s).400012
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"the first one\",\"ts\":\"${TS11b}\",\"thread_ts\":\"${TS11a}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS11b}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_11b\",\"event_time\":$(date +%s)}"
log "  Step 2: Select meeting, waiting 25s..."
sleep 25
E11b=$(get_latest_real_execution)
if [ -z "$E11b" ]; then fail "Test 11 — Step 2 no execution"
else
  ED11b=$(get_execution_data "$E11b"); S11b=$(get_status "$ED11b")
  if [ "$S11b" = "success" ]; then log "  Step 2 OK ($S11b)"
  else fail "Test 11 — Step 2 status: $S11b"; fi
fi

# Step 3: Thread reply - ask about action items
TS11c=$(date +%s).400013
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"what were the action items?\",\"ts\":\"${TS11c}\",\"thread_ts\":\"${TS11a}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS11c}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_11c\",\"event_time\":$(date +%s)}"
log "  Step 3: Ask action items, waiting 25s..."
sleep 25
E11c=$(get_latest_real_execution)
if [ -z "$E11c" ]; then fail "Test 11 — Step 3 no execution"
else
  ED11c=$(get_execution_data "$E11c"); S11c=$(get_status "$ED11c")
  if [ "$S11c" = "success" ]; then log "  Step 3 OK ($S11c)"
  else fail "Test 11 — Step 3 status: $S11c"; fi
fi

# Step 4: Thread reply - ask about emails
TS11d=$(date +%s).400014
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"what about emails?\",\"ts\":\"${TS11d}\",\"thread_ts\":\"${TS11a}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS11d}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_11d\",\"event_time\":$(date +%s)}"
log "  Step 4: Ask about emails, waiting 25s..."
sleep 25
E11d=$(get_latest_real_execution)
if [ -z "$E11d" ]; then fail "Test 11 — Step 4 no execution"
else
  ED11d=$(get_execution_data "$E11d"); S11d=$(get_status "$ED11d")
  if [ "$S11d" = "success" ]; then log "  Step 4 OK ($S11d)"
  else fail "Test 11 — Step 4 status: $S11d"; fi
fi

# Step 5: Thread reply - ask for prep
TS11e=$(date +%s).400015
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"message\",\"user\":\"${TEST_USER_ID}\",\"text\":\"prep me for tomorrow\",\"ts\":\"${TS11e}\",\"thread_ts\":\"${TS11a}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS11e}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_11e\",\"event_time\":$(date +%s)}"
log "  Step 5: Request prep, waiting 30s..."
sleep 30
E11e=$(get_latest_real_execution)
if [ -z "$E11e" ]; then fail "Test 11 — Step 5 no execution"
else
  ED11e=$(get_execution_data "$E11e"); S11e=$(get_status "$ED11e")
  if [ "$S11e" = "success" ]; then
    pass "Test 11 — Full 5-step conversational flow completed successfully"
  else
    fail "Test 11 — Step 5 status: $S11e"
  fi
fi
echo ""

# ==============================================================================
# Test 12: End-to-end with specific meeting (demo data)
# ==============================================================================
log "Test 12: End-to-end with demo meeting data"
TS12=$(date +%s).400016
send_event "{\"token\":\"test\",\"team_id\":\"${TEAM_ID}\",\"api_app_id\":\"${API_APP_ID}\",\"event\":{\"type\":\"app_mention\",\"user\":\"${TEST_USER_ID}\",\"text\":\"<@${BOT_USER_ID}> show me my most recent meeting with structured details\",\"ts\":\"${TS12}\",\"channel\":\"${CHANNEL_ID}\",\"event_ts\":\"${TS12}\"},\"type\":\"event_callback\",\"event_id\":\"Ev_p4_12\",\"event_time\":$(date +%s)}"
log "  Waiting 25s..."
sleep 25
E12=$(get_latest_real_execution)
if [ -z "$E12" ]; then fail "Test 12 — No execution found"
else
  log "  Execution ID: $E12"
  ED12=$(get_execution_data "$E12")
  S12=$(get_status "$ED12")
  AGENT_RAN12=$(check_node_ran "$ED12" "AI Agent: Meeting Bot")
  if [ "$AGENT_RAN12" = "YES" ] && [ "$S12" = "success" ]; then
    OUTPUT12=$(get_agent_output "$ED12")
    log "  Agent output preview: ${OUTPUT12:0:200}..."
    pass "Test 12 — End-to-end demo meeting flow ($S12)"
  else
    fail "Test 12 — Agent ran: $AGENT_RAN12, status: $S12"
  fi
fi
echo ""

# --- Summary ---
echo "=============================================="
echo " Results: $PASS passed, $FAIL failed (of $TOTAL)"
echo "=============================================="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
