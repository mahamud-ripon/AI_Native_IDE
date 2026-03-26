/**
 * ChatPanel - AI Chat with code block support
 *
 * Connected to real aiChatStore + Groq streaming API.
 * Supports code block rendering with Apply/Copy actions.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Send,
  Plus,
  ChevronDown,
  Check,
  Copy,
  CheckCheck,
  MousePointer2,
  Lightbulb,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useAIChatStore } from '@/state/aiChatStore';
import { useIDEStore, ideEventBus } from '@/stores/ideStore';
import { aiCodingController } from '@/core/ai/aiCodingController';

// Design tokens
const colors = {
  bgMain: '#0e0e11',
  bgPanel: '#18181b',
  bgPanelHover: '#27272a',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  accentColor: '#3b82f6',
  errorColor: '#ef4444',
  successColor: '#10b981',
};

interface ChatPanelProps {
  projectId: string;
  projectName: string;
  workspaceId: string;
}

export function ChatPanel({ projectId, projectName, workspaceId }: ChatPanelProps) {
  const {
    conversations,
    activeConversationId,
    input,
    isSending,
    mode,
    createConversation,
    setInput,
    sendMessage,
    getMessages,
    loadHistory,
  } = useAIChatStore();

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = React.useState(false);

  // Load chat history from backend on first mount
  React.useEffect(() => {
    if (!historyLoaded && projectId) {
      loadHistory(projectId).finally(() => setHistoryLoaded(true));
    }
  }, [projectId, historyLoaded, loadHistory]);

  React.useEffect(() => {
    if (!activeConversationId) {
      createConversation(projectId, workspaceId);
    }
  }, [projectId, workspaceId, activeConversationId, createConversation]);

  const messages = activeConversationId ? getMessages(activeConversationId) : [];

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isSending || !activeConversationId) return;
    const instruction = input.trim();
    setInput('');
    try {
      await aiCodingController.submitTask({
        instruction,
        projectId,
        workspaceId,
        conversationId: activeConversationId,
      });
    } catch (error) {
      console.error('[ChatPanel] Failed to submit task via controller:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleApplyCode = (code: string, path?: string) => {
    const targetPath = path || useIDEStore.getState().activeTabPath;
    if (targetPath) {
      useIDEStore.getState().setFileContent(targetPath, code);
      useIDEStore.getState().openTab(targetPath, code);
      ideEventBus.emit('ai:applyCode', { path: targetPath, code });
      ideEventBus.emit('file:changed', { path: targetPath, content: code });
    } else {
      const newPath = `src/generated-${Date.now()}.ts`;
      useIDEStore.getState().setFileContent(newPath, code);
      useIDEStore.getState().openTab(newPath, code);
      ideEventBus.emit('file:created', { path: newPath });
    }
  };

  const renderMessageContent = (content: string, messageId: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('```')) {
        const lines = part.split('\n');
        const lang = lines[0].replace('```', '').trim();
        const code = lines.slice(1, -1).join('\n');
        const blockId = `${messageId}-${idx}`;

        return (
          <div
            key={idx}
            className="rounded-lg overflow-hidden my-2"
            style={{
              backgroundColor: '#1e1e2e',
              border: `1px solid ${colors.borderColor}`,
            }}
          >
            <div
              className="flex items-center justify-between px-3 py-1.5"
              style={{
                backgroundColor: '#2a2a3e',
                borderBottom: `1px solid ${colors.borderColor}`,
              }}
            >
              <span style={{ fontSize: '11px', color: colors.textMuted }}>{lang || 'code'}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyCode(code)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all"
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    color: colors.accentColor,
                    border: `1px solid rgba(59, 130, 246, 0.3)`,
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  <Check className="h-3 w-3" />
                  Apply
                </button>
                <button
                  onClick={() => handleCopyCode(code, blockId)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all"
                  style={{
                    backgroundColor: 'transparent',
                    color: colors.textMuted,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  {copiedId === blockId ? (
                    <CheckCheck className="h-3 w-3" style={{ color: colors.successColor }} />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
            <pre
              style={{
                padding: '12px',
                margin: 0,
                fontSize: '12px',
                lineHeight: '1.5',
                color: '#cdd6f4',
                fontFamily: "'JetBrains Mono', monospace",
                overflowX: 'auto',
              }}
            >
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      return (
        <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>
          {part}
        </span>
      );
    });
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: '320px',
        flexShrink: 0,
        backgroundColor: colors.bgMain,
        borderRight: `1px solid ${colors.borderColor}`,
        boxShadow: '1px 0 4px rgba(0,0,0,0.1)',
        zIndex: 20,
      }}
    >
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{
                backgroundColor: colors.bgPanel,
                border: `1px solid ${colors.borderColor}`,
              }}
            >
              <Sparkles className="h-7 w-7" style={{ color: colors.accentColor }} />
            </div>
            <p style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary, marginBottom: '8px' }}>
              How can I help you build {projectName}?
            </p>
            <p style={{ fontSize: '12px', color: colors.textMuted }}>
              Ask me to modify code, explain features, or deploy changes
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-1"
              >
                {message.role === 'user' ? (
                  <div
                    className="self-end rounded-xl px-4 py-2 text-sm"
                    style={{
                      backgroundColor: colors.accentColor,
                      color: 'white',
                      maxWidth: '85%',
                      fontSize: '13px',
                      lineHeight: '1.5',
                    }}
                  >
                    {message.content}
                  </div>
                ) : message.role === 'system' ? (
                  <div
                    className="flex items-start gap-2 rounded-lg px-3 py-2"
                    style={{
                      backgroundColor: message.status === 'error'
                        ? 'rgba(239, 68, 68, 0.1)'
                        : 'rgba(59, 130, 246, 0.1)',
                      border: `1px solid ${message.status === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                      fontSize: '12px',
                      color: message.status === 'error' ? colors.errorColor : colors.accentColor,
                    }}
                  >
                    {message.status === 'error' ? (
                      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    )}
                    <span>{message.content}</span>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: '13px',
                      lineHeight: '1.6',
                      color: colors.textPrimary,
                    }}
                  >
                    {message.status === 'streaming' ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" style={{ color: colors.accentColor }} />
                        <span style={{ color: colors.textMuted }}>Thinking...</span>
                      </div>
                    ) : (
                      renderMessageContent(message.content, message.id)
                    )}
                  </div>
                )}
              </motion.div>
            ))}

            {/* Typing indicator - Thinking (chat) vs Building (workflow) */}
            <AnimatePresence>
              {isSending && (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{
                    backgroundColor: mode === 'building' ? 'rgba(245, 158, 11, 0.1)' : colors.bgPanel,
                    border: `1px solid ${mode === 'building' ? 'rgba(245, 158, 11, 0.3)' : colors.borderColor}`,
                    width: 'fit-content',
                  }}
                >
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    style={{ color: mode === 'building' ? '#f59e0b' : colors.accentColor }}
                  />
                  <motion.span
                    key={mode}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    style={{
                      color: mode === 'building' ? '#f59e0b' : colors.textMuted,
                      fontSize: '12px',
                      fontWeight: mode === 'building' ? 500 : 400,
                    }}
                  >
                    {mode === 'building' ? 'Building...' : 'Thinking...'}
                  </motion.span>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Chat Input */}
      <div
        style={{
          padding: '16px 20px',
          borderTop: `1px solid ${colors.borderColor}`,
          backgroundColor: colors.bgMain,
        }}
      >
        <div
          className="flex flex-col rounded-xl transition-all duration-150"
          style={{
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.borderColor}`,
            padding: '12px',
            gap: '12px',
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="How can Bolt help you today? (or /command)"
            rows={1}
            disabled={isSending}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textPrimary,
              fontFamily: 'inherit',
              fontSize: '14px',
              resize: 'none',
              outline: 'none',
              minHeight: '40px',
              maxHeight: '120px',
              width: '100%',
              opacity: isSending ? 0.6 : 1,
            }}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                className="flex items-center justify-center rounded-md"
                style={{
                  width: '28px',
                  height: '28px',
                  backgroundColor: 'transparent',
                  color: colors.textSecondary,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                className="flex items-center gap-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: colors.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                <Sparkles className="h-3 w-3" />
                <span>Sonnet 4.5</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="flex items-center gap-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: colors.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                <MousePointer2 className="h-3 w-3" />
                <span>Select</span>
              </button>
              <button
                className="flex items-center gap-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: colors.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                <Lightbulb className="h-3 w-3" />
                <span>Plan</span>
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="flex items-center justify-center rounded-full transition-all duration-150"
                style={{
                  width: '28px',
                  height: '28px',
                  backgroundColor: input.trim() && !isSending ? colors.accentColor : colors.bgPanelHover,
                  color: input.trim() && !isSending ? 'white' : colors.textMuted,
                  border: 'none',
                  cursor: input.trim() && !isSending ? 'pointer' : 'not-allowed',
                }}
              >
                {isSending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
