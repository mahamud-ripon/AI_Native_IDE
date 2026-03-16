/**
 * Tool Router
 * 
 * Routes tool calls to appropriate handlers.
 * Provides a unified interface for executing workspace and retrieval operations.
 */

import {
  ToolCall,
  ToolDefinition,
  ToolName,
  ToolExecutionError,
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
   * Register a tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Execute a tool call
   */
  async execute(call: ToolCall): Promise<unknown> {
    const tool = this.tools.get(call.name);

    if (!tool) {
      throw new ToolExecutionError(call.name, `Unknown tool: ${call.name}`, call.args);
    }

    // Validate required parameters
    for (const param of tool.parameters) {
      if (param.required && !(param.name in call.args)) {
        if (param.default !== undefined) {
          call.args[param.name] = param.default;
        } else {
          throw new ToolExecutionError(
            call.name,
            `Missing required parameter: ${param.name}`,
            call.args
          );
        }
      }
    }

    try {
      const result = await tool.execute(call.args);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ToolExecutionError(call.name, message, call.args);
    }
  }

  /**
   * Execute multiple tool calls
   */
  async executeBatch(calls: ToolCall[]): Promise<unknown[]> {
    const results: unknown[] = [];

    for (const call of calls) {
      const result = await this.execute(call);
      results.push(result);
    }

    return results;
  }

  /**
   * Get all registered tools
   */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
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
   * Register default tools
   */
  private registerDefaultTools(): void {
    // Read file tool
    this.registerTool({
      name: 'read_file',
      description: 'Read the contents of a file from the workspace',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'Relative path to the file',
          required: true,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        return this.workspace.readFile(args.path as string);
      },
    });

    // Write file tool
    this.registerTool({
      name: 'write_file',
      description: 'Write content to a file in the workspace',
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
          description: 'Content to write to the file',
          required: true,
        },
      ],
      execute: async (args) => {
        if (!this.workspace) {
          throw new Error('Workspace not configured');
        }
        await this.workspace.writeFile(args.path as string, args.content as string);
        return { success: true, path: args.path };
      },
    });

    // Apply patch tool
    this.registerTool({
      name: 'apply_patch',
      description: 'Apply a unified diff patch to the workspace',
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
        return result;
      },
    });

    // Search code tool
    this.registerTool({
      name: 'search_code',
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
        return codeIndex.search(args.query as string, options);
      },
    });

    // List files tool
    this.registerTool({
      name: 'list_files',
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

        if (basePath && basePath !== '.') {
          return files.filter(f => f.path.startsWith(basePath));
        }
        return files;
      },
    });

    // Get context tool
    this.registerTool({
      name: 'get_context',
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
        return builder.buildContext(this.workspace, {
          userPrompt: args.query as string,
          maxTokens: args.maxTokens as number,
        });
      },
    });

    // Execute command tool (limited)
    this.registerTool({
      name: 'execute_command',
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
            command,
            status: 'blocked',
            message: 'Command execution requires user approval',
          };
        }

        return { command, status: 'no-workspace' };
      },
    });
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
