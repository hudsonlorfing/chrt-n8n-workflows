#!/bin/bash
# Setup SSH key authentication for Hostinger VPS

VPS_HOST="srv1230891.hstgr.cloud"
VPS_USER="root"
VPS_PASS='Jb9CVFQG7.XLoEHcz@LK'
PUB_KEY=$(cat ~/.ssh/id_ed25519.pub)

echo "Step 1: Testing connection..."
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

