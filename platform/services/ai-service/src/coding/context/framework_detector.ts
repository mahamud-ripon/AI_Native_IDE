/**
 * Framework Detector
 * 
 * Detects project framework and patterns from configuration files.
 * Results are cached for 5 minutes.
 */

import * as path from 'path';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import {
  FrameworkInfo,
  ProjectType,
  MonorepoInfo,
  MonorepoTool,
  CONFIG_FILES,
  FRAMEWORK_INDICATORS,
  CacheEntry,
  CONTEXT_DEFAULTS,
} from './context_types.js';

// Cache for framework detection
const frameworkCache = new Map<string, CacheEntry<FrameworkInfo | null>>();
const monorepoCache = new Map<string, CacheEntry<MonorepoInfo>>();

/**
 * Detect framework from workspace
 */
export async function detectFramework(workspace: WorkspaceFS): Promise<FrameworkInfo | null> {
  const cacheKey = workspace.getConfig().rootPath;
  
  // Check cache
  const cached = frameworkCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
    return cached.value;
  }

  // Detect framework
  const framework = await doDetectFramework(workspace);
  
  // Cache result
  frameworkCache.set(cacheKey, {
    value: framework,
    timestamp: Date.now(),
    ttlMs: CONTEXT_DEFAULTS.cacheTtlMs,
  });

  return framework;
}

/**
 * Perform actual framework detection
 */
async function doDetectFramework(workspace: WorkspaceFS): Promise<FrameworkInfo | null> {
  // Check for config files that indicate frameworks
  const configFiles = Object.keys(CONFIG_FILES);
  
  for (const configFile of configFiles) {
    if (await workspace.exists(configFile)) {
      const framework = await detectFromFile(workspace, configFile);
      if (framework) {
        return framework;
      }
    }
  }

  // Check package.json for framework dependencies
  if (await workspace.exists(CONFIG_FILES.packageJson)) {
    return await detectFromPackageJson(workspace);
  }

  // Check requirements.txt for Python frameworks
  if (await workspace.exists(CONFIG_FILES.requirements)) {
    return await detectFromRequirements(workspace);
  }

  // Check go.mod for Go frameworks
  if (await workspace.exists(CONFIG_FILES.goMod)) {
    return await detectFromGoMod(workspace);
  }

  // Check Cargo.toml for Rust frameworks
  if (await workspace.exists(CONFIG_FILES.cargoToml)) {
    return await detectFromCargo(workspace);
  }

  return null;
}

/**
 * Detect framework from specific config file
 */
async function detectFromFile(workspace: WorkspaceFS, configFile: string): Promise<FrameworkInfo | null> {
  const indicator = FRAMEWORK_INDICATORS[configFile];
  if (indicator) {
    return {
      name: indicator.framework,
      patterns: indicator.patterns,
    };
  }

  // Check for Next.js config
  if (configFile === CONFIG_FILES.packageJson) {
    return null; // Will be handled by detectFromPackageJson
  }

  return null;
}

/**
 * Detect framework from package.json
 */
async function detectFromPackageJson(workspace: WorkspaceFS): Promise<FrameworkInfo | null> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.packageJson);
    const pkg = JSON.parse(content) as PackageJson;
    
    const allDeps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    // Next.js
    if (allDeps['next']) {
      return {
        name: 'next.js',
        version: allDeps['next'],
        patterns: detectNextJsPatterns(pkg),
      };
    }

    // Nuxt
    if (allDeps['nuxt']) {
      return {
        name: 'nuxt',
        version: allDeps['nuxt'],
        patterns: ['vue', 'ssr'],
      };
    }

    // Express
    if (allDeps['express']) {
      return {
        name: 'express',
        version: allDeps['express'],
        patterns: ['http', 'middleware'],
      };
    }

    // Fastify
    if (allDeps['fastify']) {
      return {
        name: 'fastify',
        version: allDeps['fastify'],
        patterns: ['http', 'plugin', 'schema'],
      };
    }

    // NestJS
    if (allDeps['@nestjs/core']) {
      return {
        name: 'nestjs',
        version: allDeps['@nestjs/core'],
        patterns: ['decorator', 'module', 'di'],
      };
    }

    // React (frontend only)
    if (allDeps['react'] && !allDeps['next'] && !allDeps['nuxt']) {
      return {
        name: 'react',
        version: allDeps['react'],
        patterns: detectReactPatterns(pkg),
      };
    }

    // Vue (frontend only)
    if (allDeps['vue'] && !allDeps['nuxt']) {
      return {
        name: 'vue',
        version: allDeps['vue'],
        patterns: ['spa'],
      };
    }

    // Vite (build tool, may indicate frontend)
    if (allDeps['vite']) {
      return {
        name: 'vite',
        version: allDeps['vite'],
        patterns: ['build', 'hmr'],
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Package.json type
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Detect Next.js patterns
 */
function detectNextJsPatterns(pkg: PackageJson): string[] {
  const patterns: string[] = [];
  
  // App Router (Next.js 13+)
  if (pkg.dependencies?.['next']?.startsWith('13')) {
    patterns.push('app-router');
  }
  
  // Server components
  patterns.push('ssr');
  
  // API routes
  if (pkg.dependencies?.['next-auth']) {
    patterns.push('auth');
  }

  return patterns;
}

/**
 * Detect React patterns
 */
function detectReactPatterns(pkg: PackageJson): string[] {
  const patterns: string[] = [];
  const allDeps: Record<string, string> = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  
  if (allDeps['redux'] || allDeps['@reduxjs/toolkit']) {
    patterns.push('redux');
  }
  
  if (allDeps['react-router'] || allDeps['react-router-dom']) {
    patterns.push('router');
  }
  
  if (allDeps['typescript']) {
    patterns.push('typescript');
  }

  return patterns.length > 0 ? patterns : ['spa'];
}

/**
 * Detect framework from requirements.txt
 */
async function detectFromRequirements(workspace: WorkspaceFS): Promise<FrameworkInfo | null> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.requirements);
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      
      if (trimmed.startsWith('fastapi')) {
        const version = extractVersion(trimmed);
        return { name: 'fastapi', version, patterns: ['async', 'api', 'openapi'] };
      }
      
      if (trimmed.startsWith('django')) {
        const version = extractVersion(trimmed);
        return { name: 'django', version, patterns: ['orm', 'admin', 'mtv'] };
      }
      
      if (trimmed.startsWith('flask')) {
        const version = extractVersion(trimmed);
        return { name: 'flask', version, patterns: ['micro', 'wsgi'] };
      }
      
      if (trimmed.startsWith('fastapi')) {
        const version = extractVersion(trimmed);
        return { name: 'fastapi', version, patterns: ['async', 'api'] };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect framework from go.mod
 */
async function detectFromGoMod(workspace: WorkspaceFS): Promise<FrameworkInfo | null> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.goMod);
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.includes('github.com/gofiber/fiber')) {
        return { name: 'fiber', patterns: ['fast', 'http'] };
      }
      
      if (trimmed.includes('github.com/gin-gonic/gin')) {
        return { name: 'gin', patterns: ['http', 'middleware'] };
      }
      
      if (trimmed.includes('github.com/labstack/echo')) {
        return { name: 'echo', patterns: ['http', 'middleware'] };
      }
      
      if (trimmed.includes('github.com/gofiber/fiber')) {
        return { name: 'fiber', patterns: ['fast', 'http'] };
      }
    }

    return { name: 'go', patterns: ['backend'] };
  } catch {
    return null;
  }
}

/**
 * Detect framework from Cargo.toml
 */
async function detectFromCargo(workspace: WorkspaceFS): Promise<FrameworkInfo | null> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.cargoToml);
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.includes('actix-web')) {
        return { name: 'actix', patterns: ['async', 'http'] };
      }
      
      if (trimmed.includes('rocket')) {
        return { name: 'rocket', patterns: ['async', 'http'] };
      }
      
      if (trimmed.includes('axum')) {
        return { name: 'axum', patterns: ['async', 'http'] };
      }
    }

    return { name: 'rust', patterns: ['backend'] };
  } catch {
    return null;
  }
}

/**
 * Detect monorepo structure
 */
export async function detectMonorepo(workspace: WorkspaceFS): Promise<MonorepoInfo> {
  const cacheKey = workspace.getConfig().rootPath;
  
  // Check cache
  const cached = monorepoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
    return cached.value;
  }

  const result: MonorepoInfo = {
    isMonorepo: false,
    packages: [],
  };

  // Check for monorepo indicators
  if (await workspace.exists(CONFIG_FILES.pnpmWorkspace)) {
    result.isMonorepo = true;
    result.tool = 'pnpm';
    result.packages = await detectPnpmPackages(workspace);
  } else if (await workspace.exists(CONFIG_FILES.turbo)) {
    result.isMonorepo = true;
    result.tool = 'turbo';
    result.packages = await detectTurboPackages(workspace);
  } else if (await workspace.exists(CONFIG_FILES.lerna)) {
    result.isMonorepo = true;
    result.tool = 'lerna';
    result.packages = await detectLernaPackages(workspace);
  } else if (await workspace.exists(CONFIG_FILES.nx)) {
    result.isMonorepo = true;
    result.tool = 'nx';
    result.packages = await detectNxPackages(workspace);
  } else if (await workspace.exists(CONFIG_FILES.rush)) {
    result.isMonorepo = true;
    result.tool = 'rush';
    result.packages = await detectRushPackages(workspace);
  }

  // Cache result
  monorepoCache.set(cacheKey, {
    value: result,
    timestamp: Date.now(),
    ttlMs: CONTEXT_DEFAULTS.cacheTtlMs,
  });

  return result;
}

/**
 * Detect pnpm workspace packages
 */
async function detectPnpmPackages(workspace: WorkspaceFS): Promise<string[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.pnpmWorkspace);
    // Simple YAML parsing for packages list
    const packages: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const match = line.match(/packages:\s*\n([\s\S]*?)(?=\n\w|\s*$)/);
      if (match) {
        const packageLines = match[1].split('\n');
        for (const pkgLine of packageLines) {
          const pkgMatch = pkgLine.match(/-\s*['"]?([^'"]+)['"]?/);
          if (pkgMatch) {
            packages.push(pkgMatch[1]);
          }
        }
      }
    }
    
    return packages;
  } catch {
    return [];
  }
}

/**
 * Detect Turborepo packages
 */
async function detectTurboPackages(workspace: WorkspaceFS): Promise<string[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.turbo);
    const config = JSON.parse(content);
    return Object.keys(config.pipeline || {}).filter(k => !k.startsWith('//'));
  } catch {
    return [];
  }
}

/**
 * Detect Lerna packages
 */
async function detectLernaPackages(workspace: WorkspaceFS): Promise<string[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.lerna);
    const config = JSON.parse(content);
    return config.packages || ['packages/*'];
  } catch {
    return ['packages/*'];
  }
}

/**
 * Detect Nx packages
 */
async function detectNxPackages(workspace: WorkspaceFS): Promise<string[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.nx);
    const config = JSON.parse(content);
    return Object.keys(config.projects || {});
  } catch {
    return [];
  }
}

/**
 * Detect Rush packages
 */
async function detectRushPackages(workspace: WorkspaceFS): Promise<string[]> {
  // Rush uses rush.json
  try {
    if (await workspace.exists('rush.json')) {
      const content = await workspace.readFile('rush.json');
      const config = JSON.parse(content);
      return config.projects?.map((p: { packageName: string }) => p.packageName) || [];
    }
  } catch {
    // Ignore
  }
  return [];
}

/**
 * Determine project type from workspace
 */
export async function detectProjectType(workspace: WorkspaceFS): Promise<ProjectType> {
  const framework = await detectFramework(workspace);
  const monorepo = await detectMonorepo(workspace);
  
  if (monorepo.isMonorepo) {
    return 'monorepo';
  }

  if (!framework) {
    // Check for basic indicators
    if (await workspace.exists(CONFIG_FILES.packageJson)) {
      if (await workspace.exists('tsconfig.json')) {
        return 'nodejs-backend';
      }
      return 'nodejs-backend';
    }
    
    if (await workspace.exists(CONFIG_FILES.requirements) || 
        await workspace.exists(CONFIG_FILES.pyproject)) {
      return 'python-backend';
    }
    
    if (await workspace.exists(CONFIG_FILES.goMod)) {
      return 'go-backend';
    }
    
    if (await workspace.exists(CONFIG_FILES.cargoToml)) {
      return 'rust-backend';
    }

    return 'unknown';
  }

  // Map framework to project type
  const frameworkToType: Record<string, ProjectType> = {
    'next.js': 'nextjs-app',
    'nuxt': 'nodejs-fullstack',
    'react': 'react-frontend',
    'vue': 'react-frontend',
    'express': 'nodejs-backend',
    'fastify': 'nodejs-backend',
    'nestjs': 'nodejs-backend',
    'fastapi': 'python-backend',
    'django': 'python-backend',
    'flask': 'python-backend',
    'fiber': 'go-backend',
    'gin': 'go-backend',
    'echo': 'go-backend',
    'actix': 'rust-backend',
    'rocket': 'rust-backend',
    'axum': 'rust-backend',
  };

  return frameworkToType[framework.name] || 'unknown';
}

/**
 * Detect primary language
 */
export async function detectLanguage(workspace: WorkspaceFS): Promise<string> {
  const projectType = await detectProjectType(workspace);
  
  const typeToLanguage: Record<ProjectType, string> = {
    'nodejs-backend': 'typescript',
    'nodejs-fullstack': 'typescript',
    'react-frontend': 'typescript',
    'nextjs-app': 'typescript',
    'python-backend': 'python',
    'python-script': 'python',
    'go-backend': 'go',
    'rust-backend': 'rust',
    'monorepo': 'typescript',
    'unknown': 'unknown',
  };

  return typeToLanguage[projectType] || 'unknown';
}

/**
 * Extract version from requirement string
 */
function extractVersion(requirement: string): string | undefined {
  const match = requirement.match(/[=<>!]+\s*([\d.]+)/);
  return match ? match[1] : undefined;
}

/**
 * Clear framework detection cache
 */
export function clearFrameworkCache(): void {
  frameworkCache.clear();
  monorepoCache.clear();
}
