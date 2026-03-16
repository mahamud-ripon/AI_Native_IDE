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
      maxTokens: 2000,
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
        maxTokens: 2000,
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
Return a JSON object with this structure:
\`\`\`json
{
  "goal": "Clear description of what needs to be accomplished",
  "steps": [
    {
      "step": 1,
      "action": "create_file|modify_file|delete_file|rename_file",
      "file": "path/to/file.ts",
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
\`\`\`

## Rules
1. Each step must have a clear, actionable description
2. Files must use relative paths from project root
3. Dependencies reference step numbers
4. Confidence reflects your certainty (0.0-1.0)
5. Keep plans focused - max 10 steps
6. Prefer modify_file over create_file when possible
7. Order steps by dependency (independent first)`;
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
      // Extract JSON from response
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonContent = jsonMatch ? jsonMatch[1] : content;

      const parsed = JSON.parse(jsonContent.trim());

      // Validate required fields
      if (!parsed.goal || !Array.isArray(parsed.steps)) {
        throw new Error('Missing required fields: goal, steps');
      }

      // Build plan object
      const plan: CodePlan = {
        id: this.generatePlanId(),
        goal: parsed.goal,
        steps: parsed.steps.map((s: Partial<PlanStep>, index: number) => ({
          step: s.step ?? index + 1,
          action: this.validateAction(s.action),
          file: s.file,
          description: s.description ?? '',
          dependencies: s.dependencies ?? [],
          estimatedComplexity: s.estimatedComplexity ?? 'medium',
        })),
        affectedFiles: parsed.affectedFiles ?? [],
        newFiles: parsed.newFiles ?? [],
        deletedFiles: parsed.deletedFiles ?? [],
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
        reasoning: parsed.reasoning ?? '',
        createdAt: new Date(),
      };

      return plan;
    } catch (error) {
      // Return a minimal plan if parsing fails
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
