#!/bin/bash
# AI-Native IDE Development Environment Boot Script
# Starts all required services for local development

set -e

echo "🚀 Starting AI-Native IDE Development Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# Start infrastructure services
echo ""
echo "📦 Starting infrastructure services (Redis, MinIO, PostgreSQL)..."
docker compose up -d redis minio postgres

# Wait for infrastructure to be ready
echo "⏳ Waiting for infrastructure to be ready..."
sleep 5

# Start backend services
echo ""
echo "🔧 Starting backend services..."

# Start API Gateway
echo "  → API Gateway (port 8000)"
docker compose up -d api-gateway &

# Start Project Service
echo "  → Project Service (port 3002)"
docker compose up -d project-service &

# Start Execution Service
echo "  → Execution Service (port 3003)"
docker compose up -d execution-service &

# Start AI Service
echo "  → AI Service (port 8005)"
docker compose up -d ai-service &

# Start WebSocket Gateway
echo "  → WebSocket Gateway (port 8001)"
docker compose up -d websocket-gateway &

# Wait for services to start
echo ""
echo "⏳ Waiting for services to initialize..."
sleep 10

# Check service health
echo ""
echo "🏥 Checking service health..."

check_service() {
    local name=$1
    local url=$2
    if curl -s -f "$url" > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $name"
        return 0
    else
        echo -e "  ${YELLOW}⚠${NC} $name (may need more time)"
        return 1
    fi
}

check_service "API Gateway" "http://localhost:8000/health"
check_service "Project Service" "http://localhost:3002/health"
check_service "Execution Service" "http://localhost:3003/api/v1/health"

# Start frontend (if installed)
echo ""
echo "🎨 Starting frontend IDE..."
cd apps/ide
if command -v pnpm &> /dev/null; then
    pnpm dev &
else
    npm run dev &
fi
cd ../..

echo ""
echo -e "${GREEN}=========================================="
echo "✅ Development Environment Ready!"
echo -e "==========================================${NC}"
echo ""
echo "Services:"
echo "  • API Gateway:        http://localhost:8000"
echo "  • Project Service:    http://localhost:3002"
echo "  • Execution Service:  http://localhost:3003"
echo "  • AI Service:         http://localhost:8005"
echo "  • WebSocket Gateway:  ws://localhost:8001"
echo "  • Frontend IDE:       http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for interrupt
wait
