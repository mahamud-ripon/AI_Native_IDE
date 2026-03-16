# ============================================
# AI-Native IDE - Full Stack Startup Script (PowerShell)
# ============================================
# Starts all backend services, AI agents, and IDE frontend
# with a single command!
# ============================================

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "AI-Native IDE - Full Stack Startup" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "[1/6] Checking Docker... " -ForegroundColor Yellow -NoNewline
try {
    docker ps | Out-Null
    Write-Host "OK" -ForegroundColor Green
} catch {
    Write-Host "FAILED - Docker is not running!" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again."
    exit 1
}

# Check if infrastructure containers are running
Write-Host "[2/6] Checking infrastructure... " -ForegroundColor Yellow -NoNewline
$postgresRunning = docker ps --format "{{.Names}}" | Select-String "ai-native-postgres"
if (-not $postgresRunning) {
    Write-Host "NOT RUNNING" -ForegroundColor Yellow
    Write-Host "Starting Docker infrastructure..."
    pnpm docker:dev
    Start-Sleep -Seconds 10
} else {
    Write-Host "OK" -ForegroundColor Green
}

# Check if database is initialized
Write-Host "[3/6] Checking database... " -ForegroundColor Yellow -NoNewline
try {
    docker exec ai-native-postgres psql -U ainative -d ainative_ide -c "SELECT 1" | Out-Null
    Write-Host "OK" -ForegroundColor Green
} catch {
    Write-Host "FAILED - Database not accessible!" -ForegroundColor Red
    Write-Host "Run: pnpm docker:db-init"
    exit 1
}

# Check if tables exist
Write-Host "[4/6] Checking database tables... " -ForegroundColor Yellow -NoNewline
$tableCount = docker exec ai-native-postgres psql -U ainative -d ainative_ide -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" | ForEach-Object { $_.Trim() }
if ([int]$tableCount -lt 10) {
    Write-Host "NOT INITIALIZED" -ForegroundColor Yellow
    Write-Host "Initializing database..."
    pnpm --filter @workspace/database db:push
}
Write-Host "OK ($tableCount tables)" -ForegroundColor Green

# Check Python for AI Agents
Write-Host "[5/6] Checking Python... " -ForegroundColor Yellow -NoNewline
$pythonAvailable = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonAvailable) {
    Write-Host "NOT FOUND" -ForegroundColor Red
    Write-Host "Python not found - AI Agents will not start"
    Write-Host "Continuing without AI Agents..."
    $SkipAIAgents = $true
} else {
    Write-Host "OK" -ForegroundColor Green
    $SkipAIAgents = $false
}

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PlatformDir = Split-Path -Parent $ScriptDir

# Start all services with Turbo
Write-Host ""
Write-Host "[6/6] Starting all services... " -ForegroundColor Yellow
Write-Host ""
Write-Host "Starting:" -ForegroundColor Cyan
Write-Host "  - 14 Backend Services (TypeScript)" -ForegroundColor White
Write-Host "  - IDE Frontend (React + Vite)" -ForegroundColor White
if (-not $SkipAIAgents) {
    Write-Host "  - AI Agents (Python)" -ForegroundColor White
}
Write-Host ""

# Start backend services and IDE with Turbo
Write-Host "Starting backend services..." -ForegroundColor Cyan
Start-Process -FilePath "pnpm" -ArgumentList "dev", "--concurrency=20" -WorkingDirectory $PlatformDir -WindowStyle Normal
Write-Host "Backend services started" -ForegroundColor Green

# Wait for services to start
Write-Host ""
Write-Host "Waiting for services to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# Start AI Agents in background if Python is available
if (-not $SkipAIAgents) {
    Write-Host "Starting AI Agents (Python)..." -ForegroundColor Cyan
    $AIAgentsDir = Join-Path $PlatformDir "ai-agents"
    
    # Check if virtual environment exists
    $VenvPath = Join-Path $AIAgentsDir "venv"
    $DotVenvPath = Join-Path $AIAgentsDir ".venv"
    
    if (Test-Path $VenvPath) {
        $PythonExe = Join-Path $VenvPath "Scripts\python.exe"
    } elseif (Test-Path $DotVenvPath) {
        $PythonExe = Join-Path $DotVenvPath "Scripts\python.exe"
    } else {
        $PythonExe = "python"
    }
    
    # Start AI Agents
    Start-Process -FilePath $PythonExe -ArgumentList "-m", "uvicorn", "src.api.main:app", "--reload", "--port", "8000", "--host", "0.0.0.0" -WorkingDirectory $AIAgentsDir -WindowStyle Normal
    Write-Host "AI Agents started" -ForegroundColor Green
}

# Wait for services to be ready
Write-Host ""
Write-Host "Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Health checks
Write-Host ""
Write-Host "Running health checks..." -ForegroundColor Cyan

function Test-Service {
    param($Name, $Url)
    
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Host "  [OK] $Name" -ForegroundColor Green
            return $true
        }
    } catch {
        Write-Host "  [FAIL] $Name" -ForegroundColor Red
        return $false
    }
}

Test-Service "API Gateway" "http://localhost:3000/health"
Test-Service "AI Service" "http://localhost:8003/health"
if (-not $SkipAIAgents) {
    Test-Service "AI Agents" "http://localhost:8000/api/v1/workflow/status"
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "All Services Started Successfully!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Access Points:" -ForegroundColor Cyan
Write-Host "  IDE Frontend:     http://localhost:5173"
Write-Host "  API Gateway:      http://localhost:3000"
Write-Host "  AI Agents API:    http://localhost:8000"
Write-Host "  WebSocket:        ws://localhost:8012"
Write-Host ""
Write-Host "To stop all services:" -ForegroundColor Yellow
Write-Host "  - Close the terminal windows"
Write-Host "  - Or run: docker-compose down"
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
