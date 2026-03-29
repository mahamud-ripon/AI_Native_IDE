/**
 * Plan Generator
 * 
 * Generates execution plans from user prompts using LLM reasoning.
 * Analyzes the task and produces a structured plan with steps.
 */

import * as crypto from 'crypto';
import {
  CodePlan,
  PlanStep,
  PlanAction,
  LLMMessage,
  LLMResponse,
  LLMProvider,
  LLMOptions,
  PlanGenerationError,
  AGENT_DEFAULTS,
} from './agent_types.js';
import { ProjectContext } from '../context/context_types.js';
import { SearchResult } from '../retrieval/retrieval_types.js';

// Default LLM provider (can be injected)
let defaultLLMProvider: LLMProvider | null = null;

/**
 * Set default LLM provider
 */
export function setLLMProvider(provider: LLMProvider): void {
  defaultLLMProvider = provider;
}

/**
 * Get default LLM provider
 */
export function getLLMProvider(): LLMProvider | null {
  return defaultLLMProvider;
}

/**
 * Plan Generator
 */
export class PlanGenerator {
  private provider: LLMProvider | null;
  private maxIterations: number;

  constructor(options?: { provider?: LLMProvider; maxIterations?: number }) {
    this.provider = options?.provider ?? defaultLLMProvider;
    this.maxIterations = options?.maxIterations ?? AGENT_DEFAULTS.maxIterations;
  }

  /**
   * Generate plan from prompt and context
   */
  async generate(
    prompt: string,
    context: ProjectContext,
    searchResults?: SearchResult[]
  ): Promise<CodePlan> {
    if (!this.provider) {
      throw new PlanGenerationError('LLM provider not configured');
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(context);

    // Build user prompt with context
    const userPrompt = this.buildUserPrompt(prompt, context, searchResults);

    // Generate plan
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.complete(messages, {
      temperature: 0.3,
      maxTokens: 2200,
    });

    // Parse plan from response
    const plan = this.parsePlan(response.content, prompt);

    // Validate plan
    this.validatePlan(plan);

    return plan;
  }

  /**
   * Generate plan with iteration (ReAct-style)
   */
  async generateWithIteration(
    prompt: string,
    context: ProjectContext,
    onProgress?: (step: string) => void
  ): Promise<CodePlan> {
    if (!this.provider) {
      throw new PlanGenerationError('LLM provider not configured');
    }

    let currentPlan: CodePlan | null = null;
    let iteration = 0;

    while (iteration < this.maxIterations) {
      iteration++;

      onProgress?.(`Planning iteration ${iteration}...`);

      // Generate or refine plan
      const systemPrompt = this.buildSystemPrompt(context);
      const userPrompt = currentPlan
        ? this.buildRefinementPrompt(prompt, currentPlan)
        : this.buildUserPrompt(prompt, context);

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const response = await this.provider.complete(messages, {
        temperature: 0.3,
        maxTokens: 2200,
      });

      currentPlan = this.parsePlan(response.content, prompt);

      // Check if plan is complete and confident
      if (currentPlan.confidence >= 0.8 && currentPlan.steps.length > 0) {
        break;
      }
    }

    if (!currentPlan) {
      throw new PlanGenerationError('Failed to generate plan after max iterations');
    }

    return currentPlan;
  }

  /**
   * Build system prompt for plan generation
   */
  private buildSystemPrompt(context: ProjectContext): string {
    const language = context.language || 'unknown';
    const framework = context.framework?.name || 'none';

    return `You are an expert code planner. Your job is to analyze coding tasks and create detailed execution plans.

## Project Context
- Language: ${language}
- Framework: ${framework}
- Project Type: ${context.projectType}

## Your Task
Analyze the user's request and create a structured plan with clear steps.

## Output Format
Return ONLY a compact JSON object with this structure:
{
  "goal": "Clear description of what needs to be accomplished",
  "steps": [
    {
      "step": 1,
      "action": "create_file|modify_file|delete_file|rename_file",
      "file": "the ACTUAL file path from the project structure above",
      "description": "What this step does",
      "dependencies": [],
      "estimatedComplexity": "low|medium|high"
    }
  ],
  "affectedFiles": ["list of files that will be modified"],
  "newFiles": ["list of files that will be created"],
  "deletedFiles": ["list of files that will be deleted"],
  "confidence": 0.0-1.0,
  "reasoning": "Why this plan is appropriate"
}
Do not wrap the JSON in markdown fences.
Do not add commentary before or after the JSON.
Keep "reasoning" brief (1-2 sentences).

## Rules
1. Each step must have a clear, actionable description
2. **CRITICAL**: For delete_file and modify_file actions, you MUST use the EXACT file path from the Project Structure above. NEVER use placeholder paths like "path/to/file". If the user says "delete the file" without specifying which file, look at the Project Structure and ask yourself: which single file was most recently created or modified?
3. For create_file actions, use a descriptive relative path from project root
4. Dependencies reference step numbers
5. Confidence reflects your certainty (0.0-1.0)
6. Keep plans focused - max 10 steps
7. Prefer modify_file over create_file when possible
8. Order steps by dependency (independent first)
9. Keep step descriptions short (under 18 words when possible)
10. Use at most 6 steps unless the task truly needs more`;
  }

  /**
   * Build user prompt with context
   */
  private buildUserPrompt(
    prompt: string,
    context: ProjectContext,
    searchResults?: SearchResult[]
  ): string {
    let userPrompt = `## Task\n${prompt}\n\n`;

    // Add file tree context
    if (context.fileTree.length > 0) {
      userPrompt += `## Project Structure\n\`\`\`\n${this.formatFileTree(context.fileTree)}\n\`\`\`\n\n`;
    }

    // Add relevant files context
    if (context.relevantFiles.length > 0) {
      userPrompt += `## Relevant Files\n`;
      for (const file of context.relevantFiles.slice(0, 5)) {
        userPrompt += `- ${file.path} (${file.reason}: ${file.relevance.toFixed(2)})\n`;
      }
      userPrompt += '\n';
    }

    // Add search results
    if (searchResults && searchResults.length > 0) {
      userPrompt += `## Code Search Results\n`;
      for (const result of searchResults.slice(0, 5)) {
        userPrompt += `- ${result.chunk.path}:${result.chunk.startLine} (${result.chunk.name})\n`;
      }
      userPrompt += '\n';
    }

    userPrompt += `## Request\nCreate a plan to accomplish the task above.`;

    return userPrompt;
  }

  /**
   * Build refinement prompt for iteration
   */
  private buildRefinementPrompt(prompt: string, currentPlan: CodePlan): string {
    return `## Original Task
${prompt}

## Current Plan
\`\`\`json
${JSON.stringify(currentPlan, null, 2)}
\`\`\`

## Issues to Address
The current plan has low confidence (${currentPlan.confidence}). Please refine it:
1. Add missing steps if needed
2. Clarify file paths
3. Improve step descriptions
4. Update confidence score

Return an improved plan in the same JSON format.`;
  }

  /**
   * Parse plan from LLM response
   */
  private parsePlan(content: string, originalPrompt: string): CodePlan {
    try {
      const parsed = this.parsePlanJson(content);
      const parsedSteps = parsed.steps as Array<Partial<PlanStep>>;

      // Validate required fields
      if (!parsed.goal || !Array.isArray(parsed.steps)) {
        throw new Error('Missing required fields: goal, steps');
      }

      // Build plan object
      const plan: CodePlan = {
        id: this.generatePlanId(),
        goal: typeof parsed.goal === 'string' ? parsed.goal : originalPrompt,
        steps: parsedSteps.map((s: Partial<PlanStep>, index: number) => ({
          step: s.step ?? index + 1,
          action: this.validateAction(s.action),
          file: s.file,
          description: s.description ?? '',
          dependencies: s.dependencies ?? [],
          estimatedComplexity: s.estimatedComplexity ?? 'medium',
        })),
        affectedFiles: this.parseStringArray(parsed.affectedFiles),
        newFiles: this.parseStringArray(parsed.newFiles),
        deletedFiles: this.parseStringArray(parsed.deletedFiles),
        confidence: Math.min(1, Math.max(0, typeof parsed.confidence === 'number' ? parsed.confidence : 0.5)),
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        createdAt: new Date(),
      };

      return plan;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new PlanGenerationError(`Failed to parse plan: ${message}`, {
        goal: originalPrompt,
        steps: [],
        affectedFiles: [],
        newFiles: [],
        deletedFiles: [],
        confidence: 0,
        reasoning: `Parsing failed: ${message}`,
        createdAt: new Date(),
      });
    }
  }

  /**
   * Parse JSON content from an LLM response with a few repair passes for
   * models that wrap or truncate otherwise-valid JSON.
   */
  private parsePlanJson(content: string): Record<string, unknown> {
    const candidates = this.extractJsonCandidates(content);
    let lastError: Error | null = null;

    for (const candidate of candidates) {
      try {
        return this.parseJsonCandidate(candidate);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown JSON parse error');
      }
    }

    throw lastError ?? new Error('No JSON object found in model response');
  }

  /**
   * Build candidate JSON payloads from raw model output.
   */
  private extractJsonCandidates(content: string): string[] {
    const candidates = new Set<string>();
    const trimmed = content.trim();

    const addCandidate = (candidate?: string | null) => {
      const normalized = this.normalizeJsonCandidate(candidate);
      if (normalized) {
        candidates.add(normalized);
      }
    };

    addCandidate(trimmed);

    for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
      addCandidate(match[1]);
    }

    addCandidate(this.extractFirstJsonObject(trimmed));

    const firstBraceIndex = trimmed.indexOf('{');
    if (firstBraceIndex >= 0) {
      addCandidate(trimmed.slice(firstBraceIndex));
    }

    return [...candidates];
  }

  /**
   * Remove obvious markdown wrappers and leading labels.
   */
  private normalizeJsonCandidate(candidate?: string | null): string | null {
    if (!candidate) {
      return null;
    }

    let normalized = candidate.trim().replace(/^\uFEFF/, '');
    normalized = normalized.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    normalized = normalized.replace(/^json\s*/i, '').trim();

    return normalized || null;
  }

  /**
   * Try a few increasingly-forgiving parse passes for a candidate string.
   */
  private parseJsonCandidate(candidate: string): Record<string, unknown> {
    const attempts: string[] = [];
    const seen = new Set<string>();

    const addAttempt = (value?: string | null) => {
      const normalized = this.normalizeJsonCandidate(value);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        attempts.push(normalized);
      }
    };

    addAttempt(candidate);
    addAttempt(this.extractFirstJsonObject(candidate));
    addAttempt(this.stripTrailingCommas(candidate));

    const repaired = this.repairTruncatedJson(candidate);
    addAttempt(repaired);
    addAttempt(this.extractFirstJsonObject(repaired));

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt) as Record<string, unknown>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown JSON parse error');
      }
    }

    throw lastError ?? new Error('Unable to parse JSON candidate');
  }

  /**
   * Extract the first JSON object in a string. If the object is truncated,
   * return everything from the first opening brace onward so a repair pass
   * can close it.
   */
  private extractFirstJsonObject(content: string): string | null {
    const start = content.indexOf('{');
    if (start < 0) {
      return null;
    }

    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (let index = start; index < content.length; index++) {
      const char = content[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
        stack.pop();

        if (stack.length === 0) {
          return content.slice(start, index + 1);
        }
      }
    }

    return content.slice(start);
  }

  /**
   * Repair common truncation issues like missing closing braces, dangling
   * strings, and trailing commas before container endings.
   */
  private repairTruncatedJson(content: string): string {
    let repaired = this.extractFirstJsonObject(content) ?? content;
    repaired = this.normalizeJsonCandidate(repaired) ?? '';
    repaired = this.stripTrailingCommas(repaired);

    let inString = false;
    let escaped = false;
    const closers: string[] = [];
    let output = '';

    for (const char of repaired) {
      output += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        closers.push('}');
      } else if (char === '[') {
        closers.push(']');
      } else if ((char === '}' || char === ']') && closers[closers.length - 1] === char) {
        closers.pop();
      }
    }

    if (inString) {
      output += '"';
    }

    if (closers.length > 0) {
      output += closers.reverse().join('');
    }

    return this.stripTrailingCommas(output);
  }

  /**
   * Remove trailing commas before a closing brace or bracket.
   */
  private stripTrailingCommas(content: string): string {
    return content.replace(/,\s*([}\]])/g, '$1');
  }

  /**
   * Parse a JSON array into a string array, dropping any non-string entries.
   */
  private parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }

  /**
   * Validate action type
   */
  private validateAction(action: unknown): PlanAction {
    const validActions: PlanAction[] = [
      'create_file',
      'modify_file',
      'delete_file',
      'rename_file',
      'search_code',
      'read_file',
    ];

    if (typeof action === 'string' && validActions.includes(action as PlanAction)) {
      return action as PlanAction;
    }

    return 'modify_file'; // Default
  }

  /**
   * Validate plan constraints
   */
  private validatePlan(plan: CodePlan): void {
    // Check max steps
    if (plan.steps.length > 10) {
      console.warn('Plan has more than 10 steps, truncating');
      plan.steps = plan.steps.slice(0, 10);
    }

    // Check max files
    const totalFiles = plan.affectedFiles.length + plan.newFiles.length;
    if (totalFiles > AGENT_DEFAULTS.maxFilesModified) {
      console.warn(`Plan modifies ${totalFiles} files, exceeds limit of ${AGENT_DEFAULTS.maxFilesModified}`);
      plan.confidence = Math.min(plan.confidence, 0.5);
    }

    // Validate step dependencies
    for (const step of plan.steps) {
      if (step.dependencies) {
        step.dependencies = step.dependencies.filter(
          dep => dep > 0 && dep <= plan.steps.length && dep !== step.step
        );
      }
    }
  }

  /**
   * Format file tree for prompt
   */
  private formatFileTree(
    nodes: Array<{ name: string; path: string; type: string; children?: unknown[] }>,
    indent: string = ''
  ): string {
    let result = '';
    for (const node of nodes.slice(0, 20)) {
      result += `${indent}${node.type === 'directory' ? '📁' : '📄'} ${node.name}\n`;
      if (node.children && indent.length < 8) {
        result += this.formatFileTree(
          node.children as Array<{ name: string; path: string; type: string; children?: unknown[] }>,
          indent + '  '
        );
      }
    }
    return result;
  }

  /**
   * Generate plan ID
   */
  private generatePlanId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultGenerator: PlanGenerator | null = null;

/**
 * Get default plan generator
 */
export function getPlanGenerator(): PlanGenerator {
  if (!defaultGenerator) {
    defaultGenerator = new PlanGenerator();
  }
  return defaultGenerator;
}

/**
 * Create plan generator with options
 */
export function createPlanGenerator(options?: {
  provider?: LLMProvider;
  maxIterations?: number;
}): PlanGenerator {
  return new PlanGenerator(options);
}

/**
 * Generate plan helper
 */
export async function generatePlan(
  prompt: string,
  context: ProjectContext,
  searchResults?: SearchResult[]
): Promise<CodePlan> {
  const generator = getPlanGenerator();
  return generator.generate(prompt, context, searchResults);
}
