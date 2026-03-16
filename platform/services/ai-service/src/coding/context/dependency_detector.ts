/**
 * Dependency Detector
 * 
 * Parses dependencies from various package manager files.
 * Results are cached for 5 minutes.
 */

import { WorkspaceFS } from '../workspace/workspace_fs.js';
import {
  Dependency,
  CONFIG_FILES,
  CacheEntry,
  CONTEXT_DEFAULTS,
} from './context_types.js';

// Cache for dependency detection
const dependencyCache = new Map<string, CacheEntry<Dependency[]>>();

/**
 * Detect dependencies from workspace
 */
export async function detectDependencies(workspace: WorkspaceFS): Promise<Dependency[]> {
  const cacheKey = workspace.getConfig().rootPath;
  
  // Check cache
  const cached = dependencyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
    return cached.value;
  }

  // Detect dependencies based on project type
  const dependencies: Dependency[] = [];

  // Node.js / JavaScript / TypeScript
  if (await workspace.exists(CONFIG_FILES.packageJson)) {
    const pkgDeps = await parsePackageJson(workspace);
    dependencies.push(...pkgDeps);
  }

  // Python
  if (await workspace.exists(CONFIG_FILES.requirements)) {
    const pyDeps = await parseRequirements(workspace);
    dependencies.push(...pyDeps);
  }

  if (await workspace.exists(CONFIG_FILES.pyproject)) {
    const pyprojectDeps = await parsePyproject(workspace);
    dependencies.push(...pyprojectDeps);
  }

  // Go
  if (await workspace.exists(CONFIG_FILES.goMod)) {
    const goDeps = await parseGoMod(workspace);
    dependencies.push(...goDeps);
  }

  // Rust
  if (await workspace.exists(CONFIG_FILES.cargoToml)) {
    const rustDeps = await parseCargo(workspace);
    dependencies.push(...rustDeps);
  }

  // Cache result
  dependencyCache.set(cacheKey, {
    value: dependencies,
    timestamp: Date.now(),
    ttlMs: CONTEXT_DEFAULTS.cacheTtlMs,
  });

  return dependencies;
}

/**
 * Parse package.json dependencies
 */
async function parsePackageJson(workspace: WorkspaceFS): Promise<Dependency[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.packageJson);
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const dependencies: Dependency[] = [];

    // Production dependencies
    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        dependencies.push({
          name,
          version: version || 'latest',
          type: 'production',
        });
      }
    }

    // Development dependencies
    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        dependencies.push({
          name,
          version: version || 'latest',
          type: 'development',
        });
      }
    }

    return dependencies;
  } catch {
    return [];
  }
}

/**
 * Parse requirements.txt dependencies
 */
async function parseRequirements(workspace: WorkspaceFS): Promise<Dependency[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.requirements);
    const lines = content.split('\n');
    const dependencies: Dependency[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse package==version, package>=version, etc.
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)(.*)$/);
      if (match) {
        const name = match[1];
        const versionSpec = match[2].trim();
        
        // Extract version from spec
        const versionMatch = versionSpec.match(/[=<>!]+\s*([\d.]+)/);
        const version = versionMatch ? versionMatch[1] : versionSpec || 'latest';

        dependencies.push({
          name,
          version,
          type: 'production',
        });
      }
    }

    return dependencies;
  } catch {
    return [];
  }
}

/**
 * Parse pyproject.toml dependencies
 */
async function parsePyproject(workspace: WorkspaceFS): Promise<Dependency[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.pyproject);
    const dependencies: Dependency[] = [];

    // Simple TOML parsing for dependencies
    // Look for [project.dependencies] and [project.optional-dependencies]
    let inDependencies = false;
    let inOptionalDeps = false;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      if (trimmed === '[project.dependencies]') {
        inDependencies = true;
        inOptionalDeps = false;
        continue;
      }

      if (trimmed.startsWith('[project.optional-dependencies')) {
        inDependencies = false;
        inOptionalDeps = true;
        continue;
      }

      if (trimmed.startsWith('[') && !trimmed.startsWith('[project')) {
        inDependencies = false;
        inOptionalDeps = false;
        continue;
      }

      if (inDependencies || inOptionalDeps) {
        // Parse: package = "version" or package = ">=version"
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']([^"']+)["']/);
        if (match) {
          dependencies.push({
            name: match[1],
            version: extractVersionFromSpec(match[2]),
            type: inOptionalDeps ? 'development' : 'production',
          });
        }
      }
    }

    return dependencies;
  } catch {
    return [];
  }
}

/**
 * Parse go.mod dependencies
 */
async function parseGoMod(workspace: WorkspaceFS): Promise<Dependency[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.goMod);
    const lines = content.split('\n');
    const dependencies: Dependency[] = [];

    let inRequire = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Single-line require
      const singleRequire = trimmed.match(/^require\s+(\S+)\s+(\S+)/);
      if (singleRequire && !trimmed.includes('(')) {
        dependencies.push({
          name: singleRequire[1],
          version: singleRequire[2],
          type: 'production',
        });
        continue;
      }

      // Multi-line require block
      if (trimmed === 'require (') {
        inRequire = true;
        continue;
      }

      if (trimmed === ')' && inRequire) {
        inRequire = false;
        continue;
      }

      if (inRequire) {
        const match = trimmed.match(/^(\S+)\s+(\S+)/);
        if (match) {
          dependencies.push({
            name: match[1],
            version: match[2],
            type: 'production',
          });
        }
      }

      // Indirect dependencies
      const indirectMatch = trimmed.match(/^(\S+)\s+(\S+)\s*\/\/\s*indirect/);
      if (indirectMatch) {
        dependencies.push({
          name: indirectMatch[1],
          version: indirectMatch[2],
          type: 'development',
        });
      }
    }

    return dependencies;
  } catch {
    return [];
  }
}

/**
 * Parse Cargo.toml dependencies
 */
async function parseCargo(workspace: WorkspaceFS): Promise<Dependency[]> {
  try {
    const content = await workspace.readFile(CONFIG_FILES.cargoToml);
    const dependencies: Dependency[] = [];

    let inDependencies = false;
    let inDevDependencies = false;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      if (trimmed === '[dependencies]') {
        inDependencies = true;
        inDevDependencies = false;
        continue;
      }

      if (trimmed === '[dev-dependencies]') {
        inDependencies = false;
        inDevDependencies = true;
        continue;
      }

      if (trimmed.startsWith('[')) {
        inDependencies = false;
        inDevDependencies = false;
        continue;
      }

      if (inDependencies || inDevDependencies) {
        // Parse: package = "version" or package = { version = "..." }
        const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']([^"']+)["']/);
        if (simpleMatch) {
          dependencies.push({
            name: simpleMatch[1],
            version: simpleMatch[2],
            type: inDevDependencies ? 'development' : 'production',
          });
          continue;
        }

        // Complex version spec
        const complexMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*["']([^"']+)["']/);
        if (complexMatch) {
          dependencies.push({
            name: complexMatch[1],
            version: complexMatch[2],
            type: inDevDependencies ? 'development' : 'production',
          });
        }
      }
    }

    return dependencies;
  } catch {
    return [];
  }
}

/**
 * Extract version from version spec
 */
function extractVersionFromSpec(spec: string): string {
  const match = spec.match(/[\d.]+/);
  return match ? match[0] : spec;
}

/**
 * Get production dependencies only
 */
export async function getProductionDependencies(workspace: WorkspaceFS): Promise<Dependency[]> {
  const all = await detectDependencies(workspace);
  return all.filter(d => d.type === 'production');
}

/**
 * Get development dependencies only
 */
export async function getDevDependencies(workspace: WorkspaceFS): Promise<Dependency[]> {
  const all = await detectDependencies(workspace);
  return all.filter(d => d.type === 'development');
}

/**
 * Check if dependency exists
 */
export async function hasDependency(workspace: WorkspaceFS, name: string): Promise<boolean> {
  const deps = await detectDependencies(workspace);
  return deps.some(d => d.name === name);
}

/**
 * Get dependency version
 */
export async function getDependencyVersion(workspace: WorkspaceFS, name: string): Promise<string | null> {
  const deps = await detectDependencies(workspace);
  const dep = deps.find(d => d.name === name);
  return dep?.version || null;
}

/**
 * Clear dependency cache
 */
export function clearDependencyCache(): void {
  dependencyCache.clear();
}
