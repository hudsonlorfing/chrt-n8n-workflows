#!/bin/bash

# sync-meetings.sh - Sync meeting notes from GitHub to local Obsidian vaults
# Run this manually or set up a cron job for automatic sync

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUSINESS_DIR="/Users/hudsonlorfing/Documents/Business"
MEETINGS_REPO="$BUSINESS_DIR/meeting-notes"
GITHUB_REPO="git@github.com:hudsonlorfing/meeting-notes.git"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Vault paths mapping
declare -A VAULT_PATHS
VAULT_PATHS["chrt"]="$BUSINESS_DIR/Chrt/obsidian/Calendar/Notes/Meetings"
VAULT_PATHS["goodlux"]="$BUSINESS_DIR/GoodLux/obsidian/Calendar/Notes/Meetings"
VAULT_PATHS["personal"]="$BUSINESS_DIR/_personal/obsidian/Calendar/Notes/Meetings"
VAULT_PATHS["shedpro"]="$BUSINESS_DIR/ShedPro/obsidian/Calendar/Notes/Meetings"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Meeting Notes Sync${NC}"
echo -e "${BLUE}$(date)${NC}"
echo -e "${BLUE}============================================${NC}"

# Clone or pull the meetings repo
if [ ! -d "$MEETINGS_REPO" ]; then
    echo -e "${YELLOW}Cloning meeting-notes repository...${NC}"
    git clone "$GITHUB_REPO" "$MEETINGS_REPO"
else
    echo -e "${YELLOW}Pulling latest from meeting-notes...${NC}"
    cd "$MEETINGS_REPO"
    git pull origin main
fi

# Ensure vault directories exist
for folder in "${!VAULT_PATHS[@]}"; do
    target_dir="${VAULT_PATHS[$folder]}"
    if [ ! -d "$target_dir" ]; then
        echo -e "${YELLOW}Creating directory: $target_dir${NC}"
        mkdir -p "$target_dir"
    fi
done

# Sync each folder to its corresponding vault
echo -e "\n${YELLOW}Syncing meeting notes to Obsidian vaults...${NC}"

synced_count=0
for folder in "${!VAULT_PATHS[@]}"; do
    source_dir="$MEETINGS_REPO/$folder"
    target_dir="${VAULT_PATHS[$folder]}"
    
    if [ -d "$source_dir" ]; then
        # Count new files
        new_files=$(rsync -avn --ignore-existing "$source_dir/" "$target_dir/" 2>/dev/null | grep "\.md$" | wc -l | tr -d ' ')
        
        if [ "$new_files" -gt 0 ]; then
            echo -e "${GREEN}  ✓ $folder: $new_files new meeting(s)${NC}"
            rsync -av --ignore-existing "$source_dir/" "$target_dir/"
            synced_count=$((synced_count + new_files))
        else
            echo -e "  ○ $folder: up to date"
        fi
    else
        echo -e "  - $folder: no source folder yet"
    fi
done

echo -e "\n${GREEN}============================================${NC}"
if [ "$synced_count" -gt 0 ]; then
    echo -e "${GREEN}✓ Synced $synced_count new meeting note(s)${NC}"
else
    echo -e "${GREEN}✓ All vaults up to date${NC}"
fi
echo -e "${GREEN}============================================${NC}"

# Show recent meetings
echo -e "\n${BLUE}Recent meetings (last 5):${NC}"
find "$MEETINGS_REPO" -name "*.md" -type f -mtime -7 2>/dev/null | head -5 | while read -r file; do
    basename "$file"
done

echo -e "\n${YELLOW}Tip: Add this to your crontab for automatic sync:${NC}"
echo "*/5 * * * * $SCRIPT_DIR/sync-meetings.sh >/dev/null 2>&1"

