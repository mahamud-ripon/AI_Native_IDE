/**
 * AI-related types that match the Prisma schema.
 * These types represent the database models as-is.
 */

export interface AiConversation {
  id: string;
  projectId: string;
  userId: string;
  title: string | null;
  initialPrompt: string;
  agentPlan: Record<string, unknown> | null;
  status: 'queued' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalTokens: number;
  totalCostUsd: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  agentName: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: Record<string, unknown> | null;
  tokensUsed: number | null;
  createdAt: string;
}

export interface AgentExecution {
  id: string;
  projectId: string;
  agentType: 'pm' | 'architect' | 'backend' | 'frontend' | 'devops' | 'qa' | 'security';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface CodeExecution {
  id: string;
  projectId: string;
  userId: string;
  vmId: string | null;
  command: string;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  status: 'running' | 'success' | 'error' | 'timeout' | 'killed' | null;
  durationMs: number | null;
  memoryUsedMb: number | null;
  cpuUsedPct: string | null;
  createdAt: string;
}

export interface AiFeedback {
  id: string;
  messageId: string;
  userId: string;
  rating: number;
  userComment: string | null;
  agentName: string | null;
  createdAt: string;
}
