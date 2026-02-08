#!/bin/bash
set -e

echo "🔄 Pulling latest changes from GitHub..."

cd /opt/stacks/plank

# Fetch latest
git fetch origin master

# Check if there are updates
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "✅ Already up to date"
    exit 0
fi

echo "📥 New changes detected, deploying..."

# Pull changes
git pull origin master

# Rebuild and restart
echo "🐳 Rebuilding containers..."
docker compose down
docker compose up -d --build

echo "✅ Deployment complete!"
echo "📍 Frontend: http://10.0.0.102:5174"
echo "📍 Backend: http://10.0.0.102:3003"
