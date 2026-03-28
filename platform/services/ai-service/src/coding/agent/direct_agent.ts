/**
 * Direct Agent (Mode 1)
 *
 * Simple tool-calling loop — 1 LLM call per turn, max 10 turns.
 * Handles 80% of requests: create/edit/delete files, explain code, search.
 *
 * Architecture: Claude Code-style agentic loop.
 * The LLM receives tools directly and decides when to call them.
 * No pipeline, no planning, no verification — just a conversation with tools.
 */

import {
  AgentResult,
  AgentMetrics,
  LLMMessage,
  LLMResponse,
  LLMToolCall,
  AgentProgressEvent,
  ToolCall,
  ToolResult,
} from './agent_types.js';
import { GatewayLLMProvider } from './llm_adapter.js';
import { ToolRouter, getToolRouter } from './tool_router.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';

const SYSTEM_PROMPT_TEMPLATE = `You are a coding assistant integrated into an IDE. You can read, create, modify, and delete files using the provided tools.

### **STRATEGY: BE DIRECT & FAST**
- **Action over Discovery**: For simple tasks like creating or updating a single file, issue the tool call in your FIRST response.
- **Trust the File Tree**: The "Available files" section below is 100% accurate. Do not use 'list_files' or 'search_code' to verify it — trust what you see.
- **Immediate Execution**: If the user says "create X", do not ask or confirm. Just use 'write_file' immediately.
- **Scaffolding**: If the user asks for a project structure or starter, create every required file in the same turn when possible. Do not stop after the first file.

### **Rules**:
- **Safety First**: ALWAYS read a file before modifying or deleting it (ensure you have full context).
- **Paths**: Use the exact file paths from the project structure below.
- **Complexity**: If the task requires changing 5+ files or complex architectural changes, tell the user to switch to "Agent" mode.
- **Paths**: Never use placeholder paths like "path/to/file".
- **Completion**: After executing final tools, provide a one-sentence summary and STOP.

Available files in the project:
`;

export interface DirectAgentConfig {
  workspace: WorkspaceFS;
  onProgress?: (event: AgentProgressEvent) => void;
  maxTurns?: number;
  abortSignal?: AbortSignal;
  workspaceContext?: {
    fileTree?: string[];
    activeFile?: string | null;
    activeFileContent?: string | null;
    openTabs?: string[];
  };
}

export class DirectAgent {
  private workspace: WorkspaceFS;
  private toolRouter: ToolRouter;
  private llmProvider: GatewayLLMProvider;
  private maxTurns: number;
  private onProgress?: (event: AgentProgressEvent) => void;
  private abortSignal?: AbortSignal;
  private workspaceContext?: DirectAgentConfig['workspaceContext'];

  constructor(config: DirectAgentConfig) {
    this.workspace = config.workspace;
    this.maxTurns = config.maxTurns ?? 10;
    this.onProgress = config.onProgress;
    this.abortSignal = config.abortSignal;
    this.workspaceContext = config.workspaceContext;
    this.toolRouter = getToolRouter();
    this.toolRouter.setWorkspace(config.workspace);
    this.llmProvider = new GatewayLLMProvider();
  }

  /**
   * Run the direct agent with a prompt.
   */
  async run(
    prompt: string,
    modelConfig: { provider: string; model: string }
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const filesChanged: string[] = [];
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const scaffoldingRequest = this.isScaffoldingRequest(prompt);
    const maxTurns = scaffoldingRequest ? Math.min(this.maxTurns, 6) : this.maxTurns;

    try {
      this.throwIfAborted();
      this.emitProgress('initializing', 0.05, 'Starting direct chat...');

      // Get file list for system prompt
      // Priority 1: Use workspaceContext from frontend (if available and fresh)
      // Priority 2: List files from workspace FS (source of truth but might have database lag)
      let fileList: Array<{ path: string; isDirectory?: boolean }> = [];
      if (this.workspaceContext?.fileTree && this.workspaceContext.fileTree.length > 0) {
        fileList = this.workspaceContext.fileTree.map(path => ({ path }));
      } else {
        fileList = await this.workspace.listFiles();
      }
      this.throwIfAborted();

      const filePaths = fileList.map(f => (f as any).path || f).join('\n');

      // Build system prompt with file context
      const systemPrompt = SYSTEM_PROMPT_TEMPLATE + filePaths;

      // Initial messages
      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ];

      // Get tool definitions
      const tools = this.selectToolDefinitions(scaffoldingRequest);

      this.emitProgress('planning', 0.1, 'Thinking...');

      // Detect if user prompt is a delete request
      const isDeleteRequest = /delete|remove/i.test(prompt);

      // Track deleted files to prevent double-delete
      const deletedFiles: Set<string> = new Set();
      const executedTools = new Map<string, ToolResult>();
      const executedMutations = new Set<string>();
      let informationalTurns = 0;

      // Tool-calling loop
      for (let turn = 0; turn < maxTurns; turn++) {
        this.throwIfAborted();

        const progress = 0.1 + (turn / maxTurns) * 0.8;
        this.emitProgress('editing', progress, `Turn ${turn + 1}/${maxTurns}...`);

        // Single LLM call with tools
        const response: LLMResponse = await this.llmProvider.complete(messages, {
          tools,
          temperature: 0.1,
          maxTokens: 4096,
          model: modelConfig.model,
        });
        this.throwIfAborted();

        totalTokensIn += response.usage.promptTokens;
        totalTokensOut += response.usage.completionTokens;

        console.log(`[DirectAgent] Turn ${turn + 1}: toolCalls=${response.toolCalls?.length ?? 0} content="${response.content?.slice(0, 100)}"`);

        if (response.toolCalls && response.toolCalls.length > 0) {
          // LLM wants to use tools — add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
          });

          let duplicateMutationsThisTurn = 0;
          let mutatingToolExecutedThisTurn = false;
          const readOnlyToolCallsThisTurn = response.toolCalls.every(call => !this.isMutatingTool(call.name));

          // Execute each tool call
          for (const call of response.toolCalls) {
            this.throwIfAborted();
            const filePath = call.arguments.path as string;
            const isMutatingTool = this.isMutatingTool(call.name);
            const fingerprint = this.createToolFingerprint(call);

            if (!isMutatingTool && executedTools.has(fingerprint)) {
              console.log(`[DirectAgent] Reusing cached tool result: ${call.name} ${filePath ?? ''}`);
              messages.push({
                role: 'tool',
                content: JSON.stringify(executedTools.get(fingerprint)).slice(0, 8000),
                toolCallId: call.id,
                name: call.id,
              });
              continue;
            }

            // Skip delete if file was already deleted
            if (call.name === 'delete_file' && filePath && deletedFiles.has(filePath)) {
              console.log(`[DirectAgent] Skipping already-deleted file: ${filePath}`);
              messages.push({
                role: 'tool',
                content: JSON.stringify({ success: true, message: `File ${filePath} was already deleted` }).slice(0, 8000),
                toolCallId: call.id,
                name: call.id,
              });
              continue;
            }

            if (isMutatingTool && executedMutations.has(fingerprint)) {
              duplicateMutationsThisTurn++;
              console.log(`[DirectAgent] Skipping duplicate mutating tool call: ${call.name} ${filePath ?? ''}`);
              messages.push({
                role: 'tool',
                content: JSON.stringify({
                  success: true,
                  skipped: true,
                  message: 'This tool call was already executed in an earlier turn.',
                }).slice(0, 8000),
                toolCallId: call.id,
                name: call.id,
              });
              continue;
            }

            console.log(`[DirectAgent] Executing tool: ${call.name} args=${JSON.stringify(call.arguments)}`);
            const toolResult = await this.executeToolCall(call);
            this.throwIfAborted();

            // Track file changes
            if (call.name === 'delete_file' && toolResult.success) {
              if (filePath) {
                filesChanged.push(filePath);
                deletedFiles.add(filePath);
              }
            } else if (call.name === 'write_file' && toolResult.success) {
              if (filePath) filesChanged.push(filePath);
            } else if (call.name === 'edit_file' && toolResult.success) {
              if (filePath) filesChanged.push(filePath);
            }

            if (isMutatingTool && toolResult.success) {
              executedMutations.add(fingerprint);
              mutatingToolExecutedThisTurn = true;
            }

            if (toolResult.success) {
              executedTools.set(fingerprint, toolResult);
            }

            // Add tool result to messages
            messages.push({
              role: 'tool',
              content: JSON.stringify(toolResult).slice(0, 8000),
              toolCallId: call.id,
              name: call.id,
            });
          }

          if (scaffoldingRequest && readOnlyToolCallsThisTurn && filesChanged.length >= 4) {
            console.log('[DirectAgent] Scaffold request already changed files; stopping after read-only follow-up turn');
            this.emitProgress('completed', 1.0, 'Task completed');
            return {
              success: true,
              plan: null as any,
              patches: [],
              filesChanged: [...new Set(filesChanged)],
              summary: `Completed ${[...new Set(filesChanged)].join(', ')}`,
              metrics: this.buildMetrics(turn + 1, totalTokensIn, totalTokensOut, filesChanged, startTime),
            };
          }

          if (duplicateMutationsThisTurn === response.toolCalls.length && filesChanged.length > 0) {
            console.log('[DirectAgent] All tool calls in this turn were duplicate mutations; stopping loop');
            this.emitProgress('completed', 1.0, 'Task completed');
            return {
              success: true,
              plan: null as any,
              patches: [],
              filesChanged: [...new Set(filesChanged)],
              summary: `Completed ${[...new Set(filesChanged)].join(', ')}`,
              metrics: this.buildMetrics(turn + 1, totalTokensIn, totalTokensOut, filesChanged, startTime),
            };
          }

          if (scaffoldingRequest && !mutatingToolExecutedThisTurn) {
            informationalTurns++;

            if (informationalTurns >= 2) {
              messages.push({
                role: 'user',
                content: 'You already have enough project context. Stop exploring and now create or update the concrete files needed for the requested scaffold using write_file or edit_file. Do not call list_files again.',
              });
            }
          } else if (mutatingToolExecutedThisTurn) {
            informationalTurns = 0;
          }

          continue;
        } else {
          // No tool calls — LLM returned text only
          const content = response.content?.toLowerCase() || '';

          // Check if LLM's text response mentions deleting a file — try to auto-execute
          if (turn <= 2 && (content.includes('delete') || content.includes('remove')) && isDeleteRequest) {
            const detectedPath = this.detectFileToDelete(prompt, content, fileList);
            if (detectedPath && !deletedFiles.has(detectedPath)) {
              console.log(`[DirectAgent] Auto-detected delete intent for: ${detectedPath}`);
              const deleteResult = await this.executeToolCall({
                id: `auto-delete-${turn}`,
                name: 'delete_file',
                arguments: { path: detectedPath },
              });
              if (deleteResult.success) {
                filesChanged.push(detectedPath);
                deletedFiles.add(detectedPath);
                // Return immediately — delete succeeded
                this.emitProgress('completed', 1.0, 'File deleted');
                return {
                  success: true,
                  plan: null as any,
                  patches: [],
                  filesChanged: [...new Set(filesChanged)],
                  summary: `Deleted ${detectedPath}`,
                  metrics: this.buildMetrics(turn + 1, totalTokensIn, totalTokensOut, filesChanged, startTime),
                };
              }
              // Delete failed — feed error to LLM and continue
              messages.push({
                role: 'assistant',
                content: `I'll delete ${detectedPath}.`,
              });
              messages.push({
                role: 'tool',
                content: JSON.stringify(deleteResult).slice(0, 8000),
                toolCallId: `auto-delete-${turn}`,
                name: `auto-delete-${turn}`,
              });
              continue;
            }
          }

          // LLM is truly done or can't proceed
          this.emitProgress('completed', 1.0, 'Done');

          return {
            success: filesChanged.length > 0,
            plan: null as any,
            patches: [],
            filesChanged: [...new Set(filesChanged)],
            summary: response.content || (filesChanged.length > 0 ? 'Task completed' : 'No action taken — the AI model did not use any tools'),
            metrics: this.buildMetrics(turn + 1, totalTokensIn, totalTokensOut, filesChanged, startTime),
          };
        }
      }

      // Max turns reached
      this.emitProgress('completed', 1.0, 'Max turns reached');

      return {
        success: filesChanged.length > 0,
        plan: null as any,
        patches: [],
        filesChanged: [...new Set(filesChanged)],
        summary: filesChanged.length > 0
          ? `Completed: deleted ${[...new Set(filesChanged)].join(', ')}`
          : `Task ran ${maxTurns} turns but no files were changed`,
        metrics: this.buildMetrics(maxTurns, totalTokensIn, totalTokensOut, filesChanged, startTime),
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emitProgress('failed', 0, message);

      return {
        success: false,
        plan: null as any,
        patches: [],
        filesChanged: [],
        summary: `Failed: ${message}`,
        metrics: this.buildMetrics(0, totalTokensIn, totalTokensOut, filesChanged, startTime),
        error: { stage: 'failed', message, recoverable: false },
      };
    }
  }

  /**
   * Execute a single tool call and return the result.
   */
  private async executeToolCall(call: LLMToolCall): Promise<ToolResult> {
    try {
      const toolCall: ToolCall = {
        id: call.id,
        name: call.name as any,
        args: call.arguments,
        timestamp: new Date(),
      };
      const result = await this.toolRouter.execute(toolCall);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      };
    }
  }

  private emitProgress(stage: string, progress: number, message: string): void {
    if (this.onProgress) {
      this.onProgress({
        agentId: 'direct-agent',
        stage: stage as any,
        progress,
        message,
        timestamp: new Date(),
      });
    }
  }

  private buildMetrics(
    llmCalls: number,
    tokensIn: number,
    tokensOut: number,
    filesChanged: string[],
    startTime: number
  ): AgentMetrics {
    return {
      totalSteps: llmCalls,
      completedSteps: llmCalls,
      filesRead: 0,
      filesModified: new Set(filesChanged).size,
      patchesGenerated: 0,
      patchesApplied: 0,
      contextTokens: Math.round((tokensIn + tokensOut) / 4),
      executionTimeMs: Date.now() - startTime,
      llmCalls,
    };
  }

  private isScaffoldingRequest(prompt: string): boolean {
    return /(monorepo|workspace|folder structure|project structure|scaffold|starter|package\.json|tsconfig|vite|turbo|apps\/|packages\/)/i.test(prompt);
  }

  private selectToolDefinitions(scaffoldingRequest: boolean) {
    const definitions = this.toolRouter.getLLMToolDefinitions();

    if (!scaffoldingRequest || !this.workspaceContext?.fileTree?.length) {
      return definitions;
    }

    return definitions.filter(tool =>
      tool.name !== 'list_files'
      && tool.name !== 'search_code'
      && tool.name !== 'get_context'
    );
  }

  private isMutatingTool(toolName: string): boolean {
    return toolName === 'write_file'
      || toolName === 'edit_file'
      || toolName === 'delete_file'
      || toolName === 'apply_patch';
  }

  private throwIfAborted(): void {
    if (!this.abortSignal?.aborted) {
      return;
    }

    const reason = this.abortSignal.reason;
    if (reason instanceof Error) {
      throw reason;
    }

    const abortError = new Error(typeof reason === 'string' ? reason : 'Task cancelled');
    abortError.name = 'AbortError';
    throw abortError;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error
      && (error.name === 'AbortError'
        || error.message === 'Task cancelled'
        || error.message === 'Task timeout');
  }

  private createToolFingerprint(call: LLMToolCall): string {
    return JSON.stringify({
      name: call.name,
      arguments: call.arguments,
    });
  }

  /**
   * Detect which file the user wants to delete from the prompt and LLM response.
   * Used as a fallback when the LLM returns text instead of tool calls.
   */
  private detectFileToDelete(
    userPrompt: string,
    llmContent: string,
    fileList: Array<{ path: string }>
  ): string | null {
    const combined = `${userPrompt} ${llmContent}`.toLowerCase();

    // 1. Try to find exact file name matches in the file list
    for (const file of fileList) {
      const fileName = file.path.split('/').pop()?.toLowerCase() || '';
      const fullPath = file.path.toLowerCase();

      // Check if the user/LLM mentioned this file by name
      if (combined.includes(fileName) || combined.includes(fullPath)) {
        // Skip directories
        if ((file as any).isDirectory) continue;
        return file.path;
      }
    }

    // 2. Try to match file extensions mentioned in the prompt
    const extensionPatterns = [
      { pattern: /\.html\b/i, ext: '.html' },
      { pattern: /\.css\b/i, ext: '.css' },
      { pattern: /\.js\b/i, ext: '.js' },
      { pattern: /\.ts\b/i, ext: '.ts' },
      { pattern: /\.json\b/i, ext: '.json' },
      { pattern: /\.txt\b/i, ext: '.txt' },
      { pattern: /\.py\b/i, ext: '.py' },
    ];

    for (const { pattern, ext } of extensionPatterns) {
      if (pattern.test(combined)) {
        // Find a file with this extension
        const match = fileList.find(f =>
          f.path.endsWith(ext) && !(f as any).isDirectory
        );
        if (match) return match.path;
      }
    }

    return null;
  }
}
