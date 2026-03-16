/**
 * AI Chat Panel
 *
 * Chat interface for interacting with AI coding agents.
 * Displays conversation history and allows sending instructions.
 *
 * Features:
 * - Chat history with user and AI messages
 * - Execution task progress display
 * - Code block rendering with syntax highlighting
 * - Quick action buttons
 * - Connection status indicator
 *
 * Architecture:
 *   User Input
 *       │
 *   AIChatPanel
 *       │
 *   executionStore → API → Backend
 *       │
 *   ExecutionStreamClient (events)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useExecutionStore, selectExecutionStatus } from '../../state/executionStore';
import { groqClient, AI_ASSISTANT_SYSTEM_PROMPT } from '../../services/groqClient';
import { editorContextService } from '../../services/editorContextService';
import { aiCodingController } from '../../core/ai/aiCodingController';
import { localCodingService, isCodingIntent } from '../../services/localCodingService';
import { aiOrchestrator, AgentName, OrchestratorState } from '../../services/aiOrchestrator';
import { aiServiceClient, WorkflowRun, WorkflowEvent } from '../../api/aiServiceClient';
import styles from './AIChatPanel.module.css';

// ========================================
// TYPES
// ========================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  taskId?: string;
  status?: 'pending' | 'streaming' | 'complete' | 'error';
  metadata?: {
    filesModified?: string[];
    patchesGenerated?: number;
    duration?: number;
    error?: string;
  };
}

interface AIChatPanelProps {
  projectId: string;
  workspaceId: string;
  onSendMessage?: (message: string) => Promise<void>;
  className?: string;
}

// ========================================
// COMPONENT
// ========================================

export function AIChatPanel({
  projectId,
  workspaceId,
  onSendMessage,
  className,
}: AIChatPanelProps) {
  // Load chat history from localStorage
  const loadChatHistory = (): ChatMessage[] => {
    try {
      const saved = localStorage.getItem(`chat_history_${projectId || 'default'}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load chat history:', e);
    }
    return [];
  };

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatHistory());
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const executionStatus = useExecutionStore(selectExecutionStatus);
  const activeTask = useExecutionStore((s) => s.getActiveTask?.());
  const connectionStatus = useExecutionStore((s) => s.connectionStatus);

  // Check if Groq is configured
  const isGroqConfigured = groqClient.isConfigured();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save chat history to localStorage whenever messages change
  useEffect(() => {
    try {
      localStorage.setItem(`chat_history_${projectId || 'default'}`, JSON.stringify(messages));
    } catch (e) {
      console.warn('Failed to save chat history:', e);
    }
  }, [messages, projectId]);

  // Add system message on mount (only if no history)
  useEffect(() => {
    const savedHistory = loadChatHistory();
    if (savedHistory.length === 0) {
      const systemMessage: ChatMessage = {
        id: 'system-welcome',
        role: 'system',
        content: 'AI coding assistant ready. Describe what you want to build or modify.',
        timestamp: Date.now(),
      };
      setMessages([systemMessage]);
    }
  }, []);

  // Handle execution status changes
  useEffect(() => {
    if (!activeTask) return;

    // Find existing message for this task
    const existingIndex = messages.findIndex(m => m.taskId === activeTask.id);

    if (executionStatus.status === 'running') {
      if (existingIndex === -1) {
        // Add new assistant message for running task
        const assistantMessage: ChatMessage = {
          id: `task-${activeTask.id}`,
          role: 'assistant',
          content: formatTaskProgress(activeTask),
          timestamp: Date.now(),
          taskId: activeTask.id,
          status: 'streaming',
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        // Update existing message
        setMessages(prev => prev.map((m, i) =>
          i === existingIndex
            ? { ...m, content: formatTaskProgress(activeTask), status: 'streaming' }
            : m
        ));
      }
    } else if (executionStatus.status === 'completed') {
      setMessages(prev => prev.map((m) =>
        m.taskId === activeTask.id
          ? {
              ...m,
              content: formatTaskComplete(activeTask),
              status: 'complete',
              metadata: {
                filesModified: activeTask.filesModified,
                patchesGenerated: activeTask.patchesGenerated,
                duration: activeTask.completedAt && activeTask.startedAt
                  ? activeTask.completedAt - activeTask.startedAt
                  : undefined,
              },
            }
          : m
      ));
    } else if (executionStatus.status === 'failed') {
      setMessages(prev => prev.map((m) =>
        m.taskId === activeTask.id
          ? {
              ...m,
              content: formatTaskError(activeTask),
              status: 'error',
              metadata: { error: activeTask.error?.message },
            }
          : m
      ));
    }
  }, [executionStatus, activeTask?.id]);

  // Subscribe to AI Coding Controller state changes
  useEffect(() => {
    const unsubscribe = aiCodingController.onStateChange((sessionId, state, prevState) => {
      const session = aiCodingController.getActiveSession();
      if (!session || session.id !== sessionId) return;

      // Map workflow states to user-friendly messages
      const stateMessages: Record<string, string> = {
        'ANALYZING_WORKSPACE': '🧠 **Analyzing workspace...**\n\nAI is examining the current project structure.',
        'GENERATING_PATCH': '⚡ **Generating code...**\n\nAI is creating patches based on your request.',
        'VALIDATING_PATCH': '✅ **Validating changes...**\n\nAI is checking that the generated code is safe to apply.',
        'APPLYING_PATCH': '📝 **Applying changes...**\n\nAI is writing the changes to your files.',
        'EXECUTING_CODE': '🚀 **Executing code...**\n\nAI is running any necessary commands.',
        'COMPLETED': '✅ **Task completed!**\n\nAll changes have been applied successfully.',
        'FAILED': '❌ **Task failed**\n\nThere was an error while processing your request.',
      };

      // Find existing progress message for this session
      const existingIndex = messages.findIndex(m => m.taskId === session.taskId && m.status === 'streaming');
      
      if (state === 'COMPLETED' || state === 'FAILED') {
        // Final state - will be handled by executionStatus useEffect
        return;
      }

      if (existingIndex !== -1) {
        // Update existing progress message
        setMessages(prev => prev.map((m, i) =>
          i === existingIndex
            ? { ...m, content: stateMessages[state] ?? m.content }
            : m
        ));
      }
    });

    return () => unsubscribe();
  }, [messages]);

  // Send message handler
  const handleSend = useCallback(async () => {
    if (!input.trim() || isSending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsSending(true);

    try {
      if (onSendMessage) {
        await onSendMessage(input.trim());
      } else {
        // Default: submit execution task via API
        await submitTask(input.trim());
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, onSendMessage]);

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Save API key
  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      groqClient.setApiKey(apiKeyInput.trim());
      setApiKeyInput('');
      setShowSettings(false);
      // Force re-render
      setMessages(prev => [...prev]);
    }
  };

  // Submit task - uses backend ai-service for multi-agent workflow
  const submitTask = async (instruction: string) => {
    // Check if this is a coding intent
    if (isCodingIntent(instruction)) {
      // Use BACKEND AI-SERVICE for multi-agent workflow
      const progressMessage: ChatMessage = {
        id: `workflow-${Date.now()}`,
        role: 'assistant',
        content: '🚀 **Starting AI Team Workflow...**\n\nConnecting to backend...',
        timestamp: Date.now(),
        status: 'streaming',
      };
      setMessages(prev => [...prev, progressMessage]);

      try {
        // Connect WebSocket for real-time updates
        aiServiceClient.connectWebSocket(
          () => console.log('[AIChatPanel] WebSocket connected'),
          (error) => console.error('[AIChatPanel] WebSocket error:', error)
        );

        // Generate a valid UUID for projectId if not provided
        const validProjectId = projectId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
          ? projectId
          : '00000000-0000-0000-0000-000000000001'; // Default UUID for local dev

        // Start workflow
        const response = await aiServiceClient.startWorkflow({
          workflowName: 'project_generation', // Match backend definition
          projectId: validProjectId,
          initialContext: {
            prompt: instruction,
            workspaceId,
          },
          triggerType: 'manual',
        });

        // Subscribe to workflow events
        const unsubscribe = aiServiceClient.subscribeToWorkflow(response.workflowRunId, (event: WorkflowEvent) => {
          const agentEmojis: Record<string, string> = {
            'pm_agent': '📋',
            'architect_agent': '🏗️',
            'backend_agent': '⚙️',
            'frontend_agent': '🎨',
            'devops_agent': '🐳',
            'qa_agent': '🧪',
            'security_agent': '🔒',
          };

          switch (event.type) {
            case 'step_started':
              const emoji = agentEmojis[event.agentName || ''] || '🔄';
              const agentName = (event.agentName || 'Agent').replace('_agent', '').toUpperCase();
              setMessages(prev => prev.map(m =>
                m.id === progressMessage.id
                  ? { ...m, content: `${emoji} **${agentName} Agent working...**\n\nStep ${event.stepIndex}: ${event.stepName}` }
                  : m
              ));
              break;

            case 'step_completed':
              setMessages(prev => prev.map(m =>
                m.id === progressMessage.id
                  ? { ...m, content: `✅ **Step ${event.stepIndex} completed**\n\n${event.stepName}` }
                  : m
              ));
              break;

            case 'step_failed':
              setMessages(prev => prev.map(m =>
                m.id === progressMessage.id
                  ? { ...m, content: `❌ **Step ${event.stepIndex} failed**\n\n${event.stepName}: ${event.data?.error || 'Unknown error'}` }
                  : m
              ));
              break;

            case 'workflow_completed':
              setMessages(prev => prev.map(m =>
                m.id === progressMessage.id
                  ? {
                      ...m,
                      content: `✅ **AI Team Completed!**\n\nWorkflow finished successfully. Check the generated files.`,
                      status: 'complete',
                    }
                  : m
              ));
              unsubscribe();
              break;

            case 'workflow_failed':
              setMessages(prev => prev.map(m =>
                m.id === progressMessage.id
                  ? {
                      ...m,
                      content: `❌ **Workflow Failed**\n\n${event.data?.error || 'Unknown error'}`,
                      status: 'error',
                    }
                  : m
              ));
              unsubscribe();
              break;
          }
        });

        // Also poll for status as fallback
        const finalRun = await aiServiceClient.pollWorkflowStatus(
          response.workflowRunId,
          (run: WorkflowRun) => {
            // Update progress based on polling
            const completedSteps = run.completedSteps.length;
            const totalSteps = run.totalSteps;
            const percent = Math.round((completedSteps / totalSteps) * 100);
            
            setMessages(prev => prev.map(m =>
              m.id === progressMessage.id
                ? { ...m, content: `🔄 **Processing...**\n\nProgress: ${completedSteps}/${totalSteps} steps (${percent}%)\nStatus: ${run.status}` }
                : m
            ));
          },
          { intervalMs: 2000, timeoutMs: 300000 }
        );

        // Final result
        if (finalRun.status === 'completed') {
          const steps = finalRun.steps.filter(s => s.status === 'completed');
          const totalTokens = finalRun.totalTokensIn + finalRun.totalTokensOut;
          
          setMessages(prev => prev.map(m =>
            m.id === progressMessage.id
              ? {
                  ...m,
                  content: `✅ **AI Team Completed!**\n\n` +
                    `**${steps.length} agents** completed successfully.\n` +
                    `**${totalTokens.toLocaleString()} tokens** used.\n` +
                    `**$${(finalRun.totalCostUsd || 0).toFixed(4)}** cost.\n\n` +
                    `Files have been generated in your workspace.`,
                  status: 'complete',
                  metadata: {
                    filesModified: [],
                    patchesGenerated: steps.length,
                    duration: finalRun.completedAt 
                      ? new Date(finalRun.completedAt).getTime() - new Date(finalRun.createdAt).getTime()
                      : undefined,
                  }
                }
              : m
          ));
        } else if (finalRun.status === 'failed') {
          setMessages(prev => prev.map(m =>
            m.id === progressMessage.id
              ? {
                  ...m,
                  content: `❌ **Workflow Failed**\n\n${finalRun.errorMessage || 'Unknown error'}\n\nStep ${finalRun.errorStep} failed.`,
                  status: 'error',
                }
              : m
          ));
        }

        return;
      } catch (error) {
        console.error('[AIChatPanel] Backend workflow failed:', error);
        
        // Update message with error
        setMessages(prev => prev.map(m =>
          m.id === progressMessage.id
            ? {
                ...m,
                content: `⚠️ **Backend unavailable**\n\nFalling back to local AI...\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
                status: 'streaming',
              }
            : m
        ));
        
        // Fall through to chat mode
      }
    }

    // Chat-only mode: Use Groq for general questions
    const editorContext = editorContextService.getContext();
    const ideContextBlock = editorContextService.getIDEContextBlock();
    const code = editorContextService.getCodeForAI();

    // Stream response from Groq with full IDE context
    const assistantMessage: ChatMessage = {
      id: `groq-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };
    setMessages(prev => [...prev, assistantMessage]);

    // Build prompt with IDE context
    let fullPrompt = '';
    
    // Add IDE context
    if (ideContextBlock.systemContext) {
      fullPrompt += `[IDE Context]\n${ideContextBlock.systemContext}\n\n`;
    }
    
    // Add code context
    if (code) {
      const codeLabel = editorContext.selection 
        ? `Selected code from ${editorContext.filePath} (lines ${editorContext.selection.startLine}-${editorContext.selection.endLine})`
        : `Full content of ${editorContext.filePath}`;
      fullPrompt += `[${codeLabel}]\n\`\`\`${editorContext.language ?? ''}\n${code}\n\`\`\`\n\n`;
    }
    
    // Add user instruction
    fullPrompt += instruction;

    let fullContent = '';
    await groqClient.chatStream(
      [
        { role: 'system', content: AI_ASSISTANT_SYSTEM_PROMPT },
        { role: 'user', content: fullPrompt }
      ],
      (chunk, done) => {
        fullContent += chunk;
        setMessages(prev => prev.map(m =>
          m.id === assistantMessage.id
            ? { ...m, content: fullContent, status: done ? 'complete' : 'streaming' }
            : m
        ));
      }
    );
  };

  // Quick actions
  const quickActions = [
    { label: 'Fix bugs', prompt: 'Find and fix any bugs in this file' },
    { label: 'Add tests', prompt: 'Write unit tests for this code' },
    { label: 'Refactor', prompt: 'Refactor this code for better readability' },
    { label: 'Document', prompt: 'Add documentation comments to this code' },
  ];

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {/* Header */}
      <div className={styles.header}>
        <h3 className={styles.title}>AI Assistant</h3>
        <div className={styles.status}>
          <span
            className={`${styles.statusDot} ${styles[connectionStatus]}`}
          />
          <span className={styles.statusText}>
            {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
          </span>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={styles.settingsButton}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className={styles.settingsModal}>
          <h4>Groq API Configuration</h4>
          <p>
            {isGroqConfigured
              ? `API Key: ${groqClient.getApiKeyMasked()}`
              : 'Enter your Groq API key to enable AI chat'}
          </p>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="gsk_..."
            className={styles.apiKeyInput}
          />
          <div className={styles.settingsActions}>
            <button onClick={handleSaveApiKey} className={styles.saveButton}>
              Save
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className={styles.cancelButton}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className={styles.messages}>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.message} ${styles[message.role]}`}
          >
            <div className={styles.messageHeader}>
              <span className={styles.roleLabel}>
                {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'AI' : 'System'}
              </span>
              <span className={styles.timestamp}>
                {formatTimestamp(message.timestamp)}
              </span>
            </div>
            <div className={styles.messageContent}>
              {renderContent(message.content, message.status)}
            </div>
            {message.metadata && (
              <div className={styles.messageMeta}>
                {message.metadata.filesModified && (
                  <span>📁 {message.metadata.filesModified.length} files</span>
                )}
                {message.metadata.patchesGenerated && (
                  <span>🔧 {message.metadata.patchesGenerated} patches</span>
                )}
                {message.metadata.duration && (
                  <span>⏱️ {formatDuration(message.metadata.duration)}</span>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      <div className={styles.quickActions}>
        {quickActions.map((action) => (
          <button
            key={action.label}
            className={styles.quickAction}
            onClick={() => setInput(action.prompt)}
            disabled={isSending || executionStatus.status === 'running'}
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        <textarea
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Describe what you want to build or modify..."
          disabled={isSending || executionStatus.status === 'running'}
          rows={3}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!input.trim() || isSending || executionStatus.status === 'running'}
        >
          {isSending || executionStatus.status === 'running' ? (
            <span className={styles.spinner} />
          ) : (
            'Send'
          )}
        </button>
      </div>

      {/* Status Bar */}
      {executionStatus.status !== 'idle' && (
        <div className={styles.statusBar}>
          <span className={`${styles.statusDot} ${styles[executionStatus.status]}`} />
          <span>{executionStatus.message}</span>
          {executionStatus.progress > 0 && (
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${executionStatus.progress}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ========================================
// HELPERS
// ========================================

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTaskProgress(task: {
  stage: string;
  progress: number;
  stageMessage?: string | null;
}): string {
  const stageEmoji: Record<string, string> = {
    planning: '🧠',
    execution: '⚡',
    validation: '✅',
    application: '📝',
    rollback: '↩️',
    pending: '⏳',
  };

  const emoji = stageEmoji[task.stage] ?? '🔄';
  const progress = task.progress > 0 ? ` (${task.progress}%)` : '';
  const message = task.stageMessage ?? `${task.stage}...`;

  return `${emoji} **${message}**${progress}\n\nTask is in progress...`;
}

function formatTaskComplete(task: {
  filesModified: string[];
  patchesGenerated: number;
}): string {
  const files = task.filesModified.length;
  const patches = task.patchesGenerated;

  return `✅ **Task Completed**\n\nModified ${files} file${files !== 1 ? 's' : ''} with ${patches} patch${patches !== 1 ? 'es' : ''}.\n\n${
    task.filesModified.length > 0
      ? '**Files:**\n' + task.filesModified.map(f => `- \`${f}\``).join('\n')
      : ''
  }`;
}

function formatTaskError(task: {
  error?: { message: string; stage: string } | null;
  rollbackPerformed?: boolean;
}): string {
  const error = task.error;
  const rollback = task.rollbackPerformed ? '\n\n⚠️ Changes were rolled back.' : '';

  return `❌ **Task Failed**\n\n${
    error ? `Error in ${error.stage}: ${error.message}` : 'Unknown error occurred'
  }${rollback}`;
}

function renderContent(content: string, status?: string): React.ReactNode {
  // Simple markdown-like rendering
  const lines = content.split('\n');

  return lines.map((line, i) => {
    // Bold
    if (line.startsWith('**') && line.endsWith('**')) {
      return (
        <p key={i} className={styles.bold}>
          {line.slice(2, -2)}
        </p>
      );
    }

    // List items
    if (line.startsWith('- ')) {
      return (
        <li key={i} className={styles.listItem}>
          {renderInlineCode(line.slice(2))}
        </li>
      );
    }

    // Code block
    if (line.startsWith('```')) {
      return null; // Handle code blocks separately
    }

    // Regular text
    if (line.trim()) {
      return <p key={i}>{renderInlineCode(line)}</p>;
    }

    return <br key={i} />;
  });
}

function renderInlineCode(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/);

  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className={styles.inlineCode}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export default AIChatPanel;
