/**
 * Mode Router
 *
 * Classifies user prompts and routes to the correct agent mode.
 * Uses rule-based heuristics plus admin config from ConfigService.
 */

import { getConfigService } from '../../config/config_service.js';
import type { ConfigService } from '../../config/config_service.js';
import type { TaskComplexity, ToolIntent, ToolName } from './agent_types.js';

export type AgentMode = 'direct' | 'plan_execute' | 'multi_agent';

export interface RoutingContext {
  userSelectedMode?: AgentMode;
  taskComplexity?: TaskComplexity;
  toolIntent?: ToolIntent;
  availableTools?: ToolName[];
  contextFiles?: string[];
  activeFile?: string | null;
  openTabs?: string[];
}

export interface ModeDecision {
  mode: AgentMode;
  reason: string;
  modelConfig: { provider: string; model: string };
  complexity: TaskComplexity;
  maxTurns: number;
  availableTools: ToolName[];
  selectedTools: ToolName[];
  toolIntent?: ToolIntent;
}

const HIGH_COMPLEXITY_PATTERNS = [
  'build a full',
  'create a project',
  'scaffold',
  'full stack',
  'fullstack',
  'entire app',
  'entire project',
  'set up ci/cd',
  'add auth system',
  'initialize project',
  'create a new app',
  'build me a',
  'build an app',
  'generate a project',
  'multi-agent',
  'multi agent',
  'design the architecture',
  'analyze the full repo',
];

const LOW_COMPLEXITY_PATTERNS = [
  'create a file',
  'create file',
  'new file',
  'delete the file',
  'delete file',
  'remove the file',
  'rename the file',
  'rename file',
  'add a comment',
  'fix typo',
  'fix a typo',
  'explain this',
  'what does this',
  'what is this',
  'show me',
  'read this',
  'read file',
  'list files',
  'show files',
  'what files',
];

const MEDIUM_COMPLEXITY_PATTERNS = [
  'refactor',
  'improve',
  'optimize',
  'debug',
  'trace',
  'add tests',
  'update the workflow',
  'analyze service',
  'review architecture',
  'pipeline',
];

const READ_ONLY_TOOLS: ToolName[] = ['read_file', 'search_code', 'list_files', 'get_context'];
const MUTATING_TOOLS: ToolName[] = ['write_file', 'edit_file', 'delete_file', 'apply_patch', 'execute_command'];
const DEFAULT_AVAILABLE_TOOLS: ToolName[] = [
  'read_file',
  'write_file',
  'delete_file',
  'edit_file',
  'apply_patch',
  'search_code',
  'list_files',
  'get_context',
  'execute_command',
];

export class ModeRouter {
  private config: ConfigService;

  constructor(config?: ConfigService) {
    this.config = config ?? getConfigService();
  }

  /**
   * Decide which agent mode to use for a given prompt.
   *
   * Supports the legacy string overload (`decide(prompt, mode)`) and the
   * richer routing context used by the task orchestrator.
   */
  async decide(prompt: string, options?: AgentMode | RoutingContext): Promise<ModeDecision> {
    const routing = typeof options === 'string'
      ? { userSelectedMode: options }
      : (options ?? {});

    const availableTools = this.normalizeTools(routing.availableTools);
    const selectedTools = this.selectTools(routing.toolIntent, availableTools);

    const userAllowed = await this.config.getConfig<boolean>('ai.mode_selection.user_allowed', true);
    const availableModes = await this.config.getConfig<AgentMode[]>(
      'ai.available_modes',
      ['direct', 'plan_execute', 'multi_agent']
    );

    if (routing.userSelectedMode && userAllowed && availableModes.includes(routing.userSelectedMode)) {
      return this.buildDecision(
        routing.userSelectedMode,
        'user_selected',
        selectedTools,
        availableTools,
        routing.toolIntent,
      );
    }

    const hintedComplexity = routing.taskComplexity;
    const complexity = hintedComplexity
      ?? this.classifyComplexity(prompt, routing, selectedTools);

    const hintReason = hintedComplexity ? `hint_${hintedComplexity}` : `auto_${complexity}`;
    return this.buildDecisionForComplexity(
      complexity,
      hintReason,
      selectedTools,
      availableTools,
      routing.toolIntent,
      availableModes,
    );
  }

  private classifyComplexity(
    prompt: string,
    routing: RoutingContext,
    selectedTools: ToolName[],
  ): TaskComplexity {
    const lower = prompt.toLowerCase().trim();
    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    const contextFileCount = routing.contextFiles?.length ?? 0;
    const readOnly = routing.toolIntent?.readOnly === true;
    const mutatingToolRequested = selectedTools.some(tool => MUTATING_TOOLS.includes(tool));
    const readOnlyToolsOnly = selectedTools.length > 0 && selectedTools.every(tool => READ_ONLY_TOOLS.includes(tool));

    if (this.includesAny(lower, HIGH_COMPLEXITY_PATTERNS) || wordCount > 120) {
      return 'high';
    }

    if (readOnly && wordCount <= 40) {
      return 'low';
    }

    if (readOnlyToolsOnly && wordCount <= 30) {
      return 'low';
    }

    if (routing.activeFile && !mutatingToolRequested && wordCount <= 35) {
      return 'low';
    }

    if (this.includesAny(lower, LOW_COMPLEXITY_PATTERNS) && contextFileCount <= 2) {
      return 'low';
    }

    if (contextFileCount > 6 || (routing.openTabs?.length ?? 0) > 6) {
      return 'medium';
    }

    if (selectedTools.includes('execute_command') && wordCount >= 40) {
      return 'medium';
    }

    if (mutatingToolRequested && contextFileCount > 3) {
      return 'medium';
    }

    if (this.includesAny(lower, MEDIUM_COMPLEXITY_PATTERNS)) {
      return 'medium';
    }

    if (wordCount < 15) {
      return 'low';
    }

    return 'medium';
  }

  private async buildDecisionForComplexity(
    complexity: TaskComplexity,
    reason: string,
    selectedTools: ToolName[],
    availableTools: ToolName[],
    toolIntent: ToolIntent | undefined,
    availableModes?: AgentMode[],
  ): Promise<ModeDecision> {
    const modes = availableModes
      ?? await this.config.getConfig<AgentMode[]>('ai.available_modes', ['direct', 'plan_execute', 'multi_agent']);

    if (complexity === 'low') {
      return this.buildDecision('direct', reason, selectedTools, availableTools, toolIntent);
    }

    if (complexity === 'high') {
      const mode3Enabled = await this.config.getConfig<boolean>('ai.mode3.enabled', true);
      if (mode3Enabled && modes.includes('multi_agent')) {
        return this.buildDecision('multi_agent', reason, selectedTools, availableTools, toolIntent);
      }

      return this.buildDecision('plan_execute', `${reason}_fallback`, selectedTools, availableTools, toolIntent);
    }

    return this.buildDecision('plan_execute', reason, selectedTools, availableTools, toolIntent);
  }

  private async buildDecision(
    mode: AgentMode,
    reason: string,
    selectedTools: ToolName[],
    availableTools: ToolName[],
    toolIntent?: ToolIntent,
  ): Promise<ModeDecision> {
    let modelConfig: { provider: string; model: string };
    let maxTurns: number;

    switch (mode) {
      case 'direct':
        modelConfig = await this.config.getConfig<{ provider: string; model: string }>(
          'ai.mode1.model',
          { provider: 'groq', model: 'llama-3.3-70b-versatile' },
        );
        maxTurns = await this.config.getConfig<number>('ai.max_turns.direct', 10);
        break;

      case 'plan_execute':
        modelConfig = await this.config.getConfig<{ provider: string; model: string }>(
          'ai.mode2.model',
          { provider: 'openai', model: 'gpt-4.1' },
        );
        maxTurns = 1;
        break;

      case 'multi_agent':
        modelConfig = { provider: 'multi', model: 'langgraph-agents' };
        maxTurns = 0;
        break;
    }

    const complexity: TaskComplexity =
      mode === 'direct' ? 'low' : mode === 'plan_execute' ? 'medium' : 'high';

    return {
      mode,
      reason,
      modelConfig,
      complexity,
      maxTurns,
      availableTools,
      selectedTools,
      toolIntent,
    };
  }

  private normalizeTools(availableTools?: ToolName[]): ToolName[] {
    if (!availableTools || availableTools.length === 0) {
      return DEFAULT_AVAILABLE_TOOLS;
    }

    return Array.from(new Set(availableTools));
  }

  private selectTools(toolIntent: ToolIntent | undefined, availableTools: ToolName[]): ToolName[] {
    if (!toolIntent) {
      return availableTools;
    }

    const requested = new Set<ToolName>();

    for (const tool of toolIntent.requiredTools ?? []) {
      if (availableTools.includes(tool)) {
        requested.add(tool);
      }
    }

    for (const tool of toolIntent.preferredTools ?? []) {
      if (availableTools.includes(tool)) {
        requested.add(tool);
      }
    }

    if (requested.size > 0) {
      return Array.from(requested);
    }

    if (toolIntent.readOnly) {
      return availableTools.filter(tool => READ_ONLY_TOOLS.includes(tool));
    }

    return availableTools;
  }

  private includesAny(text: string, patterns: string[]): boolean {
    return patterns.some(pattern => text.includes(pattern));
  }
}

let defaultRouter: ModeRouter | null = null;

export function getModeRouter(): ModeRouter {
  if (!defaultRouter) {
    defaultRouter = new ModeRouter();
  }
  return defaultRouter;
}
