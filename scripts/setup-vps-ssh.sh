#!/bin/bash
# Setup SSH key authentication for Hostinger VPS
# Requires: doppler CLI configured with chrt project

set -e

# Check for Doppler CLI
if ! command -v doppler &> /dev/null; then
    echo "Error: doppler CLI required."
    echo "Install: brew install dopplerhq/cli/doppler"
    echo "Then run: doppler login && doppler setup"
    exit 1
fi

# Load secrets from Doppler
echo "Loading secrets from Doppler..."
eval $(doppler secrets download --no-file --format env)

# Validate required secrets
if [ -z "$VPS_HOST" ] || [ -z "$VPS_PASSWORD" ]; then
    echo "Error: VPS_HOST and VPS_PASSWORD must be set in Doppler"
    exit 1
fi

VPS_USER="root"
VPS_PASS="$VPS_PASSWORD"
PUB_KEY=$(cat ~/.ssh/id_ed25519.pub)

echo "Step 1: Testing connection to $VPS_HOST..."
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 "$VPS_USER@$VPS_HOST" "echo 'Connection successful! Hostname:' && hostname" 2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "Step 2: Adding SSH key..."
    sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "
        mkdir -p ~/.ssh
        echo '$PUB_KEY' >> ~/.ssh/authorized_keys
        sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys
        chmod 700 ~/.ssh
        chmod 600 ~/.ssh/authorized_keys
        echo 'SSH key added! Keys in authorized_keys:'
        wc -l < ~/.ssh/authorized_keys
    " 2>&1
    
    echo ""
    echo "Step 3: Testing key-based auth..."
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_USER@$VPS_HOST" "echo 'Key auth working!'" 2>&1
else
    echo "Connection failed!"
    exit 1
fi
