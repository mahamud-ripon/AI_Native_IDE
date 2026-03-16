/**
 * AI Orchestrator - Multi-Agent System
 * 
 * This is the core differentiator: instead of just generating code,
 * we spawn a TEAM of specialized AI agents that work together
 * following enterprise-grade software development processes.
 * 
 * Flow:
 * 1. User prompt → PM Agent (requirements)
 * 2. Requirements → Architect Agent (system design)
 * 3. Design → Backend + Frontend Agents (parallel)
 * 4. Code → DevOps Agent (Docker, CI/CD)
 * 5. Code → QA Agent (tests)
 * 6. Code → Security Agent (OWASP scan)
 * 7. All artifacts → Applied to project
 */

import { groqClient } from './groqClient';
import { editorContextService } from './editorContextService';
import { editorManager } from '../core/editor/editorManager';
import { editorModelManager } from '../core/editor/modelManager';

// ========================================
// TYPES
// ========================================

export type AgentName = 
  | 'pm' 
  | 'architect' 
  | 'backend' 
  | 'frontend' 
  | 'devops' 
  | 'qa' 
  | 'security';

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentResult {
  agent: AgentName;
  status: AgentStatus;
  output: string;
  files?: GeneratedFile[];
  metadata?: Record<string, any>;
  duration?: number;
  error?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
  description?: string;
}

export interface OrchestratorState {
  sessionId: string;
  prompt: string;
  status: 'planning' | 'executing' | 'completed' | 'failed';
  currentAgent: AgentName | null;
  agents: Record<AgentName, AgentResult>;
  files: GeneratedFile[];
  startedAt: number;
  completedAt?: number;
}

export interface OrchestratorOptions {
  projectId: string;
  workspaceId: string;
  prompt: string;
  onProgress?: (state: OrchestratorState) => void;
  onAgentComplete?: (agent: AgentName, result: AgentResult) => void;
}

// ========================================
// AGENT PROMPTS
// ========================================

const AGENT_PROMPTS: Record<AgentName, string> = {
  pm: `You are a Product Manager AI agent. Your job is to analyze user requests and create detailed requirements documents.

Given a user prompt, output a structured requirements document in this format:

## Requirements Analysis

### Functional Requirements
- [List each functional requirement]

### Non-Functional Requirements
- [Performance, scalability, security requirements]

### User Stories
- As a [user], I want to [action] so that [benefit]

### Acceptance Criteria
- [List acceptance criteria]

### Technical Constraints
- [Any technical constraints]

Be thorough but concise. Focus on WHAT needs to be built, not HOW.`,

  architect: `You are a Solutions Architect AI agent. Your job is to design the system architecture based on requirements.

Output a system design document in this format:

## System Architecture

### Overview
[Brief architecture overview]

### Tech Stack
- Frontend: [technology]
- Backend: [technology]
- Database: [technology]
- Infrastructure: [technology]

### Components
[List system components and their responsibilities]

### Data Models
[Key data models/entities]

### API Endpoints
[List main API endpoints]

### File Structure
// FILE: path/to/file.ext
\`\`\`language
// code
\`\`\`

Generate the actual file structure with code scaffolding.`,

  backend: `You are a Backend Engineer AI agent. Your job is to implement backend code.

Generate backend files in this format:

// FILE: path/to/file.ext
\`\`\`language
// complete implementation
\`\`\`

Focus on:
- API routes/handlers
- Database models
- Business logic
- Error handling
- Security best practices

Write COMPLETE, WORKING code - not snippets.`,

  frontend: `You are a Frontend Engineer AI agent. Your job is to implement UI components.

Generate frontend files in this format:

// FILE: path/to/file.ext
\`\`\`language
// complete implementation
\`\`\`

Focus on:
- React components
- State management
- API integration
- Responsive design
- Accessibility

Write COMPLETE, WORKING code - not snippets.`,

  devops: `You are a DevOps Engineer AI agent. Your job is to create deployment configurations.

Generate DevOps files in this format:

// FILE: path/to/file.ext
\`\`\`language
// configuration
\`\`\`

Create:
- Dockerfile
- docker-compose.yml
- CI/CD pipeline config
- Environment configs

Make it production-ready.`,

  qa: `You are a QA Engineer AI agent. Your job is to write comprehensive tests.

Generate test files in this format:

// FILE: path/to/file.ext
\`\`\`language
// test implementation
\`\`\`

Write:
- Unit tests
- Integration tests
- E2E tests
- Test utilities

Use appropriate testing frameworks for the language.`,

  security: `You are a Security Engineer AI agent. Your job is to review code for vulnerabilities.

Analyze the code and output:

## Security Audit Report

### Vulnerabilities Found
- [List each vulnerability with severity]

### Recommendations
- [Security improvements]

### Secure Code Fixes
// FILE: path/to/file.ext
\`\`\`language
// fixed code
\`\`\`

Focus on OWASP Top 10:
- Injection
- Broken auth
- Sensitive data exposure
- XXE
- Broken access control
- Security misconfiguration
- XSS
- Insecure deserialization
- Using components with vulnerabilities
- Insufficient logging`
};

// ========================================
// AGENT EXECUTION ORDER (DAG)
// ========================================

const AGENT_ORDER: AgentName[] = [
  'pm',        // 1. Requirements
  'architect', // 2. System design
  'backend',   // 3. Backend code (parallel with frontend)
  'frontend',  // 4. Frontend code (parallel with backend)
  'devops',    // 5. Deployment configs
  'qa',        // 6. Tests
  'security'   // 7. Security audit
];

// ========================================
// ORCHESTRATOR CLASS
// ========================================

class AIOrchestrator {
  private sessions = new Map<string, OrchestratorState>();

  /**
   * Start a multi-agent coding session
   */
  async startSession(options: OrchestratorOptions): Promise<OrchestratorState> {
    const sessionId = `session-${Date.now()}`;
    
    const state: OrchestratorState = {
      sessionId,
      prompt: options.prompt,
      status: 'planning',
      currentAgent: null,
      agents: {
        pm: { agent: 'pm', status: 'pending', output: '' },
        architect: { agent: 'architect', status: 'pending', output: '' },
        backend: { agent: 'backend', status: 'pending', output: '' },
        frontend: { agent: 'frontend', status: 'pending', output: '' },
        devops: { agent: 'devops', status: 'pending', output: '' },
        qa: { agent: 'qa', status: 'pending', output: '' },
        security: { agent: 'security', status: 'pending', output: '' }
      },
      files: [],
      startedAt: Date.now()
    };

    this.sessions.set(sessionId, state);

    // Execute agents in sequence
    try {
      state.status = 'executing';
      options.onProgress?.(state);

      // 1. PM Agent - Requirements
      await this.runAgent('pm', state, options);
      
      // 2. Architect Agent - System Design
      await this.runAgent('architect', state, options);
      
      // 3. Backend & Frontend Agents (can be parallel conceptually)
      await this.runAgent('backend', state, options);
      await this.runAgent('frontend', state, options);
      
      // 4. DevOps Agent
      await this.runAgent('devops', state, options);
      
      // 5. QA Agent
      await this.runAgent('qa', state, options);
      
      // 6. Security Agent
      await this.runAgent('security', state, options);

      // Apply all generated files
      await this.applyFiles(state, options);

      state.status = 'completed';
      state.completedAt = Date.now();
      options.onProgress?.(state);

    } catch (error) {
      state.status = 'failed';
      state.completedAt = Date.now();
      options.onProgress?.(state);
      throw error;
    }

    return state;
  }

  /**
   * Run a single agent
   */
  private async runAgent(
    agent: AgentName, 
    state: OrchestratorState,
    options: OrchestratorOptions
  ): Promise<void> {
    const startTime = Date.now();
    state.currentAgent = agent;
    state.agents[agent].status = 'running';
    options.onProgress?.(state);

    try {
      // Build context from previous agents
      const context = this.buildAgentContext(agent, state);
      
      // Call AI
      const systemPrompt = AGENT_PROMPTS[agent];
      const userPrompt = this.buildUserPrompt(agent, state, context);
      
      const output = await groqClient.complete(
        userPrompt,
        systemPrompt
      );

      // Parse files from output
      const files = this.parseFilesFromOutput(output);

      state.agents[agent] = {
        agent,
        status: 'completed',
        output,
        files,
        duration: Date.now() - startTime
      };

      // Add files to state
      state.files.push(...files);

      options.onAgentComplete?.(agent, state.agents[agent]);
      options.onProgress?.(state);

    } catch (error) {
      state.agents[agent] = {
        agent,
        status: 'failed',
        output: '',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      };
      options.onProgress?.(state);
      throw error;
    }
  }

  /**
   * Build context from previous agent outputs
   */
  private buildAgentContext(agent: AgentName, state: OrchestratorState): string {
    const context: string[] = [];
    
    // Add previous agent outputs based on dependency
    const agentIndex = AGENT_ORDER.indexOf(agent);
    
    for (let i = 0; i < agentIndex; i++) {
      const prevAgent = AGENT_ORDER[i];
      const result = state.agents[prevAgent];
      
      if (result.status === 'completed' && result.output) {
        context.push(`\n## ${prevAgent.toUpperCase()} Agent Output:\n${result.output}`);
      }
    }

    return context.join('\n');
  }

  /**
   * Build user prompt for agent
   */
  private buildUserPrompt(
    agent: AgentName, 
    state: OrchestratorState,
    context: string
  ): string {
    let prompt = `## User Request\n${state.prompt}\n`;

    if (context) {
      prompt += `\n## Context from Previous Agents\n${context}\n`;
    }

    // Add IDE context
    const editorContext = editorContextService.getContext();
    if (editorContext.filePath && editorContext.code) {
      prompt += `\n## Current File: ${editorContext.filePath}\n\`\`\`${editorContext.language ?? ''}\n${editorContext.code}\n\`\`\`\n`;
    }

    prompt += `\n## Your Task\nExecute your role as the ${agent.toUpperCase()} agent. Generate all necessary outputs.`;

    return prompt;
  }

  /**
   * Parse generated files from agent output
   */
  private parseFilesFromOutput(output: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    
    // Match: // FILE: path followed by code block
    const regex = /\/\/\s*FILE:\s*(.+?)\n```(\w*)\n([\s\S]*?)\n```/g;
    
    let match;
    while ((match = regex.exec(output)) !== null) {
      const path = match[1].trim();
      const language = match[2] || 'typescript';
      const content = match[3].trim();

      if (content.length > 10) {
        files.push({ path, content, language });
      }
    }

    // Also try markdown code blocks without FILE comment
    const mdRegex = /```(\w+)\n([\s\S]*?)\n```/g;
    let fileIndex = files.length;
    
    while ((match = mdRegex.exec(output)) !== null) {
      const language = match[1];
      const content = match[2].trim();

      // Skip if already captured or too short
      if (content.length < 20) continue;
      if (files.some(f => f.content === content)) continue;

      // Infer path
      let path = `src/file${fileIndex > 0 ? fileIndex : ''}.${language === 'typescript' ? 'ts' : language}`;
      
      files.push({ path, content, language });
      fileIndex++;
    }

    return files;
  }

  /**
   * Apply all generated files to the editor
   */
  private async applyFiles(
    state: OrchestratorState,
    options: OrchestratorOptions
  ): Promise<void> {
    for (const file of state.files) {
      try {
        let model = editorManager.getModel(options.projectId, file.path);
        
        if (!model) {
          // Create new file
          const fileModel = editorModelManager.getOrCreate(
            (window as any).monaco,
            options.projectId,
            file.path
          );
          model = fileModel.model;
        }

        model.setValue(file.content);
        console.log(`[AIOrchestrator] Applied: ${file.path}`);
        
      } catch (error) {
        console.error(`[AIOrchestrator] Failed to apply ${file.path}:`, error);
      }
    }
  }

  /**
   * Get session state
   */
  getSession(sessionId: string): OrchestratorState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): OrchestratorState[] {
    return Array.from(this.sessions.values());
  }
}

// ========================================
// SINGLETON
// ========================================

export const aiOrchestrator = new AIOrchestrator();
export default aiOrchestrator;
