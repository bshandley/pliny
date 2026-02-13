#!/bin/bash
set -e

cd /opt/stacks/plank

echo "🔄 Checking for updates from Gitea..."

# Store git credentials
git config credential.helper store

# Fetch latest
git fetch origin master 2>/dev/null || git fetch origin main 2>/dev/null || true

# Check for updates
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master 2>/dev/null || git rev-parse origin/main 2>/dev/null || echo "$LOCAL")

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "✅ Already up to date"
    exit 0
fi

echo "📥 New changes detected, deploying..."
echo "   Local:  ${LOCAL:0:8}"
echo "   Remote: ${REMOTE:0:8}"

# Pull changes
git pull origin master 2>/dev/null || git pull origin main 2>/dev/null || git reset --hard origin/master

# Get new commit hash for cache busting
COMMIT_HASH=$(git rev-parse HEAD)

# Rebuild with cache bust (forces fresh COPY on every deploy)
echo "🐳 Rebuilding containers (cache bust: ${COMMIT_HASH:0:8})..."
sudo docker compose build --build-arg CACHE_BUST="$COMMIT_HASH"
sudo docker compose up -d

# Wait for db to be healthy
echo "⏳ Waiting for database..."
sleep 5
for i in {1..30}; do
    if sudo docker compose exec -T db pg_isready -U plank -d plank >/dev/null 2>&1; then
        echo "✅ Database ready"
        break
    fi
    sleep 2
done

# Run migrations (idempotent - safe to run every deploy)
echo "📦 Running database migrations..."
sudo docker compose exec -T server node dist/migrations/run.js 2>&1 || echo "⚠️ Migration runner not found, skipping"

echo "✅ Deployment complete!"
echo "📍 Frontend: http://10.0.0.102:5175"
echo "📍 Backend: http://10.0.0.102:3006"
echo "💾 Database: plank_pgdata (preserved)"

# Log deployment
echo "$(date -Iseconds) - Deployed: ${COMMIT_HASH:0:8}" >> deploy.log
