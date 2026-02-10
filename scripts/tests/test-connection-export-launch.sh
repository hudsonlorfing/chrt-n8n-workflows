#!/usr/bin/env bash
# Phase 1 validation: Launch PhantomBuster Connections Export with bonusArgument
# (sessionCookie, userAgent) to test profile override. Requires Phantom API key
# and the cookie/userAgent for the profile you want to run as.
#
# Usage:
#   export PHANTOMBUSTER_API_KEY=your_key
#   export SESSION_COOKIE="<cookie string>"
#   export USER_AGENT="Mozilla/5.0 (...)"
#   ./scripts/tests/test-connection-export-launch.sh
#
# Or: ./scripts/tests/test-connection-export-launch.sh "<cookie>" "<user_agent>"
#
# Agent ID 959265651312489 = Kyle Connections Export (existing).

set -e

API_KEY="${PHANTOMBUSTER_API_KEY:-}"
COOKIE="${1:-$SESSION_COOKIE}"
UA="${2:-$USER_AGENT}"

if [[ -z "$API_KEY" ]]; then
  echo "Error: PHANTOMBUSTER_API_KEY not set. Set it in env or .env." >&2
  exit 1
fi

if [[ -z "$COOKIE" ]]; then
  echo "Error: SESSION_COOKIE not set. Pass as first arg or set SESSION_COOKIE." >&2
  echo "Usage: $0 \"<session_cookie>\" \"<user_agent>\"" >&2
  exit 1
fi

if [[ -z "$UA" ]]; then
  UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
fi

BODY=$(jq -n \
  --arg cookie "$COOKIE" \
  --arg ua "$UA" \
  '{
    id: "959265651312489",
    manualLaunch: true,
    bonusArgument: {
      sessionCookie: $cookie,
      userAgent: $ua,
      sortBy: "Recently added",
      numberOfProfiles: 2000
    }
  }')

echo "Launching Connections Export with bonusArgument (profile override)..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "https://api.phantombuster.com/api/v2/agents/launch" \
  -H "X-Phantombuster-Key-1: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP_BODY=$(echo "$RESP" | head -n -1)
HTTP_CODE=$(echo "$RESP" | tail -n 1)

echo "$HTTP_BODY" | jq . 2>/dev/null || echo "$HTTP_BODY"
echo "HTTP $HTTP_CODE"

if [[ "$HTTP_CODE" != "200" ]]; then
  exit 1
fi

CONTAINER=$(echo "$HTTP_BODY" | jq -r '.containerId // empty')
if [[ -n "$CONTAINER" ]]; then
  echo "ContainerId: $CONTAINER — check PhantomBuster dashboard for run output."
fi
