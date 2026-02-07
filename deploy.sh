#!/bin/bash
set -e

echo "🚀 Deploying Wiz Kanban to Wharf (10.0.0.102)..."

# Check if .env exists
if [ ! -f .env ]; then
  echo "⚠️  .env file not found. Creating from .env.example..."
  cp .env.example .env
  echo "✏️  Please edit .env with your configuration."
  exit 1
fi

# Build and start containers
echo "📦 Building Docker images..."
docker-compose build

echo "🎬 Starting containers..."
docker-compose up -d

echo "⏳ Waiting for database..."
sleep 5

echo "🗄️  Running database migrations..."
docker-compose exec -T server npm run migrate

echo "✅ Deployment complete!"
echo ""
echo "Access the application:"
echo "  Frontend: http://10.0.0.102:5173"
echo "  Backend:  http://10.0.0.102:3001"
echo ""
echo "Default login:"
echo "  Username: admin"
echo "  Password: admin123"
echo ""
echo "⚠️  Remember to change the default password!"
