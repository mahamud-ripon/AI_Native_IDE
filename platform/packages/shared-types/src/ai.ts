export interface AiConversation {
  id: string;
  projectId: string;
  userId: string;
  messages: AiMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
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
  status: 'running' | 'success' | 'error' | 'timeout' | 'killed';
  output?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface AiFeedback {
  id: string;
  conversationId: string;
  messageId: string;
  rating: 'helpful' | 'not_helpful';
  feedback?: string;
}
