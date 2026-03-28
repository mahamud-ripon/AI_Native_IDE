/**
 * Tool Router
 * 
 * Routes tool calls to appropriate handlers.
 * Provides a unified interface for executing workspace and retrieval operations.
 */

import pLimit from 'p-limit';
import {
  ToolExecutionError,
} from './agent_types.js';
import type {
  ToolCapability,
  ToolCall,
  ToolDefinition,
  ToolIntent,
  ToolName,
  ToolResult,
} from './agent_types.js';
import { WorkspaceFS } from '../workspace/workspace_fs.js';
import { getCodeIndex } from '../retrieval/code_index.js';
import { SearchOptions } from '../retrieval/retrieval_types.js';

/**
 * Tool Router
 */
export class ToolRouter {
  private workspace: WorkspaceFS | null = null;
  private tools: Map<ToolName, ToolDefinition> = new Map();
  private agentRoles: string[] = ['admin']; // Mocked role context for permissions

  constructor(workspace?: WorkspaceFS) {
    this.workspace = workspace ?? null;
    this.registerDefaultTools();
  }

  /**
   * Set workspace
   */
  setWorkspace(workspace: WorkspaceFS): void {
    this.workspace = workspace;
  }

  /**
   * Set current agent roles for permission checks
   */
  setAgentRoles(roles: string[]): void {
    this.agentRoles = roles;
  }

  /**
   * Register a tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Execute a tool call
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);

    if (!tool) {
      throw new ToolExecutionError(call.name, `Unknown tool: ${call.name}`, call.args, 'UNKNOWN_TOOL');
    }

    // 1. Permission Check
    if (tool.permissions && tool.permissions.length > 0) {
      const hasPermission = tool.permissions.some(p => this.agentRoles.includes(p));
      if (!hasPermission) {
        throw new ToolExecutionError(
          call.name,
          `Permission denied. Requires one of: ${tool.permissions.join(', ')}`,
          call.args,
          'PERMISSION_DENIED'
        );
      }
    }

    // 2. Parameter Type & Requirement Validation
    for (const param of tool.parameters) {
      const value = call.args[param.name];

      if (param.required && value === undefined) {
        if (param.default !== undefined) {
          call.args[param.name] = param.default;
        } else {
          throw new ToolExecutionError(
            call.name,
            `Missing required parameter: ${param.name}`,
            call.args,
            'MISSING_PARAM'
          );
        }
      }

      if (value !== undefined) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== param.type && param.type !== 'any' as any) {
          throw new ToolExecutionError(
            call.name,
            `Invalid type for ${param.name}. Expected ${param.type}, got ${actualType}`,
            call.args,
            'INVALID_TYPE'
          );
        }
      }
    }

    // 3. Execution with Timeout
    try {
      const timeoutMs = tool.timeoutMs ?? 30000; // Default 30s timeout

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const result = await Promise.race([
        tool.execute(call.args),
        timeoutPromise
      ]);

      return result as ToolResult;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // Return structured error instead of throwing to prevent agent crashes
      return {
        success: false,
        error: message,
        errorCode: 'EXECUTION_FAILED'
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel with concurrency limits
   */
  async executeBatch(calls: ToolCall[], concurrency: number = 3): Promise<ToolResult[]> {
    const limit = pLimit(concurrency);
    const promises = calls.map(call => limit(() => this.execute(call)));
    return Promise.all(promises);
  }

  /**
   * Get all registered tools
   */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get registered tool names.
   */
  getToolNames(): ToolName[] {
    return this.getTools().map(tool => tool.name);
  }

  /**
   * Resolve a routing hint into concrete tools supported by this router.
   */
  resolveToolIntent(intent?: ToolIntent): ToolName[] {
    const tools = this.getTools();

    if (!intent) {
      return tools.map(tool => tool.name);
    }

    const requested = new Set<ToolName>();

    for (const toolName of intent.requiredTools ?? []) {
      if (this.tools.has(toolName)) {
        requested.add(toolName);
      }
    }

    for (const toolName of intent.preferredTools ?? []) {
      if (this.tools.has(toolName)) {
        requested.add(toolName);
      }
    }

    if (requested.size > 0) {
      return Array.from(requested);
    }

    if (intent.readOnly) {
      return tools
        .filter(tool => (tool.capabilities ?? []).every(capability => !this.isMutatingCapability(capability)))
        .map(tool => tool.name);
    }

    return tools.map(tool => tool.name);
  }

  /**
   * Summarize tool capabilities for router/telemetry use.
   */
  getRoutingSummary(): Array<{ name: ToolName; capabilities: ToolCapability[] }> {
    return this.getTools().map(tool => ({
      name: tool.name,
      capabilities: tool.capabilities ?? [],
    }));
  }

  /**
   * Get tool definitions for LLM
   */
  getToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: Array<{
      name: string;
      type: string;
      description: string;
      required: boolean;
    }>;
  }> {
    return this.getTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters.map(p => ({
        name: p.name,
        type: p.type,
        description: p.description,
        required: p.required,
      })),
    }));
  }

  /**
   * Get tool definitions in LLM function-calling format.
   * Used by DirectAgent to pass tools to the LLM gateway.
   */
  getLLMToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  }> {
    return this.getTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          tool.parameters.map(p => [
            p.name,
            {
              type: p.type,
              description: p.description,
            },
          ])
        ),
        required: tool.parameters.filter(p => p.required).map(p => p.name),
      },
    }));
  }

  /**
   * Register default tools
   */
  private registerDefaultTools(): void {
    // =========================================================================
    // READ FILE — Paginated with line numbers (SOTA architecture)
    // =========================================================================
    this.registerTool({
      name: 'read_file',
      capabilities: ['read', 'inspect'],
      description: 'Read a file from the workspace. Returns content with line numbers for easy navigation. Use offset and limit for large files.',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'Relative path to the file',
          required: true,
        },
        {
          name: 'offset',
          type: 'number',
          description: 'Line number to start reading from (1-indexed). Default: 1',
          required: false,
          default: 1,
        },
        {
          name: 'limit',
          type: 'number',
          description: 'Maximum number of lines to return. Default: 2000',
          required: false,
          default: 2000,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        const path = args.path as string;
        const offset = (args.offset as number) || 1;
        const limit = (args.limit as number) || 2000;

        const raw = await this.workspace.readFile(path);
        const lines = raw.split('\n');
        const totalLines = lines.length;

        // Slice the requested range
        const startIdx = Math.max(0, offset - 1);
        const endIdx = Math.min(totalLines, startIdx + limit);
        const selectedLines = lines.slice(startIdx, endIdx);

        // Prepend line numbers: "  14: const x = 10;"
        const numberedLines = selectedLines.map((line, i) => {
          const lineNum = startIdx + i + 1;
          return `${String(lineNum).padStart(5)}: ${line}`;
        });

        let output = numberedLines.join('\n');
        if (endIdx < totalLines) {
          output += `\n\n[Truncated at line ${endIdx}. File has ${totalLines} total lines. Use offset=${endIdx + 1} to read more.]`;
        }

        return { success: true, data: output };
      },
    });

    // =========================================================================
    // EDIT FILE — Exact string replacement (SOTA: Claude/Gemini architecture)
    // =========================================================================
    this.registerTool({
      name: 'edit_file',
      capabilities: ['write', 'modify'],
      description: 'Edit a file by replacing an exact string match with new content. Use this for modifying existing files. DO NOT use for creating new files — use write_file instead.',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'Relative path to the file to edit',
          required: true,
        },
        {
          name: 'oldString',
          type: 'string',
          description: 'The exact text to find and replace. Must match exactly including whitespace, indentation, and line endings. Include surrounding context lines to ensure uniqueness.',
          required: true,
        },
        {
          name: 'newString',
          type: 'string',
          description: 'The new text to replace oldString with',
          required: true,
        },
        {
          name: 'replaceAll',
          type: 'boolean',
          description: 'If true, replaces ALL occurrences of oldString. Default: false (must be unique match)',
          required: false,
          default: false,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }

        const path = args.path as string;
        const oldString = args.oldString as string;
        const newString = args.newString as string;
        const replaceAll = (args.replaceAll as boolean) || false;

        if (!oldString) {
          throw new Error('oldString cannot be empty. Use write_file to create new files.');
        }

        // Read the file
        let content: string;
        try {
          content = await this.workspace.readFile(path);
        } catch (err) {
          throw new Error(`Cannot read file "${path}": ${err instanceof Error ? err.message : 'File not found'}`);
        }

        // Count matches
        const matchCount = content.split(oldString).length - 1;

        if (matchCount === 0) {
          throw new Error(
            `oldString not found in "${path}". Ensure exact match including whitespace, indentation, and line endings. ` +
            `Tip: read the file first with read_file to see the exact content.`
          );
        }

        if (matchCount > 1 && !replaceAll) {
          throw new Error(
            `Found ${matchCount} matches for oldString in "${path}". ` +
            `Provide more surrounding context lines in oldString to make it unique, ` +
            `or set replaceAll: true to replace all ${matchCount} occurrences.`
          );
        }

        // Perform replacement
        let newContent: string;
        if (replaceAll) {
          newContent = content.split(oldString).join(newString);
        } else {
          newContent = content.replace(oldString, newString);
        }

        // Write back
        await this.workspace.writeFile(path, newContent);

        return {
          success: true,
          data: {
            path,
            replacements: replaceAll ? matchCount : 1,
          }
        };
      },
    });

    // =========================================================================
    // WRITE FILE — Full overwrite (restricted to new files)
    // =========================================================================
    this.registerTool({
      name: 'write_file',
      capabilities: ['write'],
      description: 'Create a new file or completely overwrite an existing file with new content. WARNING: This ERASES all existing content. For editing parts of existing files, use edit_file instead.',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'Relative path to the file',
          required: true,
        },
        {
          name: 'content',
          type: 'string',
          description: 'Full content of the file. This REPLACES all existing content.',
          required: true,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        await this.workspace.writeFile(args.path as string, args.content as string);
        return { success: true, data: { path: args.path } };
      },
    });

    // =========================================================================
    // DELETE FILE
    // =========================================================================
    this.registerTool({
      name: 'delete_file',
      capabilities: ['delete'],
      description: 'Delete a file from the workspace permanently',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'Relative path of the file to delete',
          required: true,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        await this.workspace.deleteFile(args.path as string);
        return { success: true, data: { path: args.path } };
      },
    });

    // =========================================================================
    // APPLY PATCH — Legacy tool (kept for backwards compatibility)
    // =========================================================================
    this.registerTool({
      name: 'apply_patch',
      capabilities: ['write', 'modify'],
      description: 'Apply a unified diff patch. DEPRECATED: prefer edit_file for precise changes.',
      parameters: [
        {
          name: 'patch',
          type: 'string',
          description: 'Unified diff patch content',
          required: true,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        const result = await this.workspace.applyPatch(args.patch as string);
        return { success: result.success, data: result };
      },
    });

    // =========================================================================
    // SEARCH CODE
    // =========================================================================
    this.registerTool({
      name: 'search_code',
      capabilities: ['search', 'inspect'],
      description: 'Search for code in the workspace using semantic or keyword search',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'Search query',
          required: true,
        },
        {
          name: 'mode',
          type: 'string',
          description: 'Search mode: semantic, keyword, or hybrid',
          required: false,
          default: 'hybrid',
        },
        {
          name: 'maxResults',
          type: 'number',
          description: 'Maximum number of results',
          required: false,
          default: 10,
        },
      ],
      execute: async (args) => {
        const codeIndex = getCodeIndex();
        const options: SearchOptions = {
          mode: args.mode as SearchOptions['mode'],
          maxResults: args.maxResults as number,
        };
        const results = await codeIndex.search(args.query as string, options);
        return { success: true, data: results };
      },
    });

    // List files tool
    this.registerTool({
      name: 'list_files',
      capabilities: ['read', 'inspect'],
      description: 'List files in a directory',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'Directory path to list',
          required: false,
          default: '.',
        },
        {
          name: 'recursive',
          type: 'boolean',
          description: 'Whether to list recursively',
          required: false,
          default: true,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        const files = await this.workspace.listFiles();
        const basePath = args.path as string;

        let resultFiles = files;
        if (basePath && basePath !== '.') {
          resultFiles = files.filter(f => f.path.startsWith(basePath));
        }
        return { success: true, data: resultFiles };
      },
    });

    // Get context tool
    this.registerTool({
      name: 'get_context',
      capabilities: ['context', 'search', 'inspect'],
      description: 'Build project context for a query',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'Query to build context for',
          required: true,
        },
        {
          name: 'maxTokens',
          type: 'number',
          description: 'Maximum tokens for context',
          required: false,
          default: 20000,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        // Import dynamically to avoid circular dependency
        const { getContextBuilder } = await import('../context/project_context_builder.js');
        const builder = getContextBuilder();
        const result = await builder.buildContext(this.workspace, {
          userPrompt: args.query as string,
          maxTokens: args.maxTokens as number,
        });
        return { success: true, data: result };
      },
    });

    // Execute command tool (limited)
    this.registerTool({
      name: 'execute_command',
      capabilities: ['execute', 'debug'],
      description: 'Execute a shell command (limited to safe operations)',
      parameters: [
        {
          name: 'command',
          type: 'string',
          description: 'Command to execute',
          required: true,
        },
        {
          name: 'cwd',
          type: 'string',
          description: 'Working directory',
          required: false,
        },
      ],
      execute: async (args) => {
        // Only allow safe commands
        const command = args.command as string;
        const safeCommands = ['npm', 'pnpm', 'yarn', 'node', 'npx', 'git'];

        const firstWord = command.split(' ')[0];
        if (!safeCommands.includes(firstWord)) {
          throw new Error(`Unsafe command: ${firstWord}. Only ${safeCommands.join(', ')} commands are allowed.`);
        }

        // Execute via workspace if available
        if (this.workspace) {
          // For now, return a placeholder
          // In production, this would use a proper shell execution with sandboxing
          return {
            success: false,
            data: { command, status: 'blocked', message: 'Command execution requires user approval' }
          };
        }

        return { success: false, data: { command, status: 'no-workspace' } };
      },
    });
  }

  private isMutatingCapability(capability: ToolCapability): boolean {
    return capability === 'write' || capability === 'modify' || capability === 'delete' || capability === 'execute';
  }
}

// Singleton instance
let defaultRouter: ToolRouter | null = null;

/**
 * Get default tool router
 */
export function getToolRouter(): ToolRouter {
  if (!defaultRouter) {
    defaultRouter = new ToolRouter();
  }
  return defaultRouter;
}

/**
 * Create tool router
 */
export function createToolRouter(workspace?: WorkspaceFS): ToolRouter {
  return new ToolRouter(workspace);
}

/**
 * Execute tool helper
 */
export async function executeTool(call: ToolCall): Promise<unknown> {
  const router = getToolRouter();
  return router.execute(call);
}

/**
 * Map LLM tool names to ToolRouter tool names.
 * LLMs often use different naming conventions.
 */
const TOOL_NAME_ALIASES: Record<string, ToolName> = {
  write: 'write_file',
  'write_file': 'write_file',
  read: 'read_file',
  'read_file': 'read_file',
  delete: 'delete_file',
  'delete_file': 'delete_file',
  edit: 'edit_file',
  'edit_file': 'edit_file',
  patch: 'apply_patch',
  'apply_patch': 'apply_patch',
  search: 'search_code',
  'search_code': 'search_code',
  list: 'list_files',
  'list_files': 'list_files',
  context: 'get_context',
  'get_context': 'get_context',
  exec: 'execute_command',
  run: 'execute_command',
  'execute_command': 'execute_command',
};

function decodeToolParameterValue(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, '\'')
    .replace(/&amp;/g, '&');
}

/**
 * Parse and execute XML-style tool calls from LLM response.
 * Supports format: <tool_call><function=NAME>...</function></tool_call>
 * Also supports: <function=NAME><parameter>...</parameter>...</function>
 */
export async function executeParsedToolCalls(
  content: string,
  userId: string,
  projectId: string
): Promise<{ hasToolCalls: boolean; results: Array<{ name: string; success: boolean; result?: string; error?: string }> }> {
  const results: Array<{ name: string; success: boolean; result?: string; error?: string }> = [];
  
  // Parse tool calls from content - support multiple formats
  // Format 1: <tool_call><function=NAME>...</tool_call> (more common now)
  // Format 2: <function=NAME>...</function>
  // Format 3: <tool_call><function=NAME>...</function></tool_call>
  const toolCallRegex = /<tool_call>\s*<function=([\w-]+)>([\s\S]*?)<\/tool_call>|<function=([\w-]+)>([\s\S]*?)<\/function>/gi;
  
  let match;
  while ((match = toolCallRegex.exec(content)) !== null) {
    const toolName = match[1] || match[3];
    const toolContent = match[2] || match[4];
    
    try {
      const params: Record<string, string> = {};
      
      // Parse parameters - try multiple formats
      // Format A: <parameter>name</parameter><value>...</value>
      const paramRegexA = /<parameter>([\s\S]*?)<\/parameter>[\s\S]*?<value>([\s\S]*?)<\/value>/gi;
      let paramMatch;
      while ((paramMatch = paramRegexA.exec(toolContent)) !== null) {
        params[paramMatch[1].trim()] = decodeToolParameterValue(paramMatch[2].trim());
      }
      
      // Format B: <parameter=name>...</parameter>
      const paramRegexB = /<parameter=([\w-]+)>([\s\S]*?)<\/parameter>/gi;
      while ((paramMatch = paramRegexB.exec(toolContent)) !== null) {
        let paramName = paramMatch[1];
        // Normalize common parameter name variations from different LLMs
        if (paramName === 'file_path') paramName = 'path';
        if (paramName === 'filepath') paramName = 'path';
        if (paramName === 'file_content') paramName = 'content';
        if (paramName === 'filecontent') paramName = 'content';
        
        params[paramName] = decodeToolParameterValue(paramMatch[2].trim());
      }
      
      // Also try extracting direct content between function tags as "content" param
      if (Object.keys(params).length === 0 && toolContent.trim()) {
        params['content'] = decodeToolParameterValue(toolContent.trim());
      }
      
      console.log(`[executeParsedToolCalls] Tool: ${toolName}, Params:`, params);
      
      // Map LLM tool name to ToolRouter name
      const mappedToolName = TOOL_NAME_ALIASES[toolName.toLowerCase()] || (toolName.toLowerCase() as ToolName);
      
      // Execute the tool
      const toolResult = await executeTool({
        id: `tc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: mappedToolName,
        args: params,
        timestamp: new Date(),
      });
      
      results.push({
        name: toolName,
        success: true,
        result: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
      });
    } catch (err: any) {
      console.error(`[executeParsedToolCalls] Error executing ${toolName}:`, err);
      results.push({
        name: toolName,
        success: false,
        error: err.message,
      });
    }
  }
  
  return { hasToolCalls: results.length > 0, results };
}
