/**
 * Project Context Builder
 * 
 * Main orchestrator for building AI context from workspace.
 * Coordinates framework detection, dependency parsing, import graph,
 * relevance scoring, and content preprocessing.
 */

import * as path from 'path';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import {
  ContextRequest,
  ProjectContext,
  RelevantFile,
  FileTreeNode,
  RelevanceReason,
  ContextBuildResult,
  CONTEXT_DEFAULTS,
  FILE_TREE_LIMITS,
  RELEVANCE_SCORES,
  ENTRYPOINT_PATTERNS,
} from './context_types.js';
import {
  detectFramework,
  detectProjectType,
  detectLanguage,
  detectMonorepo,
  clearFrameworkCache,
} from './framework_detector.js';
import {
  detectDependencies,
  clearDependencyCache,
} from './dependency_detector.js';
import {
  buildImportGraph,
  expandViaImports,
  ImportGraph,
} from './import_graph.js';
import {
  preprocessContent,
  estimateTokens,
  truncateToTokenLimit,
} from './content_preprocessor.js';

/**
 * Project Context Builder
 */
export class ProjectContextBuilder {
  private importGraphCache: Map<string, ImportGraph> = new Map();

  /**
   * Build context from workspace
   */
  async buildContext(
    workspace: WorkspaceFS,
    request: ContextRequest
  ): Promise<ContextBuildResult> {
    const startTime = Date.now();

    try {
      // Get configuration
      const maxTokens = request.maxTokens ?? CONTEXT_DEFAULTS.maxTokens;
      const maxFiles = request.maxFiles ?? CONTEXT_DEFAULTS.maxFiles;

      // Step 1: Detect project metadata
      const [projectType, framework, language, monorepo, dependencies] = await Promise.all([
        detectProjectType(workspace),
        detectFramework(workspace),
        detectLanguage(workspace),
        detectMonorepo(workspace),
        detectDependencies(workspace),
      ]);

      // Step 2: Build file tree
      const fileTree = await this.buildFileTree(workspace, monorepo);

      // Step 3: Build import graph
      const importGraph = await this.getOrBuildImportGraph(workspace);

      // Step 4: Score files by relevance
      const scoredFiles = await this.scoreFiles(
        workspace,
        request,
        projectType,
        importGraph
      );

      // Step 5: Expand via import graph
      const expandedFiles = expandViaImports(
        scoredFiles.map(f => f.path),
        importGraph,
        CONTEXT_DEFAULTS.graphExpansionDepth
      );

      // Update scores for expanded files
      const allScoredFiles = this.mergeScores(scoredFiles, expandedFiles, importGraph);

      // Step 6: Sort by relevance (DESC) and size (ASC)
      const sortedFiles = await this.sortByRelevanceAndSize(allScoredFiles, workspace);

      // Step 7: Load and preprocess content
      const relevantFiles = await this.loadAndPreprocess(
        sortedFiles.slice(0, maxFiles * 2), // Load extra for budget fitting
        workspace,
        maxTokens
      );

      // Step 8: Fit to token budget
      const finalFiles = this.fitTokenBudget(relevantFiles, maxTokens, maxFiles);

      // Step 9: Generate summary
      const summary = this.generateSummary({
        projectType,
        framework: framework !== null ? framework : undefined,
        language,
        dependencies,
        fileTree,
      });

      const buildTimeMs = Date.now() - startTime;

      return {
        success: true,
        context: {
          projectType,
          framework: framework || undefined,
          language,
          dependencies,
          fileTree,
          relevantFiles: finalFiles,
          monorepo: monorepo.isMonorepo ? monorepo : undefined,
          summary,
          tokenCount: finalFiles.reduce((sum, f) => sum + estimateTokens(f.content), 0),
          buildTimeMs,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          type: 'parse_error',
          message,
        },
      };
    }
  }

  /**
   * Build file tree with limits
   */
  private async buildFileTree(
    workspace: WorkspaceFS,
    monorepo: { isMonorepo: boolean; currentPackage?: string }
  ): Promise<FileTreeNode[]> {
    const files = await workspace.listFiles();
    
    // Restrict to current package if monorepo
    const relevantFiles = monorepo.isMonorepo && monorepo.currentPackage
      ? files.filter(f => f.path.startsWith(monorepo.currentPackage!))
      : files;

    // Build tree structure
    const root: FileTreeNode[] = [];
    const nodeMap = new Map<string, FileTreeNode>();

    // Sort by path for consistent ordering
    const sorted = [...relevantFiles].sort((a, b) => a.path.localeCompare(b.path));

    // Limit files
    const limited = sorted.slice(0, FILE_TREE_LIMITS.maxFiles);

    for (const file of limited) {
      const parts = file.path.split(/[/\\]/);
      let currentPath = '';
      let currentLevel = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isFile = i === parts.length - 1 && file.type === 'file';

        // Check depth limit
        if (i >= FILE_TREE_LIMITS.maxDepth) {
          break;
        }

        let node = nodeMap.get(currentPath);

        if (!node) {
          node = {
            name: part,
            path: currentPath,
            type: isFile ? 'file' : 'directory',
            children: isFile ? undefined : [],
          };
          nodeMap.set(currentPath, node);
          currentLevel.push(node);
        }

        if (!isFile && node.children) {
          currentLevel = node.children;
        }
      }
    }

    return root;
  }

  /**
   * Get or build import graph
   */
  private async getOrBuildImportGraph(workspace: WorkspaceFS): Promise<ImportGraph> {
    const cacheKey = workspace.getConfig().rootPath;
    
    if (this.importGraphCache.has(cacheKey)) {
      return this.importGraphCache.get(cacheKey)!;
    }

    const graph = await buildImportGraph(workspace);
    this.importGraphCache.set(cacheKey, graph);
    return graph;
  }

  /**
   * Score files by relevance
   */
  private async scoreFiles(
    workspace: WorkspaceFS,
    request: ContextRequest,
    projectType: string,
    importGraph: ImportGraph
  ): Promise<Array<{ path: string; score: number; reason: RelevanceReason }>> {
    const scores = new Map<string, { score: number; reason: RelevanceReason }>();

    // 1. Open files (1.0)
    for (const file of request.openFiles || []) {
      scores.set(file, { score: RELEVANCE_SCORES.open, reason: 'open' });
    }

    // 2. Changed files (0.9)
    for (const file of request.changedFiles || []) {
      if (!scores.has(file)) {
        scores.set(file, { score: RELEVANCE_SCORES.changed, reason: 'changed' });
      }
    }

    // 3. Files imported by open/changed files (0.7)
    for (const file of [...(request.openFiles || []), ...(request.changedFiles || [])]) {
      const imports = importGraph.getImports(file);
      for (const imp of imports) {
        if (!scores.has(imp)) {
          scores.set(imp, { score: RELEVANCE_SCORES['import-by'], reason: 'import-by' });
        }
      }
    }

    // 4. Files that import open/changed files (0.7)
    for (const file of [...(request.openFiles || []), ...(request.changedFiles || [])]) {
      const dependents = importGraph.getDependents(file);
      for (const dep of dependents) {
        if (!scores.has(dep)) {
          scores.set(dep, { score: RELEVANCE_SCORES['import-of'], reason: 'import-of' });
        }
      }
    }

    // 5. Keyword matches (0.6)
    const keywords = this.extractKeywords(request.userPrompt);
    const keywordMatches = await this.findKeywordMatches(workspace, keywords);
    for (const file of keywordMatches) {
      if (!scores.has(file)) {
        scores.set(file, { score: RELEVANCE_SCORES.keyword, reason: 'keyword' });
      }
    }

    // 6. Entrypoints (0.5)
    const entrypoints = ENTRYPOINT_PATTERNS[projectType] || [];
    for (const entry of entrypoints) {
      if (await workspace.exists(entry) && !scores.has(entry)) {
        scores.set(entry, { score: RELEVANCE_SCORES.entrypoint, reason: 'entrypoint' });
      }
    }

    return Array.from(scores.entries()).map(([path, { score, reason }]) => ({
      path,
      score,
      reason,
    }));
  }

  /**
   * Extract keywords from prompt
   */
  private extractKeywords(prompt: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'under', 'again',
      'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
      'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this',
      'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'this',
      'add', 'create', 'make', 'write', 'build', 'implement', 'fix', 'update',
      'change', 'modify', 'remove', 'delete', 'refactor', 'improve',
    ]);

    return prompt
      .toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 10);
  }

  /**
   * Find files matching keywords
   */
  private async findKeywordMatches(
    workspace: WorkspaceFS,
    keywords: string[]
  ): Promise<string[]> {
    const matches: string[] = [];
    const files = await workspace.listFiles();

    for (const file of files) {
      if (file.type !== 'file') continue;

      const fileName = path.basename(file.path).toLowerCase();
      const dirName = path.dirname(file.path).toLowerCase();

      // Check filename and path
      for (const keyword of keywords) {
        if (fileName.includes(keyword) || dirName.includes(keyword)) {
          matches.push(file.path);
          break;
        }
      }
    }

    return matches;
  }

  /**
   * Merge scores with expanded files
   */
  private mergeScores(
    scoredFiles: Array<{ path: string; score: number; reason: RelevanceReason }>,
    expandedPaths: string[],
    importGraph: ImportGraph
  ): Array<{ path: string; score: number; reason: RelevanceReason }> {
    const scoreMap = new Map(scoredFiles.map(f => [f.path, f]));

    for (const path of expandedPaths) {
      if (!scoreMap.has(path)) {
        // Assign score based on relationship
        const imports = importGraph.getImports(path);
        const dependents = importGraph.getDependents(path);

        let score = 0.3; // Default for expanded files
        let reason: RelevanceReason = 'keyword';

        // Check if it's related to high-score files
        for (const imp of imports) {
          const impScore = scoreMap.get(imp);
          if (impScore && impScore.score >= 0.7) {
            score = 0.5;
            reason = 'import-of';
            break;
          }
        }

        for (const dep of dependents) {
          const depScore = scoreMap.get(dep);
          if (depScore && depScore.score >= 0.7) {
            score = Math.max(score, 0.5);
            reason = 'import-by';
            break;
          }
        }

        scoreMap.set(path, { path, score, reason });
      }
    }

    return Array.from(scoreMap.entries()).map(([path, { score, reason }]) => ({
      path,
      score,
      reason,
    }));
  }

  /**
   * Sort files by relevance (DESC) and size (ASC)
   */
  private async sortByRelevanceAndSize(
    files: Array<{ path: string; score: number; reason: RelevanceReason }>,
    workspace: WorkspaceFS
  ): Promise<Array<{ path: string; score: number; reason: RelevanceReason; size: number }>> {
    const withSize = await Promise.all(
      files.map(async f => {
        try {
          const content = await workspace.readFile(f.path);
          return {
            ...f,
            size: content.length,
          };
        } catch {
          return {
            ...f,
            size: Infinity,
          };
        }
      })
    );

    // Sort: relevance DESC, size ASC
    return withSize.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.size - b.size;
    });
  }

  /**
   * Load and preprocess file contents
   */
  private async loadAndPreprocess(
    files: Array<{ path: string; score: number; reason: RelevanceReason; size: number }>,
    workspace: WorkspaceFS,
    maxTokens: number
  ): Promise<RelevantFile[]> {
    const results: RelevantFile[] = [];

    for (const file of files) {
      try {
        const content = await workspace.readFile(file.path);
        const processed = preprocessContent(content);

        results.push({
          path: file.path,
          content: processed.content,
          originalSize: content.length,
          processedSize: processed.content.length,
          relevance: file.score,
          reason: file.reason,
        });
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Fit files to token budget
   */
  private fitTokenBudget(
    files: RelevantFile[],
    maxTokens: number,
    maxFiles: number
  ): RelevantFile[] {
    const result: RelevantFile[] = [];
    let totalTokens = 0;

    for (const file of files) {
      if (result.length >= maxFiles) break;

      const fileTokens = estimateTokens(file.content);

      if (totalTokens + fileTokens <= maxTokens) {
        result.push(file);
        totalTokens += fileTokens;
      } else if (totalTokens < maxTokens * 0.8) {
        // Partial include - truncate content
        const remaining = maxTokens - totalTokens;
        const truncated = truncateToTokenLimit(file.content, remaining);
        result.push({
          ...file,
          content: truncated,
          processedSize: truncated.length,
        });
        break;
      }
    }

    return result;
  }

  /**
   * Generate deterministic summary
   */
  private generateSummary(context: {
    projectType: string;
    framework?: { name: string };
    language: string;
    dependencies: Array<{ name: string; type: string }>;
    fileTree: FileTreeNode[];
  }): string {
    const parts: string[] = [];

    // Project type + framework
    const typeDisplay = context.projectType.replace(/-/g, ' ');
    parts.push(`${context.language} ${context.framework?.name || ''} ${typeDisplay}`.trim());

    // Top dependencies
    const topDeps = context.dependencies
      .filter(d => d.type === 'production')
      .slice(0, 5)
      .map(d => d.name);
    if (topDeps.length > 0) {
      parts.push(`Dependencies: ${topDeps.join(', ')}`);
    }

    // Structure
    const dirs = context.fileTree
      .filter(n => n.type === 'directory')
      .slice(0, 5)
      .map(n => n.name);
    if (dirs.length > 0) {
      parts.push(`Structure: ${dirs.join('/')}`);
    }

    return parts.join('\n');
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.importGraphCache.clear();
    clearFrameworkCache();
    clearDependencyCache();
  }
}

// Singleton instance
let defaultBuilder: ProjectContextBuilder | null = null;

/**
 * Get default context builder
 */
export function getContextBuilder(): ProjectContextBuilder {
  if (!defaultBuilder) {
    defaultBuilder = new ProjectContextBuilder();
  }
  return defaultBuilder;
}

/**
 * Create context builder
 */
export function createContextBuilder(): ProjectContextBuilder {
  return new ProjectContextBuilder();
}
