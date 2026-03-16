#!/bin/bash
# LLM Gateway Integration Test Runner
# Runs tests against Docker Compose infrastructure

set -e

echo "=== LLM Gateway Integration Test Suite ==="
echo ""

# Check if Docker Compose is running
if ! docker ps | grep -q "ai-native"; then
    echo "Starting Docker Compose infrastructure..."
    docker-compose up -d postgres redis kafka zookeeper
    echo "Waiting for services to be ready..."
    sleep 15
fi

# Set environment for tests
export REDIS_URL="redis://localhost:6379"
export KAFKA_BROKERS="localhost:9092"

# Test 1: Health Check
echo ""
echo "=== Test 1: Gateway Health ==="
curl -s http://localhost:8005/ai/llm/health | jq '.' || echo "Health endpoint not available (service not running)"

# Test 2: Single Completion
echo ""
echo "=== Test 2: Single Completion ==="
curl -s -X POST http://localhost:8005/ai/llm/complete \
    -H "Content-Type: application/json" \
    -H "x-user-id: test-user-001" \
    -d '{
        "workflowId": "test-workflow-001",
        "projectId": "test-project-001",
        "agentName": "plan_agent",
        "stepName": "test-step",
        "taskType": "plan",
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Say hello in one word."}
        ],
        "maxTokens": 10
    }' | jq '.' || echo "Completion endpoint not available"

# Test 3: Streaming
echo ""
echo "=== Test 3: Streaming ==="
curl -s -X POST http://localhost:8005/ai/llm/stream \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d '{
        "workflowId": "test-workflow-002",
        "projectId": "test-project-001",
        "agentName": "backend_agent",
        "stepName": "stream-test",
        "taskType": "codegen",
        "messages": [
            {"role": "user", "content": "Write a hello world function in Python."}
        ],
        "maxTokens": 50
    }' | head -20 || echo "Stream endpoint not available"

# Test 4: Cache Verification
echo ""
echo "=== Test 4: Redis Cache ==="
echo "Checking Redis keys..."
docker exec ai-native-redis redis-cli KEYS "llm:cache:*" | head -10 || echo "Redis not available"

# Test 5: Kafka Topics
echo ""
echo "=== Test 5: Kafka Topics ==="
docker exec ai-native-kafka kafka-topics --bootstrap-server localhost:9092 --list 2>/dev/null | grep -E "ai.llm" || echo "Kafka not available or topics not created"

echo ""
echo "=== Integration Test Complete ==="
echo ""
echo "To run full tests, ensure:"
echo "  1. Docker Compose services are running"
echo "  2. API keys are set in .env or environment"
echo "  3. ai-service is running on port 8005"
echo ""
echo "Run 'docker-compose up -d' to start infrastructure"
echo "Run 'pnpm dev' in ai-service to start the service"
