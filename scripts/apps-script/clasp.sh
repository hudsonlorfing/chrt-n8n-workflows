#!/usr/bin/env bash
# clasp.sh — Manage multiple Apps Script projects from one directory.
#
# Usage:
#   ./clasp.sh push <script>        Push local file to Apps Script
#   ./clasp.sh pull <script>        Pull remote changes to local
#   ./clasp.sh deploy <script>      Create a new versioned deployment
#   ./clasp.sh deployments <script> List deployments
#   ./clasp.sh open <script>        Open in Apps Script editor
#   ./clasp.sh logs <script>        View execution logs
#   ./clasp.sh redeploy <script>    Push + update existing deployment in place (URL stays the same)
#   ./clasp.sh list                 List all known scripts
#   ./clasp.sh push-all             Push all scripts
#
# <script> is the local filename without .js, e.g.: meeting-context, lead-ingestion
#
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

# ─── Project Map: local filename (no .js) → Apps Script ID ───
# Compatible with bash 3.x (no associative arrays)
SCRIPT_NAMES="conference-check connection-from-update holding-sheet-writer hubspot-audit lead-ingestion meeting-context pipeline-dedupe ready-leads segment-lookup"

get_script_id() {
  case "$1" in
    lead-ingestion)        echo "1c1zDAlEvzHTCtBEDfqjMzRhmLAhUNPycacBDow-Vq-Q7K0SY6DWVwqD6" ;;
    meeting-context)       echo "1HDwfqft2VGmlBE-Pj5T19lYOQXAzoLNg5Ikeuee08ZdUvXXnRymD5fRD" ;;
    segment-lookup)        echo "1GdqyxPR9wLCEtxbSYZFQmKUeTvH_qmVh2lVa-UiLItZfMWAs5-L6Eae2" ;;
    ready-leads)           echo "1hQ0i74qXec5j9_0U78VYuo1WdEnMIdB85bE_oNzjO6cxBaGYYDt5kseb" ;;
    conference-check)      echo "1Jgkfi6qoYO3q_07jZ7qNs7vdcXu5VfRQfdOJEsq5dMi9dPUNT4G_3EYG" ;;
    pipeline-dedupe)       echo "1fWqAHz9wTFJsaesWLUW6PeI7jRQ74ADOMggxHNAi2RHJVJsQHriBbbiR" ;;
    holding-sheet-writer)  echo "1hJ84Hzm6pT0H6TCfJQyFMANLescHxmYffc3fThyhSIzzMXSxvfX3Axm6" ;;
    hubspot-audit)         echo "1ReDyJQfqBuvwBQpf-8-pKWJlJTfXmz10US52pcfiyUqwiw7FXTSyD4CC" ;;
    connection-from-update) echo "1-sZFW1FQS3kV0Fw0GUxlrAd7fac7vrt_hk6LqoviMEAPsuwLRMbu4PQd" ;;
    *) echo "" ;;
  esac
}

# ─── Production Deployment IDs (used by n8n workflows — DO NOT change URLs) ───
# These are the deployment IDs currently referenced in workflow JSON files.
# Use `redeploy` to update code in-place without changing the URL.
get_deploy_id() {
  case "$1" in
    lead-ingestion)        echo "AKfycbwY-Bl8JZt8Zt1FrAp8w2Bi7Gr0UKiKobiPOlKVAhhibjMIErP7QwPhis6dTwPjNL1uIQ" ;;
    meeting-context)       echo "AKfycbybWTFvdZnmPnQkndxAqA4jQQlMC2_gGMZOJULYk5ywyc0IPT2qNn7QIq5SAtC_jUJJRA" ;;
    segment-lookup)        echo "AKfycbyCSJgwmOIRCVVRnSNlNyhzVXiXChkcvTcN8AyTFMvC0lZggut7CDERUp3n4f_uPi5J" ;;
    ready-leads)           echo "AKfycbxUgh_VlR3TG4n5T18K08rFYB3Qga_Z_fZT_uHiR2LBZ-sHpMciV0LfYT5rIR3W9JjAHw" ;;
    conference-check)      echo "AKfycbwy_e5rs0WR54SpB2G7z1CYEYaKblquJByORwN9Z6ipMNIiTBW2aPOFzalUPOIoWAH7" ;;
    pipeline-dedupe)       echo "AKfycby64slS7yjiMFPfPFd3yXziPE3NMnND5WQYg-FKT3YUMO1gf178MnEI2YDcwLHbrD_z" ;;
    batch-update)          echo "AKfycbwNmYEcjOQd0Nj0Qr0cS6oZ3E15Th0E4WxTu0vV_lHHZ-fMd_B-xgSBxeYBupxGJDDl2A" ;;
    *) echo "" ;;
  esac
}

usage() {
  echo "Usage: $0 <command> <script>"
  echo ""
  echo "Commands: push, pull, deploy, redeploy, deployments, open, logs, list, push-all"
  echo ""
  echo "Scripts:"
  for name in $SCRIPT_NAMES; do
    echo "  $name"
  done
  exit 1
}

# Generate temp .clasp.json + .claspignore, run clasp, clean up
run_clasp() {
  local cmd="$1"
  local name="$2"
  local script_id
  script_id=$(get_script_id "$name")

  if [ -z "$script_id" ]; then
    echo -e "${RED}Error: Unknown script '$name'${NC}"
    echo "Known scripts:"
    for n in $SCRIPT_NAMES; do echo "  $n"; done
    exit 1
  fi

  local js_file="$SCRIPT_DIR/${name}.js"
  if [ ! -f "$js_file" ] && [ "$cmd" != "pull" ]; then
    echo -e "${RED}Error: File not found: ${name}.js${NC}"
    exit 1
  fi

  # Write temp .clasp.json
  echo "{\"scriptId\":\"${script_id}\",\"rootDir\":\".\"}" > "$SCRIPT_DIR/.clasp.json"

  # Write temp .claspignore — ignore everything except the target file + manifest
  cat > "$SCRIPT_DIR/.claspignore" <<EOF
**/**
!${name}.js
!appsscript.json
EOF

  echo -e "${BLUE}[$cmd] ${name} → ${script_id:0:12}...${NC}"

  # Run clasp from the apps-script directory
  local exit_code=0
  (cd "$SCRIPT_DIR" && clasp "$cmd") || exit_code=$?

  # After pull: if Code.js was downloaded (legacy name), rename to the correct filename
  if [ "$cmd" = "pull" ] && [ -f "$SCRIPT_DIR/Code.js" ]; then
    mv "$SCRIPT_DIR/Code.js" "$js_file"
    echo -e "${YELLOW}  Renamed Code.js → ${name}.js${NC}"
  fi

  # Clean up temp files
  rm -f "$SCRIPT_DIR/.clasp.json" "$SCRIPT_DIR/.claspignore"

  if [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}✓ ${cmd} succeeded for ${name}${NC}"
  else
    echo -e "${RED}✗ ${cmd} failed for ${name}${NC}"
  fi
  return $exit_code
}

# ─── Main ───

if [ $# -lt 1 ]; then
  usage
fi

CMD="$1"

case "$CMD" in
  list)
    echo -e "${BLUE}Apps Script projects:${NC}"
    for name in $SCRIPT_NAMES; do
      local_file="$SCRIPT_DIR/${name}.js"
      sid=$(get_script_id "$name")
      if [ -f "$local_file" ]; then
        echo -e "  ${GREEN}✓${NC} $name → ${sid:0:16}..."
      else
        echo -e "  ${YELLOW}✗${NC} $name (no local file)"
      fi
    done
    ;;
  push-all)
    echo -e "${BLUE}Pushing all scripts...${NC}"
    for name in $SCRIPT_NAMES; do
      if [ -f "$SCRIPT_DIR/${name}.js" ]; then
        run_clasp push "$name" || true
        echo ""
      fi
    done
    echo -e "${GREEN}Done.${NC}"
    ;;
  redeploy)
    # Push code + update existing deployment in place (keeps the same URL)
    if [ $# -lt 2 ]; then
      echo -e "${RED}Error: Missing script name${NC}"
      usage
    fi
    name="$2"
    deploy_id=$(get_deploy_id "$name")
    if [ -z "$deploy_id" ]; then
      echo -e "${YELLOW}Warning: No production deployment ID known for '$name'.${NC}"
      echo "  This script either has no production deployment or it's not mapped yet."
      echo "  Use './clasp.sh deployments $name' to find the right deployment ID,"
      echo "  then add it to get_deploy_id() in this script."
      echo ""
      echo "  Falling back to push only (no deploy)..."
      run_clasp push "$name"
      exit $?
    fi
    # Step 1: Push code
    run_clasp push "$name"
    # Step 2: Deploy in place
    script_id=$(get_script_id "$name")
    echo "{\"scriptId\":\"${script_id}\",\"rootDir\":\".\"}" > "$SCRIPT_DIR/.clasp.json"
    cat > "$SCRIPT_DIR/.claspignore" <<EOF
**/**
!${name}.js
!appsscript.json
EOF
    echo -e "${BLUE}[redeploy] Updating deployment in place → ${deploy_id:0:20}...${NC}"
    exit_code=0
    (cd "$SCRIPT_DIR" && clasp deploy -i "$deploy_id" -d "Updated from Cursor $(date +%Y-%m-%d)") || exit_code=$?
    rm -f "$SCRIPT_DIR/.clasp.json" "$SCRIPT_DIR/.claspignore"
    if [ $exit_code -eq 0 ]; then
      echo -e "${GREEN}✓ Redeployed ${name} — URL unchanged${NC}"
    else
      echo -e "${RED}✗ Deploy failed for ${name}${NC}"
    fi
    ;;
  push|pull|deploy|deployments|open|logs)
    if [ $# -lt 2 ]; then
      echo -e "${RED}Error: Missing script name${NC}"
      usage
    fi
    run_clasp "$CMD" "$2"
    ;;
  *)
    echo -e "${RED}Unknown command: $CMD${NC}"
    usage
    ;;
esac
