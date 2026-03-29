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
  LLMProvider,
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
  llmProvider?: LLMProvider;
  toolRouter?: ToolRouter;
  workspaceContext?: {
    fileTree?: string[];
    activeFile?: string | null;
    activeFileContent?: string | null;
    openTabs?: string[];
  };
}

export interface DirectAgentRunOptions {
  fallbackModelConfig?: { provider: string; model: string };
}

type MutationIntent = 'create' | 'modify' | 'delete' | null;

export class DirectAgent {
  private workspace: WorkspaceFS;
  private toolRouter: ToolRouter;
  private llmProvider: LLMProvider;
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
    this.toolRouter = config.toolRouter ?? getToolRouter();
    this.toolRouter.setWorkspace(config.workspace);
    this.llmProvider = config.llmProvider ?? new GatewayLLMProvider();
  }

  /**
   * Run the direct agent with a prompt.
   */
  async run(
    prompt: string,
    modelConfig: { provider: string; model: string },
    runOptions: DirectAgentRunOptions = {}
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const filesChanged: string[] = [];
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const scaffoldingRequest = this.isScaffoldingRequest(prompt);
    const maxTurns = scaffoldingRequest ? Math.min(this.maxTurns, 6) : this.maxTurns;
    const mutationIntent = this.detectMutationIntent(prompt);
    let activeModelConfig = modelConfig;
    const fallbackModelConfig = runOptions.fallbackModelConfig
      && runOptions.fallbackModelConfig.model !== modelConfig.model
      ? runOptions.fallbackModelConfig
      : undefined;

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
      let successfulToolCalls = 0;
      let forcedToolRetryIssued = false;
      let fallbackModelActivated = false;

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
          model: activeModelConfig.model,
        });
        this.throwIfAborted();

        totalTokensIn += response.usage.promptTokens;
        totalTokensOut += response.usage.completionTokens;

        const parsedToolCalls = (!response.toolCalls || response.toolCalls.length === 0) && response.content
          ? this.extractToolCallsFromContent(response.content)
          : [];
        const toolCalls = parsedToolCalls.length > 0 ? parsedToolCalls : (response.toolCalls ?? []);

        console.log(
          `[DirectAgent] Turn ${turn + 1}: model=${activeModelConfig.model} toolCalls=${toolCalls.length} content="${response.content?.slice(0, 100)}"`
        );

        if (toolCalls.length > 0) {
          // LLM wants to use tools — add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls,
          });

          let duplicateMutationsThisTurn = 0;
          let mutatingToolExecutedThisTurn = false;
          const readOnlyToolCallsThisTurn = toolCalls.every(call => !this.isMutatingTool(call.name));

          // Execute each tool call
          for (const call of toolCalls) {
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

            // Handle command approval requests
            if (call.name === 'execute_command' && toolResult.data) {
              const data = toolResult.data as Record<string, unknown>;
              if (data.status === 'pending_approval') {
                this.emitProgress('command_approval_requested', 0.5, `Command needs approval: ${data.command || 'unknown'}`);
              }
            }

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
              successfulToolCalls++;
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

          if (duplicateMutationsThisTurn === toolCalls.length && filesChanged.length > 0) {
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

          if (mutationIntent && filesChanged.length === 0 && successfulToolCalls === 0 && turn < maxTurns - 1) {
            if (!forcedToolRetryIssued) {
              forcedToolRetryIssued = true;

              if (response.content?.trim()) {
                messages.push({
                  role: 'assistant',
                  content: response.content,
                });
              }

              messages.push({
                role: 'user',
                content: this.buildForcedToolRetryPrompt(prompt, mutationIntent, fileList),
              });
              this.emitProgress('editing', progress, 'Retrying with explicit file-tool instructions...');
              continue;
            }

            if (!fallbackModelActivated && fallbackModelConfig) {
              fallbackModelActivated = true;
              activeModelConfig = fallbackModelConfig;

              if (response.content?.trim()) {
                messages.push({
                  role: 'assistant',
                  content: response.content,
                });
              }

              messages.push({
                role: 'user',
                content: this.buildFallbackModelRetryPrompt(prompt, mutationIntent, fileList),
              });
              this.emitProgress(
                'editing',
                progress,
                `Retrying with fallback tool model (${fallbackModelConfig.provider}/${fallbackModelConfig.model})...`
              );
              continue;
            }
          }

          // LLM is truly done or can't proceed
          this.emitProgress('completed', 1.0, 'Done');
          const summary = response.content || (filesChanged.length > 0
            ? 'Task completed'
            : 'No action taken — the AI model did not use any tools');

          return {
            success: filesChanged.length > 0 || successfulToolCalls > 0 || Boolean(summary.trim()),
            plan: null as any,
            patches: [],
            filesChanged: [...new Set(filesChanged)],
            summary,
            metrics: this.buildMetrics(turn + 1, totalTokensIn, totalTokensOut, filesChanged, startTime),
          };
        }
      }

      // Max turns reached
      this.emitProgress('completed', 1.0, 'Max turns reached');

      return {
        success: filesChanged.length > 0 || successfulToolCalls > 0,
        plan: null as any,
        patches: [],
        filesChanged: [...new Set(filesChanged)],
        summary: filesChanged.length > 0
          ? `Completed: changed ${[...new Set(filesChanged)].join(', ')}`
          : successfulToolCalls > 0
            ? 'Task completed without mutating files'
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

  private detectMutationIntent(prompt: string): MutationIntent {
    const normalized = prompt.toLowerCase();

    if (/\b(delete|remove)\b/.test(normalized)) {
      return 'delete';
    }

    if (/\b(edit|modify|update|change|fix|patch|replace|refactor)\b/.test(normalized)) {
      return 'modify';
    }

    if (/\b(create|add|write|generate|make|scaffold|build)\b/.test(normalized)) {
      return 'create';
    }

    return null;
  }

  private buildForcedToolRetryPrompt(
    prompt: string,
    mutationIntent: Exclude<MutationIntent, null>,
    fileList: Array<{ path: string; isDirectory?: boolean }>
  ): string {
    const availableFiles = fileList
      .filter(file => !file.isDirectory)
      .slice(0, 40)
      .map(file => file.path)
      .join(', ');
    const activeFileHint = this.workspaceContext?.activeFile
      ? `Active file: ${this.workspaceContext.activeFile}.`
      : '';

    return [
      `The user asked you to ${mutationIntent} files.`,
      'Do not ask follow-up questions.',
      'Use the available file tools in your very next response.',
      mutationIntent === 'create'
        ? 'If the file path is not explicit, infer the most conventional path from the project structure and create the file with write_file.'
        : mutationIntent === 'modify'
          ? 'Read the target file first if needed, then use edit_file or write_file to complete the change.'
          : 'Choose the best matching existing file path from the project structure and delete it with delete_file.',
      activeFileHint,
      availableFiles ? `Available files: ${availableFiles}` : 'The workspace may currently be empty.',
      `Original request: ${prompt}`,
    ].filter(Boolean).join(' ');
  }

  private buildFallbackModelRetryPrompt(
    prompt: string,
    mutationIntent: Exclude<MutationIntent, null>,
    fileList: Array<{ path: string; isDirectory?: boolean }>
  ): string {
    return `${this.buildForcedToolRetryPrompt(prompt, mutationIntent, fileList)} This is a fallback execution attempt. Respond with tool calls only if possible.`;
  }

  private extractToolCallsFromContent(content: string): LLMToolCall[] {
    const toolCalls: LLMToolCall[] = [];
    const toolCallRegex = /<tool_call>\s*<function=([\w-]+)>([\s\S]*?)<\/tool_call>|<function=([\w-]+)>([\s\S]*?)<\/function>/gi;
    let match: RegExpExecArray | null;

    while ((match = toolCallRegex.exec(content)) !== null) {
      const toolName = this.normalizeToolName(match[1] || match[3] || '');
      const toolContent = match[2] || match[4] || '';
      if (!toolName) {
        continue;
      }

      const args: Record<string, unknown> = {};
      let paramMatch: RegExpExecArray | null;

      const paramRegexA = /<parameter>([\s\S]*?)<\/parameter>[\s\S]*?<value>([\s\S]*?)<\/value>/gi;
      while ((paramMatch = paramRegexA.exec(toolContent)) !== null) {
        args[this.normalizeToolParamName(paramMatch[1].trim())] = this.decodeToolParameterValue(paramMatch[2].trim());
      }

      const paramRegexB = /<parameter=([\w-]+)>([\s\S]*?)<\/parameter>/gi;
      while ((paramMatch = paramRegexB.exec(toolContent)) !== null) {
        args[this.normalizeToolParamName(paramMatch[1].trim())] = this.decodeToolParameterValue(paramMatch[2].trim());
      }

      if (Object.keys(args).length === 0 && toolContent.trim()) {
        args.content = this.decodeToolParameterValue(toolContent.trim());
      }

      toolCalls.push({
        id: `parsed-${toolCalls.length + 1}`,
        name: toolName,
        arguments: args,
      });
    }

    return toolCalls;
  }

  private normalizeToolName(name: string): string {
    const normalized = name.toLowerCase();
    const aliases: Record<string, string> = {
      write: 'write_file',
      write_file: 'write_file',
      read: 'read_file',
      read_file: 'read_file',
      delete: 'delete_file',
      delete_file: 'delete_file',
      remove: 'delete_file',
      edit: 'edit_file',
      edit_file: 'edit_file',
      patch: 'apply_patch',
      apply_patch: 'apply_patch',
      search: 'search_code',
      search_code: 'search_code',
      list: 'list_files',
      list_files: 'list_files',
      context: 'get_context',
      get_context: 'get_context',
      exec: 'execute_command',
      run: 'execute_command',
      execute_command: 'execute_command',
    };

    return aliases[normalized] ?? normalized;
  }

  private normalizeToolParamName(name: string): string {
    const normalized = name.toLowerCase();
    if (normalized === 'file_path' || normalized === 'filepath') return 'path';
    if (normalized === 'file_content' || normalized === 'filecontent') return 'content';
    if (normalized === 'old_string') return 'oldString';
    if (normalized === 'new_string') return 'newString';
    if (normalized === 'replace_all') return 'replaceAll';
    return name;
  }

  private decodeToolParameterValue(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;|&#x27;/gi, '\'')
      .replace(/&amp;/g, '&');
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
