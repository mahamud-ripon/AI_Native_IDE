/**
 * Import Graph
 * 
 * Builds and manages import/dependency relationships between source files.
 * Supports TypeScript, JavaScript, Python, Go, and Rust.
 */

import * as path from 'path';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import {
  ImportGraph as ImportGraphType,
  SOURCE_EXTENSIONS,
  CONTEXT_DEFAULTS,
} from './context_types.js';

// Re-export the type
export type { ImportGraph } from './context_types.js';

// Import patterns by language
const IMPORT_PATTERNS = {
  typescript: [
    // import x from './file'
    /import\s+[\w*{}\s,]+\s+from\s+['"]([^'"]+)['"]/g,
    // import './file'
    /import\s+['"]([^'"]+)['"]/g,
    // export * from './file'
    /export\s+(?:\*|{[^}]*})\s+from\s+['"]([^'"]+)['"]/g,
    // export { x } from './file'
    /export\s+{[^}]*}\s+from\s+['"]([^'"]+)['"]/g,
    // dynamic import
    /import\(['"]([^'"]+)['"]\)/g,
  ],
  javascript: [
    // import x from './file'
    /import\s+[\w*{}\s,]+\s+from\s+['"]([^'"]+)['"]/g,
    // import './file'
    /import\s+['"]([^'"]+)['"]/g,
    // require('./file')
    /require\(['"]([^'"]+)['"]\)/g,
    // export * from './file'
    /export\s+(?:\*|{[^}]*})\s+from\s+['"]([^'"]+)['"]/g,
    // dynamic import
    /import\(['"]([^'"]+)['"]\)/g,
  ],
  python: [
    // from .module import x
    /from\s+([.\w]+)\s+import/g,
    // import module
    /import\s+([\w.]+)/g,
  ],
  go: [
    // import "package"
    /import\s+["']([^"']+)["']/g,
    // import alias "package"
    /import\s+\w+\s+["']([^"']+)["']/g,
    // multi-line import
    /import\s*\(([\s\S]*?)\)/g,
  ],
  rust: [
    // use crate::module
    /use\s+([:\w]+)/g,
    // mod module
    /mod\s+(\w+)/g,
  ],
} as const;

/**
 * Import Graph Implementation
 */
class ImportGraphImpl implements ImportGraphType {
  private imports: Map<string, Set<string>> = new Map();
  private dependents: Map<string, Set<string>> = new Map();
  private allFiles: Set<string> = new Set();

  /**
   * Add import relationship
   */
  addImport(fromFile: string, toFile: string): void {
    // Add to imports map
    if (!this.imports.has(fromFile)) {
      this.imports.set(fromFile, new Set());
    }
    this.imports.get(fromFile)!.add(toFile);

    // Add to dependents map
    if (!this.dependents.has(toFile)) {
      this.dependents.set(toFile, new Set());
    }
    this.dependents.get(toFile)!.add(fromFile);

    // Track all files
    this.allFiles.add(fromFile);
    this.allFiles.add(toFile);
  }

  /**
   * Get files that this file imports
   */
  getImports(file: string): string[] {
    const imports = this.imports.get(file);
    return imports ? Array.from(imports) : [];
  }

  /**
   * Get files that import this file
   */
  getDependents(file: string): string[] {
    const dependents = this.dependents.get(file);
    return dependents ? Array.from(dependents) : [];
  }

  /**
   * Get all imported files
   */
  getAllImported(): string[] {
    const imported = new Set<string>();
    for (const files of this.imports.values()) {
      for (const file of files) {
        imported.add(file);
      }
    }
    return Array.from(imported);
  }

  /**
   * Check if file has been analyzed
   */
  hasFile(file: string): boolean {
    return this.allFiles.has(file);
  }

  /**
   * Get total number of relationships
   */
  size(): number {
    let total = 0;
    for (const files of this.imports.values()) {
      total += files.size;
    }
    return total;
  }
}

/**
 * Build import graph from workspace
 */
export async function buildImportGraph(workspace: WorkspaceFS): Promise<ImportGraphType> {
  const graph = new ImportGraphImpl();
  const files = await workspace.listFiles();
  
  // Filter to source files only
  const sourceFiles = files.filter(f => 
    f.type === 'file' && SOURCE_EXTENSIONS.includes(path.extname(f.path) as typeof SOURCE_EXTENSIONS[number])
  );

  // Limit graph size for large repos
  const filesToProcess = sourceFiles.slice(0, CONTEXT_DEFAULTS.maxGraphFiles);

  // Parse imports from each file
  for (const file of filesToProcess) {
    try {
      const content = await workspace.readFile(file.path);
      const ext = path.extname(file.path).toLowerCase();
      const language = getLanguageFromExtension(ext);
      
      const imports = extractImports(content, language, file.path, workspace.getConfig().rootPath);
      
      for (const importedFile of imports) {
        graph.addImport(file.path, importedFile);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return graph;
}

/**
 * Get language from file extension
 */
function getLanguageFromExtension(ext: string): string {
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    default:
      return 'javascript';
  }
}

/**
 * Extract imports from file content
 */
function extractImports(
  content: string,
  language: string,
  filePath: string,
  rootPath: string
): string[] {
  const imports: string[] = [];
  const patterns = IMPORT_PATTERNS[language as keyof typeof IMPORT_PATTERNS] || IMPORT_PATTERNS.javascript;

  for (const pattern of patterns) {
    // Reset regex lastIndex
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const importPath = match[1];
      
      if (!importPath) continue;

      // Resolve relative imports to absolute paths
      if (importPath.startsWith('.') || importPath.startsWith('./') || importPath.startsWith('../')) {
        const resolved = resolveImportPath(filePath, importPath, rootPath);
        if (resolved) {
          imports.push(resolved);
        }
      } else if (language === 'python' && importPath.startsWith('.')) {
        // Python relative import
        const resolved = resolvePythonImport(filePath, importPath, rootPath);
        if (resolved) {
          imports.push(resolved);
        }
      } else if (language === 'rust' && importPath.startsWith('crate::')) {
        // Rust crate import
        const resolved = resolveRustImport(importPath, rootPath);
        if (resolved) {
          imports.push(resolved);
        }
      }
      // Skip external package imports (node_modules, stdlib, etc.)
    }
  }

  // Handle Go multi-line imports
  if (language === 'go') {
    const multiLinePattern = /import\s*\(([\s\S]*?)\)/g;
    let match;
    while ((match = multiLinePattern.exec(content)) !== null) {
      const block = match[1];
      const lines = block.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('//')) {
          const pathMatch = trimmed.match(/["']([^"']+)["']/);
          if (pathMatch && !pathMatch[1].includes('/')) {
            // Internal package
            const resolved = path.join(rootPath, pathMatch[1]);
            imports.push(resolved);
          }
        }
      }
    }
  }

  return imports;
}

/**
 * Resolve relative import path
 */
function resolveImportPath(
  fromFile: string,
  importPath: string,
  rootPath: string
): string | null {
  const dir = path.dirname(fromFile);
  let resolved = path.resolve(dir, importPath);

  // Try with extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (withExt.startsWith(rootPath)) {
      return path.relative(rootPath, withExt);
    }
  }

  // Try as directory with index
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  for (const index of indexFiles) {
    const indexPath = path.join(resolved, index);
    if (indexPath.startsWith(rootPath)) {
      return path.relative(rootPath, indexPath);
    }
  }

  // Return as-is if within root
  if (resolved.startsWith(rootPath)) {
    return path.relative(rootPath, resolved);
  }

  return null;
}

/**
 * Resolve Python relative import
 */
function resolvePythonImport(
  fromFile: string,
  importPath: string,
  rootPath: string
): string | null {
  const dir = path.dirname(fromFile);
  
  // Count leading dots
  let dotCount = 0;
  for (const char of importPath) {
    if (char === '.') {
      dotCount++;
    } else {
      break;
    }
  }

  // Go up directories based on dot count
  let targetDir = dir;
  for (let i = 1; i < dotCount; i++) {
    targetDir = path.dirname(targetDir);
  }

  // Get module name
  const moduleName = importPath.slice(dotCount);
  if (moduleName) {
    const modulePath = path.join(targetDir, moduleName.replace(/\./g, '/') + '.py');
    if (modulePath.startsWith(rootPath)) {
      return path.relative(rootPath, modulePath);
    }
  } else {
    // Import from package
    const initPath = path.join(targetDir, '__init__.py');
    if (initPath.startsWith(rootPath)) {
      return path.relative(rootPath, initPath);
    }
  }

  return null;
}

/**
 * Resolve Rust crate import
 */
function resolveRustImport(importPath: string, rootPath: string): string | null {
  // crate::module -> src/module.rs or src/module/mod.rs
  const modulePath = importPath.replace('crate::', '').replace(/::/g, '/');
  
  const directPath = path.join(rootPath, 'src', modulePath + '.rs');
  const modPath = path.join(rootPath, 'src', modulePath, 'mod.rs');

  return path.relative(rootPath, directPath) || path.relative(rootPath, modPath);
}

/**
 * Expand file list via import graph
 */
export function expandViaImports(
  files: string[],
  graph: ImportGraphType,
  depth: number = CONTEXT_DEFAULTS.graphExpansionDepth
): string[] {
  const expanded = new Set<string>(files);
  let currentLevel = [...files];

  for (let i = 0; i < depth; i++) {
    const nextLevel: string[] = [];

    for (const file of currentLevel) {
      // Add files that this file imports
      const imports = graph.getImports(file);
      for (const imp of imports) {
        if (!expanded.has(imp)) {
          expanded.add(imp);
          nextLevel.push(imp);
        }
      }

      // Add files that import this file
      const dependents = graph.getDependents(file);
      for (const dep of dependents) {
        if (!expanded.has(dep)) {
          expanded.add(dep);
          nextLevel.push(dep);
        }
      }
    }

    currentLevel = nextLevel;
    if (currentLevel.length === 0) break;
  }

  return Array.from(expanded);
}

/**
 * Get files related via imports
 */
export function getRelatedFiles(
  file: string,
  graph: ImportGraphType
): { imports: string[]; dependents: string[] } {
  return {
    imports: graph.getImports(file),
    dependents: graph.getDependents(file),
  };
}
