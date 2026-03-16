/**
 * Refactor Service
 * 
 * AI-powered code refactoring operations.
 */

import * as crypto from 'crypto';
import {
  RefactorRequest,
  RefactorResult,
  RefactorOperation,
  RefactorStatus,
  RefactorChange,
  RefactorPlan,
  RefactorStep,
  RefactorSummary,
  RefactorMetrics,
  RefactorConfig,
  RefactorTarget,
  SymbolReference,
  REFACTOR_DEFAULTS,
  REFACTOR_OPERATIONS,
} from './refactor_types.js';
import { WorkspaceFS } from '../../coding/workspace/workspace_fs.js';
import { LLMProvider, LLMMessage } from '../../coding/agent/agent_types.js';
import { getLLMProvider } from '../../coding/agent/plan_generator.js';
import { getCodeIndex } from '../../coding/retrieval/code_index.js';
import { getTracer } from '../../observability/agent_tracing.js';
import { recordTokenUsage } from '../../observability/token_usage.js';

/**
 * Refactor Service
 */
export class RefactorService {
  private config: Required<RefactorConfig>;
  private provider: LLMProvider | null = null;

  constructor(config?: Partial<RefactorConfig>) {
    this.config = { ...REFACTOR_DEFAULTS, ...config } as Required<RefactorConfig>;
    this.provider = getLLMProvider();
  }

  /**
   * Set LLM provider
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * Perform refactoring
   */
  async refactor(
    request: RefactorRequest,
    workspace?: WorkspaceFS
  ): Promise<RefactorResult> {
    const startTime = Date.now();
    const tracer = getTracer();

    const traceId = tracer.startAgentTrace({
      agentId: 'refactor-service',
      workspaceId: request.workspaceId,
      userId: request.userId,
      prompt: `Refactor: ${request.operation}`,
    });

    let analysisMs = 0;
    let executionMs = 0;
    let verificationMs = 0;
    let tokensUsed = 0;

    try {
      // Phase 1: Analysis
      const analysisStart = Date.now();
      const analysis = await this.analyzeRefactor(request, workspace);
      analysisMs = Date.now() - analysisStart;

      // Phase 2: Planning
      const plan = await this.planRefactor(request, analysis);

      // Phase 3: Execution
      const executionStart = Date.now();
      const changes = await this.executeRefactor(request, plan, workspace);
      executionMs = Date.now() - executionStart;

      // Phase 4: Verification (if enabled)
      if (this.config.enableAutoVerification && workspace) {
        const verificationStart = Date.now();
        await this.verifyRefactor(changes, workspace);
        verificationMs = Date.now() - verificationStart;
      }

      // Build summary
      const summary: RefactorSummary = {
        filesAffected: changes.length,
        symbolsRenamed: request.operation === 'rename' ? 1 : 0,
        functionsExtracted: request.operation.startsWith('extract') ? 1 : 0,
        referencesUpdated: analysis.references?.length ?? 0,
        linesChanged: changes.reduce((sum, c) => sum + c.linesAdded + c.linesRemoved, 0),
      };

      // Record token usage
      recordTokenUsage({
        workspaceId: request.workspaceId,
        userId: request.userId,
        provider: 'default',
        model: 'default',
        promptTokens: tokensUsed,
        completionTokens: 0,
      });

      tracer.endAgentTrace(traceId, true);

      const metrics: RefactorMetrics = {
        analysisMs,
        executionMs,
        verificationMs,
        totalMs: Date.now() - startTime,
        tokensUsed,
      };

      return {
        id: this.generateId(),
        requestId: request.id,
        success: true,
        status: 'completed',
        operation: request.operation,
        changes,
        summary,
        metrics,
      };
    } catch (error) {
      tracer.endAgentTrace(traceId, false, error instanceof Error ? error.message : 'Unknown error');

      return {
        id: this.generateId(),
        requestId: request.id,
        success: false,
        status: 'failed',
        operation: request.operation,
        changes: [],
        summary: {
          filesAffected: 0,
          symbolsRenamed: 0,
          functionsExtracted: 0,
          referencesUpdated: 0,
          linesChanged: 0,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          analysisMs,
          executionMs,
          verificationMs,
          totalMs: Date.now() - startTime,
          tokensUsed,
        },
      };
    }
  }

  /**
   * Analyze refactoring requirements
   */
  private async analyzeRefactor(
    request: RefactorRequest,
    workspace?: WorkspaceFS
  ): Promise<{
    references?: SymbolReference[];
    affectedFiles?: string[];
  }> {
    const operation = REFACTOR_OPERATIONS[request.operation];

    // For project-wide operations, find all references
    if (operation.scope === 'project_wide' && request.target.symbolName && workspace) {
      const references = await this.findSymbolReferences(
        request.target.symbolName,
        workspace
      );

      return { references, affectedFiles: [...new Set(references.map(r => r.path))] };
    }

    // For single-file operations
    if (request.target.selection) {
      return { affectedFiles: [request.target.selection.path] };
    }

    if (request.target.filePath) {
      return { affectedFiles: [request.target.filePath] };
    }

    return {};
  }

  /**
   * Find symbol references across project
   */
  private async findSymbolReferences(
    symbolName: string,
    workspace: WorkspaceFS
  ): Promise<SymbolReference[]> {
    const references: SymbolReference[] = [];

    try {
      const codeIndex = getCodeIndex();
      const results = await codeIndex.search(symbolName, {
        mode: 'keyword',
        maxResults: 100,
      });

      for (const result of results) {
        // Check if symbol is actually referenced
        const content = result.chunk.content;
        if (content.includes(symbolName)) {
          references.push({
            path: result.chunk.path,
            line: result.chunk.startLine,
            column: content.indexOf(symbolName),
            context: content,
          });
        }
      }
    } catch {
      // Search failed, return empty
    }

    return references;
  }

  /**
   * Plan refactoring steps
   */
  private async planRefactor(
    request: RefactorRequest,
    analysis: { references?: SymbolReference[]; affectedFiles?: string[] }
  ): Promise<RefactorPlan> {
    const operation = REFACTOR_OPERATIONS[request.operation];

    const steps: RefactorStep[] = [];
    const affectedFiles = analysis.affectedFiles ?? [];

    // Build steps based on operation type
    switch (request.operation) {
      case 'rename':
        steps.push({
          step: 1,
          action: 'rename_symbol',
          description: `Rename ${request.target.symbolName} to ${request.target.newName}`,
        });
        for (let i = 0; i < (analysis.references?.length ?? 0); i++) {
          steps.push({
            step: i + 2,
            action: 'update_reference',
            file: analysis.references![i].path,
            description: `Update reference in ${analysis.references![i].path}`,
            dependencies: [1],
          });
        }
        break;

      case 'extract_function':
        steps.push({
          step: 1,
          action: 'create_function',
          description: 'Create new function from selection',
        });
        steps.push({
          step: 2,
          action: 'replace_selection',
          description: 'Replace selection with function call',
          dependencies: [1],
        });
        break;

      default:
        steps.push({
          step: 1,
          action: 'refactor',
          description: `Perform ${request.operation}`,
        });
    }

    return {
      id: this.generateId(),
      operation: request.operation,
      steps,
      affectedFiles,
      estimatedComplexity: affectedFiles.length > 10 ? 'high' : affectedFiles.length > 3 ? 'medium' : 'low',
      requiresVerification: operation.scope !== 'single_file',
      canRollback: this.config.backupEnabled,
    };
  }

  /**
   * Execute refactoring
   */
  private async executeRefactor(
    request: RefactorRequest,
    plan: RefactorPlan,
    workspace?: WorkspaceFS
  ): Promise<RefactorChange[]> {
    const changes: RefactorChange[] = [];

    if (!workspace) {
      return changes;
    }

    // Execute based on operation type
    switch (request.operation) {
      case 'rename':
        return this.executeRename(request, plan, workspace);

      case 'extract_function':
        return this.executeExtractFunction(request, workspace);

      case 'organize_imports':
        return this.executeOrganizeImports(request, workspace);

      default:
        return this.executeGenericRefactor(request, workspace);
    }
  }

  /**
   * Execute rename operation
   */
  private async executeRename(
    request: RefactorRequest,
    plan: RefactorPlan,
    workspace: WorkspaceFS
  ): Promise<RefactorChange[]> {
    const changes: RefactorChange[] = [];
    const symbolName = request.target.symbolName!;
    const newName = request.target.newName!;

    for (const file of plan.affectedFiles) {
      try {
        const content = await workspace.readFile(file);
        const newContent = this.renameSymbol(content, symbolName, newName);

        if (content !== newContent) {
          changes.push({
            id: this.generateId(),
            path: file,
            operation: 'modify',
            originalContent: content,
            newContent,
            linesAdded: 0,
            linesRemoved: 0,
          });

          if (!request.options?.dryRun) {
            await workspace.writeFile(file, newContent);
          }
        }
      } catch {
        // File not accessible
      }
    }

    return changes;
  }

  /**
   * Rename symbol in content
   */
  private renameSymbol(content: string, oldName: string, newName: string): string {
    // Simple string replace - production would use AST
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${oldName}\\b`, 'g');
    return content.replace(regex, newName);
  }

  /**
   * Execute extract function
   */
  private async executeExtractFunction(
    request: RefactorRequest,
    workspace: WorkspaceFS
  ): Promise<RefactorChange[]> {
    const changes: RefactorChange[] = [];
    const selection = request.target.selection!;

    if (!this.provider) {
      throw new Error('LLM provider not configured');
    }

    // Generate function using LLM
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'You are a code refactoring assistant. Extract the selected code into a new function.',
      },
      {
        role: 'user',
        content: `Extract this code into a function:

\`\`\`${selection.language}
${selection.content}
\`\`\`

Generate:
1. The new function definition
2. The function call to replace the selection`,
      },
    ];

    const response = await this.provider.complete(messages, {
      temperature: 0.2,
      maxTokens: 1000,
    });

    // Parse response for function and call
    const codeMatch = response.content.match(/```(?:\w+)?\n([\s\S]*?)```/g);
    if (codeMatch && codeMatch.length >= 2) {
      const functionCode = codeMatch[0].replace(/```\w*\n?/g, '').trim();
      const callCode = codeMatch[1].replace(/```\w*\n?/g, '').trim();

      // Read file and make changes
      const content = await workspace.readFile(selection.path);
      const lines = content.split('\n');

      // Replace selection with call
      lines.splice(
        selection.startLine - 1,
        selection.endLine - selection.startLine + 1,
        callCode
      );

      // Add function at end of file (simplified)
      lines.push('', functionCode);

      const newContent = lines.join('\n');

      changes.push({
        id: this.generateId(),
        path: selection.path,
        operation: 'modify',
        originalContent: content,
        newContent,
        linesAdded: functionCode.split('\n').length,
        linesRemoved: selection.content.split('\n').length,
      });

      if (!request.options?.dryRun) {
        await workspace.writeFile(selection.path, newContent);
      }
    }

    return changes;
  }

  /**
   * Execute organize imports
   */
  private async executeOrganizeImports(
    request: RefactorRequest,
    workspace: WorkspaceFS
  ): Promise<RefactorChange[]> {
    const changes: RefactorChange[] = [];
    const filePath = request.target.filePath ?? request.target.selection?.path;

    if (!filePath) return changes;

    try {
      const content = await workspace.readFile(filePath);
      const organized = this.organizeImports(content);

      if (content !== organized) {
        changes.push({
          id: this.generateId(),
          path: filePath,
          operation: 'modify',
          originalContent: content,
          newContent: organized,
          linesAdded: 0,
          linesRemoved: 0,
        });

        if (!request.options?.dryRun) {
          await workspace.writeFile(filePath, organized);
        }
      }
    } catch {
      // File not accessible
    }

    return changes;
  }

  /**
   * Organize imports in code
   */
  private organizeImports(content: string): string {
    const lines = content.split('\n');
    const imports: string[] = [];
    const other: string[] = [];
    let inImports = true;

    for (const line of lines) {
      if (inImports && (line.startsWith('import ') || line.startsWith('import{'))) {
        imports.push(line);
      } else {
        if (inImports && line.trim() !== '') {
          inImports = false;
        }
        other.push(line);
      }
    }

    // Sort imports
    imports.sort();

    return [...imports, ...other].join('\n');
  }

  /**
   * Execute generic refactor using LLM
   */
  private async executeGenericRefactor(
    request: RefactorRequest,
    workspace: WorkspaceFS
  ): Promise<RefactorChange[]> {
    const changes: RefactorChange[] = [];
    const selection = request.target.selection;

    if (!selection || !this.provider) {
      return changes;
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a code refactoring assistant. Perform the requested refactoring: ${request.operation}`,
      },
      {
        role: 'user',
        content: `Refactor this code (${request.operation}):

\`\`\`${selection.language}
${selection.content}
\`\`\``,
      },
    ];

    const response = await this.provider.complete(messages, {
      temperature: 0.2,
      maxTokens: 2000,
    });

    const codeMatch = response.content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeMatch) {
      const newCode = codeMatch[1].trim();

      const content = await workspace.readFile(selection.path);
      const lines = content.split('\n');

      lines.splice(
        selection.startLine - 1,
        selection.endLine - selection.startLine + 1,
        ...newCode.split('\n')
      );

      const newContent = lines.join('\n');

      changes.push({
        id: this.generateId(),
        path: selection.path,
        operation: 'modify',
        originalContent: content,
        newContent,
        linesAdded: newCode.split('\n').length,
        linesRemoved: selection.content.split('\n').length,
      });

      if (!request.options?.dryRun) {
        await workspace.writeFile(selection.path, newContent);
      }
    }

    return changes;
  }

  /**
   * Verify refactoring
   */
  private async verifyRefactor(
    changes: RefactorChange[],
    workspace: WorkspaceFS
  ): Promise<void> {
    // Basic verification: check syntax
    for (const change of changes) {
      if (change.newContent) {
        // Simple brace matching for JS/TS
        const openBraces = (change.newContent.match(/{/g) || []).length;
        const closeBraces = (change.newContent.match(/}/g) || []).length;

        if (openBraces !== closeBraces) {
          console.warn(`Unbalanced braces in ${change.path}`);
        }
      }
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`refactor-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultService: RefactorService | null = null;

/**
 * Get default refactor service
 */
export function getRefactorService(): RefactorService {
  if (!defaultService) {
    defaultService = new RefactorService();
  }
  return defaultService;
}

/**
 * Create refactor service
 */
export function createRefactorService(config?: Partial<RefactorConfig>): RefactorService {
  return new RefactorService(config);
}

/**
 * Perform refactor helper
 */
export async function performRefactor(
  request: RefactorRequest,
  workspace?: WorkspaceFS
): Promise<RefactorResult> {
  return getRefactorService().refactor(request, workspace);
}
