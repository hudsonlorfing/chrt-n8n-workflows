#!/bin/bash

# sync-meetings.sh - Sync meeting notes from GitHub to local Obsidian vaults
# Compatible with bash 3.x (macOS default)

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

# Vault paths (bash 3 compatible - no associative arrays)
sync_folder() {
    local folder=$1
    local target_dir=$2
    local source_dir="$MEETINGS_REPO/$folder"
    
    if [ -d "$source_dir" ]; then
        # Ensure target directory exists
        mkdir -p "$target_dir"
        
        # Count new files by comparing directories directly (handles Unicode filenames)
        local new_files=0
        local copied_files=0
        
        # Use find to iterate over source files (handles special characters)
        while IFS= read -r -d '' source_file; do
            local filename=$(basename "$source_file")
            local target_file="$target_dir/$filename"
            
            # Check if file doesn't exist in target
            if [ ! -f "$target_file" ]; then
                new_files=$((new_files + 1))
                cp "$source_file" "$target_file"
                copied_files=$((copied_files + 1))
                echo -e "${GREEN}    + $filename${NC}"
            fi
        done < <(find "$source_dir" -maxdepth 1 -name "*.md" -type f -print0 2>/dev/null)
        
        if [ "$copied_files" -gt 0 ]; then
            echo -e "${GREEN}  ✓ $folder: $copied_files new meeting(s)${NC}"
            return $copied_files
        else
            echo -e "  ○ $folder: up to date"
            return 0
        fi
    else
        echo -e "  - $folder: no source folder yet"
        return 0
    fi
}

echo -e "\n${YELLOW}Syncing meeting notes to Obsidian vaults...${NC}"

synced_count=0

# Sync each workspace to its Obsidian vault
# Format: sync_folder "repo_folder" "obsidian_vault_path"

# Chrt meetings
sync_folder "chrt" "$BUSINESS_DIR/Chrt/obsidian/Calendar/Notes/Meetings"
synced_count=$((synced_count + $?))

# ShedPro meetings
sync_folder "shedpro" "$BUSINESS_DIR/ShedPro/obsidian/Calendar/Notes/Meetings"
synced_count=$((synced_count + $?))

# GoodLux meetings
sync_folder "goodlux" "$BUSINESS_DIR/GoodLux/obsidian/Calendar/Notes/Meetings"
synced_count=$((synced_count + $?))

# Personal meetings
sync_folder "personal" "$BUSINESS_DIR/_personal/obsidian/Calendar/Notes/Meetings"
synced_count=$((synced_count + $?))

echo -e "\n${GREEN}============================================${NC}"
if [ "$synced_count" -gt 0 ]; then
    echo -e "${GREEN}✓ Synced $synced_count new meeting note(s)${NC}"
else
    echo -e "${GREEN}✓ All vaults up to date${NC}"
fi
echo -e "${GREEN}============================================${NC}"

# Show recent meetings
echo -e "\n${BLUE}Recent meetings (last 7 days):${NC}"
find "$MEETINGS_REPO" -name "*.md" -type f -mtime -7 2>/dev/null | grep -v README | head -10 | while read -r file; do
    basename "$file"
done

echo -e "\n${YELLOW}Tip: Add this to your crontab for automatic sync:${NC}"
echo "*/5 * * * * $SCRIPT_DIR/sync-meetings.sh >/dev/null 2>&1"
