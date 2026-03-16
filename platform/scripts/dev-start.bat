@echo off
REM AI-Native IDE Development Environment Boot Script (Windows)
REM Starts all required services for local development

echo 🚀 Starting AI-Native IDE Development Environment...

REM Check if Docker is running
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: Docker is not running. Please start Docker first.
    exit /b 1
)

echo ✓ Docker is running

REM Start infrastructure services
echo.
echo 📦 Starting infrastructure services...
docker compose up -d redis postgres kafka zookeeper

REM Wait for infrastructure
timeout /t 5 /nobreak >nul

REM Start backend services
echo.
echo 🔧 Starting backend services...

echo   → API Gateway
start /b docker compose up -d api-gateway

echo   → Project Service  
start /b docker compose up -d project-service

echo   → Execution Service
start /b docker compose up -d execution-service

echo   → AI Service
start /b docker compose up -d ai-service

echo   → WebSocket Gateway
start /b docker compose up -d websocket-gateway

REM Wait for services
echo.
echo ⏳ Waiting for services to initialize...
timeout /t 10 /nobreak >nul

REM Check health
echo.
echo 🏥 Checking service health...
curl -s http://localhost:8000/health >nul 2>&1 && echo   ✓ API Gateway || echo   ⚠ API Gateway
curl -s http://localhost:3002/health >nul 2>&1 && echo   ✓ Project Service || echo   ⚠ Project Service
curl -s http://localhost:3003/api/v1/health >nul 2>&1 && echo   ✓ Execution Service || echo   ⚠ Execution Service

echo.
echo ==========================================
echo ✅ Development Environment Ready!
echo ==========================================
echo.
echo Services:
echo   • API Gateway:       http://localhost:8000
echo   • Project Service:   http://localhost:3002
echo   • Execution Service: http://localhost:3003
echo   • AI Service:        http://localhost:8005
echo   • Frontend IDE:      http://localhost:5173
echo.
echo Press Ctrl+C to stop all services
echo.

pause
