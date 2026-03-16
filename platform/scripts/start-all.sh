#!/bin/bash

# ============================================
# AI-Native IDE - Full Stack Startup Script
# ============================================
# Starts all backend services, AI agents, and IDE frontend
# with a single command!
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     AI-Native IDE - Full Stack Startup                   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Docker is running
echo -ne "${YELLOW}[1/5] Checking Docker...${NC} "
if ! docker ps &> /dev/null; then
    echo -e "${RED}❌ Docker is not running!${NC}"
    echo "Please start Docker Desktop and try again."
    exit 1
fi
echo -e "${GREEN}✅ Docker running${NC}"

# Check if infrastructure containers are running
echo -ne "${YELLOW}[2/5] Checking infrastructure...${NC} "
if ! docker ps | grep -q "ai-native-postgres"; then
    echo -e "${YELLOW}⚠️  Infrastructure not running${NC}"
    echo "Starting Docker infrastructure..."
    cd "$(dirname "$0")"
    pnpm docker:dev
    sleep 10
fi
echo -e "${GREEN}✅ Infrastructure ready${NC}"

# Check if database is initialized
echo -ne "${YELLOW}[3/5] Checking database...${NC} "
if ! docker exec ai-native-postgres psql -U ainative -d ainative_ide -c "SELECT 1" &> /dev/null; then
    echo -e "${RED}❌ Database not accessible!${NC}"
    echo "Run: pnpm docker:db-init"
    exit 1
fi

# Check if tables exist
TABLE_COUNT=$(docker exec ai-native-postgres psql -U ainative -d ainative_ide -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" | tr -d ' ')
if [ "$TABLE_COUNT" -lt 10 ]; then
    echo -e "${YELLOW}⚠️  Database not initialized${NC}"
    echo "Initializing database..."
    pnpm --filter @workspace/database db:push
fi
echo -e "${GREEN}✅ Database ready ($TABLE_COUNT tables)${NC}"

# Check Python for AI Agents
echo -ne "${YELLOW}[4/5] Checking Python...${NC} "
if ! command -v python &> /dev/null; then
    echo -e "${RED}❌ Python not found!${NC}"
    echo "Please install Python 3.11+ to run AI Agents"
    echo "Continuing without AI Agents..."
    SKIP_AI_AGENTS=true
else
    echo -e "${GREEN}✅ Python available${NC}"
    SKIP_AI_AGENTS=false
fi

# Start all services with Turbo
echo -e "${YELLOW}[5/5] Starting all services...${NC}"
echo ""
echo -e "${BLUE}Starting:${NC}"
echo "  ✅ 14 Backend Services (TypeScript)"
echo "  ✅ IDE Frontend (React + Vite)"
if [ "$SKIP_AI_AGENTS" = false ]; then
    echo "  ✅ AI Agents (Python) - in background"
fi
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Start backend services and IDE with Turbo
# Using --concurrency to allow all persistent tasks
echo -e "${CYAN}Starting backend services...${NC}"
pnpm dev --concurrency=20 &
TURBO_PID=$!

# Wait for services to start
echo -e "${YELLOW}Waiting for services to initialize...${NC}"
sleep 10

# Start AI Agents in background if Python is available
if [ "$SKIP_AI_AGENTS" = false ]; then
    echo -e "${CYAN}Starting AI Agents (Python)...${NC}"
    cd "$SCRIPT_DIR/ai-agents"
    
    # Check if virtual environment exists
    if [ -d "venv" ]; then
        source venv/bin/activate
    elif [ -d ".venv" ]; then
        source .venv/bin/activate
    fi
    
    # Start AI Agents
    python -m uvicorn src.api.main:app --reload --port 8000 --host 0.0.0.0 &
    AI_PID=$!
    echo -e "${GREEN}✅ AI Agents started (PID: $AI_PID)${NC}"
fi

echo -e "${GREEN}✅ Backend services started (PID: $TURBO_PID)${NC}"
echo ""

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 15

# Health checks
echo ""
echo -e "${CYAN}Running health checks...${NC}"

check_service() {
    local name="$1"
    local url="$2"
    
    if curl -s --connect-timeout 3 "$url" | grep -q "ok\|status"; then
        echo -e "  ${GREEN}✅${NC} $name"
        return 0
    else
        echo -e "  ${RED}❌${NC} $name"
        return 1
    fi
}

check_service "API Gateway" "http://localhost:3000/health"
check_service "AI Service" "http://localhost:8003/health"
if [ "$SKIP_AI_AGENTS" = false ]; then
    check_service "AI Agents" "http://localhost:8000/api/v1/workflow/status" || true
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           🎉 All Services Started Successfully!          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Access Points:${NC}"
echo "  🌐 IDE Frontend:     ${CYAN}http://localhost:5173${NC}"
echo "  🔌 API Gateway:      ${CYAN}http://localhost:3000${NC}"
echo "  🤖 AI Agents API:    ${CYAN}http://localhost:8000${NC}"
echo "  🔌 WebSocket:        ${CYAN}ws://localhost:8012${NC}"
echo ""
echo -e "${BLUE}Service Dashboard:${NC}"
echo "  📊 All logs:         ${CYAN}Check the terminal output above${NC}"
echo ""
echo -e "${YELLOW}To stop all services:${NC}"
echo "  Press ${CYAN}Ctrl+C${NC} in this terminal"
echo "  Or run: ${CYAN}pnpm --filter \"@ai-ide/*\" stop${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services...${NC}"
echo ""

# Wait for user to press Ctrl+C
wait $TURBO_PID
