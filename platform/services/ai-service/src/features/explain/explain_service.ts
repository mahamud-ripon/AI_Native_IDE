/**
 * Explain Service
 * 
 * AI-powered code explanation and documentation.
 */

import * as crypto from 'crypto';
import {
  ExplainRequest,
  ExplainResult,
  Explanation,
  ExplainSection,
  ExplainMetrics,
  ExplainConfig,
  ExplanationDepth,
  ExplanationFormat,
  CodeReference,
  CodeFlowStep,
  DependencyInfo,
  ArchitectureInfo,
  SecurityInfo,
  PerformanceInfo,
  RelatedCode,
  EXPLAIN_DEFAULTS,
  DEPTH_DESCRIPTIONS,
  AUDIENCE_PROMPTS,
} from './explain_types.js';
import { WorkspaceFS } from '../../coding/workspace/workspace_fs.js';
import { LLMProvider, LLMMessage } from '../../coding/agent/agent_types.js';
import { getLLMProvider } from '../../coding/agent/plan_generator.js';
import { getCodeIndex } from '../../coding/retrieval/code_index.js';
import { getContextBuilder } from '../../coding/context/project_context_builder.js';
import { getTracer } from '../../observability/agent_tracing.js';
import { recordTokenUsage } from '../../observability/token_usage.js';

/**
 * Explain Service
 */
export class ExplainService {
  private config: Required<ExplainConfig>;
  private provider: LLMProvider | null = null;

  constructor(config?: Partial<ExplainConfig>) {
    this.config = { ...EXPLAIN_DEFAULTS, ...config } as Required<ExplainConfig>;
    this.provider = getLLMProvider();
  }

  /**
   * Set LLM provider
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * Explain code
   */
  async explain(
    request: ExplainRequest,
    workspace?: WorkspaceFS
  ): Promise<ExplainResult> {
    const startTime = Date.now();
    const tracer = getTracer();

    const traceId = tracer.startAgentTrace({
      agentId: 'explain-service',
      workspaceId: request.workspaceId,
      userId: request.userId,
      prompt: `Explain: ${request.target.type}`,
    });

    let tokensUsed = 0;
    let contextTokens = 0;
    let relatedFilesFound = 0;

    try {
      // Get target content
      let targetContent = request.target.content;
      if (!targetContent && request.target.path && workspace) {
        targetContent = await workspace.readFile(request.target.path);
      }

      if (!targetContent && request.target.selection) {
        targetContent = request.target.selection.content;
      }

      if (!targetContent) {
        throw new Error('No content available for explanation');
      }

      // Find related code
      const relatedCode = await this.findRelatedCode(
        targetContent,
        request.target.path,
        workspace
      );
      relatedFilesFound = relatedCode.length;

      // Build context
      const context = await this.buildContext(request, workspace);
      contextTokens = context.length / 4; // Rough estimate

      // Generate explanation
      if (!this.provider) {
        throw new Error('LLM provider not configured');
      }

      const messages = this.buildExplainPrompt(request, targetContent, relatedCode, context);
      const response = await this.provider.complete(messages, {
        temperature: 0.3,
        maxTokens: 3000,
      });

      tokensUsed = response.usage?.totalTokens ?? 0;

      // Parse explanation
      const explanation = this.parseExplanation(
        response.content,
        request.options?.format ?? this.config.defaultFormat
      );

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

      const metrics: ExplainMetrics = {
        tokensUsed,
        latencyMs: Date.now() - startTime,
        contextTokens,
        relatedFilesFound,
      };

      return {
        id: this.generateId(),
        requestId: request.id,
        success: true,
        explanation,
        relatedCode,
        suggestions: this.extractSuggestions(response.content),
        metrics,
      };
    } catch (error) {
      tracer.endAgentTrace(traceId, false, error instanceof Error ? error.message : 'Unknown error');

      return {
        id: this.generateId(),
        requestId: request.id,
        success: false,
        explanation: {
          summary: '',
          overview: '',
          sections: [],
        },
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          tokensUsed,
          latencyMs: Date.now() - startTime,
          contextTokens,
          relatedFilesFound,
        },
      };
    }
  }

  /**
   * Find related code
   */
  private async findRelatedCode(
    content: string,
    targetPath?: string,
    workspace?: WorkspaceFS
  ): Promise<RelatedCode[]> {
    const related: RelatedCode[] = [];

    if (!workspace) return related;

    try {
      const codeIndex = getCodeIndex();

      // Extract key terms from content
      const terms = this.extractKeyTerms(content);

      for (const term of terms.slice(0, 3)) {
        const results = await codeIndex.search(term, {
          mode: 'hybrid',
          maxResults: 3,
          minScore: 0.6,
        });

        for (const result of results) {
          if (result.chunk.path !== targetPath) {
            related.push({
              path: result.chunk.path,
              relation: 'similar',
              relevance: result.score,
              content: result.chunk.content.slice(0, 200),
            });
          }
        }
      }
    } catch {
      // Search failed
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    return related
      .filter(r => {
        if (seen.has(r.path)) return false;
        seen.add(r.path);
        return true;
      })
      .slice(0, this.config.maxRelatedFiles);
  }

  /**
   * Extract key terms from code
   */
  private extractKeyTerms(content: string): string[] {
    const terms: string[] = [];

    // Extract function/class names
    const funcMatch = content.match(/(?:function|class|const|let)\s+(\w+)/g);
    if (funcMatch) {
      terms.push(...funcMatch.map(m => m.split(/\s+/)[1] ?? ''));
    }

    // Extract imports
    const importMatch = content.match(/from\s+['"]([^'"]+)['"]/g);
    if (importMatch) {
      terms.push(...importMatch.map(m => m.replace(/from\s+['"]|['"]/g, '')));
    }

    return [...new Set(terms)].filter(t => t.length > 2);
  }

  /**
   * Build context string
   */
  private async buildContext(
    request: ExplainRequest,
    workspace?: WorkspaceFS
  ): Promise<string> {
    if (!workspace) return '';

    const parts: string[] = [];

    // Get project context
    if (request.options?.includeArchitecture ?? this.config.includeArchitectureByDefault) {
      try {
        const builder = getContextBuilder();
        const result = await builder.buildContext(workspace, {
          userPrompt: 'explain code context',
          maxTokens: this.config.contextMaxTokens,
        });

        if (result.success && result.context) {
          const ctx = result.context;
          if (ctx.language) parts.push(`Language: ${ctx.language}`);
          if (ctx.framework?.name) parts.push(`Framework: ${ctx.framework.name}`);
          if (ctx.projectType) parts.push(`Type: ${ctx.projectType}`);
        }
      } catch {
        // Context building failed
      }
    }

    return parts.join('\n');
  }

  /**
   * Build explain prompt
   */
  private buildExplainPrompt(
    request: ExplainRequest,
    content: string,
    relatedCode: RelatedCode[],
    context: string
  ): LLMMessage[] {
    const depth = request.options?.depth ?? this.config.defaultDepth;
    const format = request.options?.format ?? this.config.defaultFormat;
    const audience = request.options?.targetAudience ?? 'developer';

    const depthDesc = DEPTH_DESCRIPTIONS[depth];
    const audienceDesc = AUDIENCE_PROMPTS[audience];

    const systemPrompt = `You are an expert code explainer. ${depthDesc}

${audienceDesc}

## Output Format
${format === 'markdown' ? 'Use markdown formatting with headers, code blocks, and lists.' : format === 'structured' ? 'Use a structured format with clear sections.' : 'Use plain text with clear paragraphs.'}

## Sections to Include
1. **Summary** - A brief overview
2. **Overview** - What the code does and why
3. **Key Components** - Main functions, classes, or modules
${request.options?.includeDependencies ? '4. **Dependencies** - External and internal dependencies' : ''}
${request.options?.includeArchitecture ? '5. **Architecture** - Design patterns and structure' : ''}
${request.options?.includeSecurity ? '6. **Security** - Potential security considerations' : ''}
${request.options?.includePerformance ? '7. **Performance** - Complexity and optimization notes' : ''}`;

    const userPrompt = `## Code to Explain
File: ${request.target.path ?? 'unknown'}
Type: ${request.target.type}
Language: ${request.target.language}

\`\`\`${request.target.language}
${content.slice(0, 3000)}
\`\`\`

${context ? `## Project Context\n${context}\n` : ''}
${relatedCode.length > 0 ? `## Related Files\n${relatedCode.map(r => `- ${r.path} (${r.relation})`).join('\n')}\n` : ''}
Please explain this code.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Parse explanation from LLM response
   */
  private parseExplanation(
    content: string,
    format: ExplanationFormat
  ): Explanation {
    const sections: ExplainSection[] = [];

    // Extract sections based on headers
    const headerRegex = /^#+\s+(.+)$/gm;
    const matches = [...content.matchAll(headerRegex)];

    for (let i = 0; i < matches.length; i++) {
      const title = matches[i][1];
      const start = matches[i].index! + matches[i][0].length;
      const end = matches[i + 1]?.index ?? content.length;
      const sectionContent = content.slice(start, end).trim();

      sections.push({
        title,
        content: sectionContent,
      });
    }

    // Extract summary (first paragraph or first section)
    const summaryMatch = content.match(/^(?:Summary|Overview)[:\s]*\n*(.+?)(?:\n\n|$)/i);
    const summary = summaryMatch ? summaryMatch[1] : sections[0]?.content.slice(0, 200) ?? '';

    return {
      summary,
      overview: sections.find(s => s.title.toLowerCase().includes('overview'))?.content ?? '',
      sections,
    };
  }

  /**
   * Extract suggestions from response
   */
  private extractSuggestions(content: string): string[] {
    const suggestions: string[] = [];

    // Look for suggestion patterns
    const patterns = [
      /(?:suggestion|recommend|consider|should|could)[:\s]+(.+?)(?:\n|$)/gi,
      /(?:improve|optimize|refactor)[:\s]+(.+?)(?:\n|$)/gi,
    ];

    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 10) {
          suggestions.push(match[1].trim());
        }
      }
    }

    return [...new Set(suggestions)].slice(0, 5);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`explain-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultService: ExplainService | null = null;

/**
 * Get default explain service
 */
export function getExplainService(): ExplainService {
  if (!defaultService) {
    defaultService = new ExplainService();
  }
  return defaultService;
}

/**
 * Create explain service
 */
export function createExplainService(config?: Partial<ExplainConfig>): ExplainService {
  return new ExplainService(config);
}

/**
 * Explain code helper
 */
export async function explainCode(
  request: ExplainRequest,
  workspace?: WorkspaceFS
): Promise<ExplainResult> {
  return getExplainService().explain(request, workspace);
}
