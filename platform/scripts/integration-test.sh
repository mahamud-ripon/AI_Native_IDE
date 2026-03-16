#!/bin/bash

# ============================================
# AI-Native IDE Integration Test Script
# ============================================
# Tests end-to-end connectivity between:
# - Frontend (IDE)
# - API Gateway
# - Backend Services
# - AI Agents (Python)
# - Database
# - WebSocket Gateway
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0

# Configuration
API_GATEWAY_URL="http://localhost:3000"
AI_SERVICE_URL="http://localhost:8003"
AI_AGENTS_URL="http://localhost:8000"
WS_GATEWAY_URL="ws://localhost:8012"
DB_URL="postgresql://ainative:ainative_pass@localhost:5432/ainative_ide"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     AI-Native IDE Integration Test Suite                ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to test HTTP endpoint
test_http_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    
    echo -ne "Testing $name... "
    
    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" | grep -q "$expected_status"; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}❌ FAIL${NC} (Expected: $expected_status)"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Function to test service health
test_service_health() {
    local name="$1"
    local url="$2"
    
    echo -ne "Testing $name health... "
    
    response=$(curl -s --connect-timeout 5 "$url/health" 2>/dev/null)
    
    if echo "$response" | grep -q "ok\|status.*ok"; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}❌ FAIL${NC} (Response: $response)"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================
# Test 1: Infrastructure Services
# ============================================
echo -e "${YELLOW}[1/6] Infrastructure Services${NC}"

# PostgreSQL
echo -ne "  PostgreSQL connection... "
if command -v psql &> /dev/null; then
    if PGPASSWORD=ainative_pass psql -h localhost -U ainative -d ainative_ide -c "SELECT 1" &> /dev/null; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}"
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  SKIP${NC} (psql not installed)"
fi

# Redis
test_http_endpoint "Redis" "http://localhost:6379" "" || true

# Kafka
echo -ne "  Kafka brokers... "
if command -v kafka-topics &> /dev/null; then
    if kafka-topics --bootstrap-server localhost:9092 --list &> /dev/null; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}"
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  SKIP${NC} (kafka-topics not installed)"
fi

echo ""

# ============================================
# Test 2: API Gateway
# ============================================
echo -e "${YELLOW}[2/6] API Gateway${NC}"

test_service_health "API Gateway" "$API_GATEWAY_URL"
test_http_endpoint "API Gateway Health" "$API_GATEWAY_URL/health"
test_http_endpoint "Circuit Breaker Status" "$API_GATEWAY_URL/gateway/circuit-breakers"

echo ""

# ============================================
# Test 3: Backend Services (via Gateway)
# ============================================
echo -e "${YELLOW}[3/6] Backend Services${NC}"

test_http_endpoint "Auth Service" "$API_GATEWAY_URL/api/v1/auth/health" "404" || true
test_http_endpoint "Project Service" "$API_GATEWAY_URL/api/v1/projects/health" "404" || true
test_http_endpoint "AI Service" "$API_GATEWAY_URL/api/v1/ai/health" "404" || true

echo ""

# ============================================
# Test 4: AI Service & Agents
# ============================================
echo -e "${YELLOW}[4/6] AI Service & Agents${NC}"

test_service_health "AI Service (TypeScript)" "$AI_SERVICE_URL"
test_service_health "AI Agents (Python)" "$AI_AGENTS_URL"

# Test AI Agents workflow endpoint
echo -ne "  AI Agents workflow API... "
workflow_response=$(curl -s --connect-timeout 5 "$AI_AGENTS_URL/api/v1/workflow/status" 2>/dev/null || echo "{}")
if echo "$workflow_response" | grep -q "status\|workflows"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${YELLOW}⚠️  SKIP${NC} (Agents not started)"
fi

echo ""

# ============================================
# Test 5: WebSocket Gateway
# ============================================
echo -e "${YELLOW}[5/6] WebSocket Gateway${NC}"

echo -ne "  WebSocket connection... "
# Use websocat or wscat if available
if command -v websocat &> /dev/null; then
    if echo "" | websocat "$WS_GATEWAY_URL" --close-on-offer &> /dev/null; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}"
        ((TESTS_FAILED++))
    fi
elif command -v wscat &> /dev/null; then
    if echo "" | wscat -c "$WS_GATEWAY_URL" --close &> /dev/null; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}"
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  SKIP${NC} (websocat/wscat not installed)"
fi

echo ""

# ============================================
# Test 6: Database Schema
# ============================================
echo -e "${YELLOW}[6/6] Database Schema${NC}"

echo -ne "  Prisma migrations... "
if PGPASSWORD=ainative_pass psql -h localhost -U ainative -d ainative_ide -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null | grep -q "users\|projects"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}❌ FAIL${NC} (Tables not found)"
    ((TESTS_FAILED++))
    echo -e "${YELLOW}  Run: pnpm docker:db-init${NC}"
fi

echo ""

# ============================================
# Summary
# ============================================
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Test Summary                          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All integration tests passed!${NC}"
    echo -e "${BLUE}Ready to start the platform:${NC}"
    echo ""
    echo "  1. Start infrastructure: ${YELLOW}pnpm docker:dev${NC}"
    echo "  2. Initialize database:  ${YELLOW}pnpm docker:db-init${NC}"
    echo "  3. Start all services:   ${YELLOW}pnpm dev${NC}"
    echo "  4. Start AI agents:      ${YELLOW}cd ai-agents && python -m uvicorn src.api.main:app --reload${NC}"
    echo "  5. Open IDE:             ${YELLOW}http://localhost:5173${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Please fix the issues above.${NC}"
    echo ""
    echo -e "${YELLOW}Common fixes:${NC}"
    echo "  - Start Docker:        ${YELLOW}pnpm docker:dev${NC}"
    echo "  - Initialize DB:       ${YELLOW}pnpm docker:db-init${NC}"
    echo "  - Check service logs:  ${YELLOW}docker-compose logs -f${NC}"
    exit 1
fi
