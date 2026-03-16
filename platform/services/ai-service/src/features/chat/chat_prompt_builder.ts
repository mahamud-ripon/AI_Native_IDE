/**
 * Chat Prompt Builder
 * 
 * Builds structured prompts for the AI coding chat feature.
 * Combines user messages with workspace context and conversation history.
 */

import * as crypto from 'crypto';
import {
  ChatMessage,
  ChatRequest,
  ConversationContext,
  ContextChunk,
  SelectedCode,
  SYSTEM_PROMPTS,
} from './chat_types.js';
import { ProjectContext } from '../../coding/context/context_types.js';
import { SearchResult } from '../../coding/retrieval/retrieval_types.js';

// Built prompt
export interface BuiltPrompt {
  id: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  contextIncluded: boolean;
  contextTokens: number;
  totalTokens: number;
}

/**
 * Chat Prompt Builder
 */
export class ChatPromptBuilder {
  private maxContextTokens: number;
  private maxHistoryMessages: number;

  constructor(options?: { maxContextTokens?: number; maxHistoryMessages?: number }) {
    this.maxContextTokens = options?.maxContextTokens ?? 20000;
    this.maxHistoryMessages = options?.maxHistoryMessages ?? 50;
  }

  /**
   * Build prompt for chat request
   */
  buildPrompt(
    request: ChatRequest,
    history: ChatMessage[],
    projectContext?: ProjectContext,
    searchResults?: SearchResult[]
  ): BuiltPrompt {
    const id = this.generateId();

    // Determine system prompt based on context
    const systemPrompt = this.selectSystemPrompt(request.message, request.context);

    // Build context section
    const contextSection = this.buildContextSection(
      request.context,
      projectContext,
      searchResults
    );

    // Build history section
    const historyMessages = this.buildHistoryMessages(history);

    // Combine into messages array
    const messages: Array<{ role: string; content: string }> = [];

    // Add system prompt
    messages.push({ role: 'system', content: systemPrompt });

    // Add context if present
    if (contextSection) {
      messages.push({ role: 'system', content: contextSection });
    }

    // Add history
    messages.push(...historyMessages);

    // Add current user message
    messages.push({ role: 'user', content: this.buildUserMessage(request) });

    // Estimate tokens
    const contextTokens = contextSection ? this.estimateTokens(contextSection) : 0;
    const totalTokens = messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);

    return {
      id,
      systemPrompt,
      messages,
      contextIncluded: !!contextSection,
      contextTokens,
      totalTokens,
    };
  }

  /**
   * Build prompt for inline edit
   */
  buildInlineEditPrompt(
    selection: SelectedCode,
    instruction: string,
    projectContext?: ProjectContext
  ): BuiltPrompt {
    const id = this.generateId();

    const systemPrompt = SYSTEM_PROMPTS.codeEdit;

    const contextSection = projectContext
      ? this.buildProjectContextSection(projectContext)
      : '';

    const userMessage = `## Selected Code
File: ${selection.path} (${selection.startLine}-${selection.endLine})
Language: ${selection.language}

\`\`\`${selection.language}
${selection.content}
\`\`\`

## Instruction
${instruction}

Please modify the selected code according to the instruction. Generate a unified diff patch.`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (contextSection) {
      messages.push({ role: 'system', content: contextSection });
    }

    messages.push({ role: 'user', content: userMessage });

    return {
      id,
      systemPrompt,
      messages,
      contextIncluded: !!contextSection,
      contextTokens: contextSection ? this.estimateTokens(contextSection) : 0,
      totalTokens: messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0),
    };
  }

  /**
   * Build prompt for code explanation
   */
  buildExplainPrompt(
    code: SelectedCode | string,
    question: string,
    projectContext?: ProjectContext
  ): BuiltPrompt {
    const id = this.generateId();

    const systemPrompt = SYSTEM_PROMPTS.explain;

    const contextSection = projectContext
      ? this.buildProjectContextSection(projectContext)
      : '';

    const codeSection = typeof code === 'string'
      ? code
      : `File: ${code.path}\n\`\`\`${code.language}\n${code.content}\n\`\`\``;

    const userMessage = `## Code
${codeSection}

## Question
${question}`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (contextSection) {
      messages.push({ role: 'system', content: contextSection });
    }

    messages.push({ role: 'user', content: userMessage });

    return {
      id,
      systemPrompt,
      messages,
      contextIncluded: !!contextSection,
      contextTokens: contextSection ? this.estimateTokens(contextSection) : 0,
      totalTokens: messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0),
    };
  }

  /**
   * Select appropriate system prompt
   */
  private selectSystemPrompt(message: string, context?: ConversationContext): string {
    const lowerMessage = message.toLowerCase();

    // Detect intent from message
    if (lowerMessage.includes('explain') || lowerMessage.includes('what does') || lowerMessage.includes('how does')) {
      return SYSTEM_PROMPTS.explain;
    }

    if (lowerMessage.includes('refactor') || lowerMessage.includes('rename') || lowerMessage.includes('extract')) {
      return SYSTEM_PROMPTS.refactor;
    }

    if (lowerMessage.includes('edit') || lowerMessage.includes('modify') || lowerMessage.includes('change') || lowerMessage.includes('add') || lowerMessage.includes('remove')) {
      return SYSTEM_PROMPTS.codeEdit;
    }

    return SYSTEM_PROMPTS.default;
  }

  /**
   * Build context section
   */
  private buildContextSection(
    context?: ConversationContext,
    projectContext?: ProjectContext,
    searchResults?: SearchResult[]
  ): string {
    const sections: string[] = [];

    // Add project context
    if (projectContext) {
      const projectSection = this.buildProjectContextSection(projectContext);
      if (projectSection) {
        sections.push(projectSection);
      }
    }

    // Add active files
    if (context?.activeFiles && context.activeFiles.length > 0) {
      sections.push(`## Active Files\n${context.activeFiles.map(f => `- ${f}`).join('\n')}`);
    }

    // Add selected code
    if (context?.selectedCode) {
      sections.push(`## Selected Code
File: ${context.selectedCode.path}
Lines: ${context.selectedCode.startLine}-${context.selectedCode.endLine}

\`\`\`${context.selectedCode.language}
${context.selectedCode.content}
\`\`\``);
    }

    // Add relevant chunks
    if (context?.relevantChunks && context.relevantChunks.length > 0) {
      const chunksSection = this.buildChunksSection(context.relevantChunks);
      sections.push(chunksSection);
    }

    // Add search results
    if (searchResults && searchResults.length > 0) {
      const searchSection = this.buildSearchResultsSection(searchResults);
      sections.push(searchSection);
    }

    if (sections.length === 0) {
      return '';
    }

    return `# Context\n\n${sections.join('\n\n')}`;
  }

  /**
   * Build project context section
   */
  private buildProjectContextSection(context: ProjectContext): string {
    const parts: string[] = [];

    if (context.language) {
      parts.push(`Language: ${context.language}`);
    }

    if (context.framework?.name) {
      parts.push(`Framework: ${context.framework.name}`);
    }

    if (context.projectType) {
      parts.push(`Project Type: ${context.projectType}`);
    }

    if (context.dependencies && context.dependencies.length > 0) {
      parts.push(`Key Dependencies: ${context.dependencies.slice(0, 10).join(', ')}`);
    }

    if (context.fileTree && context.fileTree.length > 0) {
      const treeStr = this.formatFileTree(context.fileTree.slice(0, 20));
      parts.push(`Structure:\n\`\`\`\n${treeStr}\n\`\`\``);
    }

    if (parts.length === 0) {
      return '';
    }

    return `## Project\n${parts.join('\n')}`;
  }

  /**
   * Build chunks section
   */
  private buildChunksSection(chunks: ContextChunk[]): string {
    const chunkStrs = chunks.slice(0, 5).map(chunk =>
      `### ${chunk.path}:${chunk.startLine}-${chunk.endLine}
Relevance: ${chunk.reason}
\`\`\`
${chunk.content.slice(0, 500)}
\`\`\``
    );

    return `## Relevant Code\n\n${chunkStrs.join('\n\n')}`;
  }

  /**
   * Build search results section
   */
  private buildSearchResultsSection(results: SearchResult[]): string {
    const resultStrs = results.slice(0, 5).map(result =>
      `### ${result.chunk.path}:${result.chunk.startLine}
Name: ${result.chunk.name}
Score: ${result.score.toFixed(2)}
\`\`\`
${result.chunk.content.slice(0, 500)}
\`\`\``
    );

    return `## Search Results\n\n${resultStrs.join('\n\n')}`;
  }

  /**
   * Build history messages
   */
  private buildHistoryMessages(history: ChatMessage[]): Array<{ role: string; content: string }> {
    // Take last N messages
    const recentHistory = history.slice(-this.maxHistoryMessages);

    return recentHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Build user message with context
   */
  private buildUserMessage(request: ChatRequest): string {
    let message = request.message;

    // Add context hint if files are active
    if (request.context?.activeFiles && request.context.activeFiles.length > 0) {
      const filesHint = `\n\n[Context: ${request.context.activeFiles.length} files open]`;
      message += filesHint;
    }

    return message;
  }

  /**
   * Format file tree
   */
  private formatFileTree(
    nodes: Array<{ name: string; type: string; children?: unknown[] }>,
    indent: string = ''
  ): string {
    let result = '';
    for (const node of nodes) {
      result += `${indent}${node.type === 'directory' ? '📁' : '📄'} ${node.name}\n`;
      if (node.children && indent.length < 6) {
        result += this.formatFileTree(
          node.children as Array<{ name: string; type: string; children?: unknown[] }>,
          indent + '  '
        );
      }
    }
    return result;
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`prompt-${Date.now()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultBuilder: ChatPromptBuilder | null = null;

/**
 * Get default prompt builder
 */
export function getPromptBuilder(): ChatPromptBuilder {
  if (!defaultBuilder) {
    defaultBuilder = new ChatPromptBuilder();
  }
  return defaultBuilder;
}

/**
 * Create prompt builder
 */
export function createPromptBuilder(options?: {
  maxContextTokens?: number;
  maxHistoryMessages?: number;
}): ChatPromptBuilder {
  return new ChatPromptBuilder(options);
}

/**
 * Build prompt helper
 */
export function buildChatPrompt(
  request: ChatRequest,
  history: ChatMessage[],
  projectContext?: ProjectContext,
  searchResults?: SearchResult[]
): BuiltPrompt {
  return getPromptBuilder().buildPrompt(request, history, projectContext, searchResults);
}
