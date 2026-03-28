#!/usr/bin/env node
/**
 * Windows-compatible development script
 * Starts all services manually since Turbo has I/O issues on Windows
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const services = [
  { name: 'IDE Client', cmd: 'pnpm', args: ['dev'], cwd: 'apps/ide', color: colors.cyan },
  { name: 'API Gateway', cmd: 'pnpm', args: ['dev'], cwd: 'services/api-gateway', color: colors.green },
  { name: 'Auth Service', cmd: 'pnpm', args: ['dev'], cwd: 'services/auth-service', color: colors.blue },
  { name: 'Project Service', cmd: 'pnpm', args: ['dev'], cwd: 'services/project-service', color: colors.magenta },
  { name: 'AI Service', cmd: 'pnpm', args: ['dev'], cwd: 'services/ai-service', color: colors.yellow }
];

const processes = [];

function log(service, message, type = 'info') {
  const prefix = `${service.color}[${service.name}]${colors.reset}`;
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${prefix} ${message}`);
}

function startService(service) {
  const servicePath = path.join(__dirname, '..', service.cwd);
  
  if (!fs.existsSync(servicePath)) {
    log(service, `${colors.red}Directory not found: ${servicePath}${colors.reset}`, 'error');
    return;
  }

  log(service, `${colors.dim}Starting...${colors.reset}`);
  
  const proc = spawn(service.cmd, service.args, {
    cwd: servicePath,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  processes.push({ service, proc });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) log(service, line);
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) log(service, `${colors.red}${line}${colors.reset}`);
    });
  });

  proc.on('close', (code) => {
    log(service, `${colors.red}Process exited with code ${code}${colors.reset}`, 'error');
  });

  proc.on('error', (err) => {
    log(service, `${colors.red}Failed to start: ${err.message}${colors.reset}`, 'error');
  });
}

// Handle cleanup
function cleanup() {
  console.log(`\n${colors.yellow}Shutting down services...${colors.reset}`);
  processes.forEach(({ service, proc }) => {
    log(service, 'Stopping...');
    proc.kill('SIGTERM');
  });
  setTimeout(() => {
    processes.forEach(({ proc }) => {
      if (!proc.killed) proc.kill('SIGKILL');
    });
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

console.log(`${colors.bright}${colors.green}Starting development servers...${colors.reset}\n`);

// Start all services
services.forEach(startService);

console.log(`\n${colors.dim}Press Ctrl+C to stop all services${colors.reset}\n`);
