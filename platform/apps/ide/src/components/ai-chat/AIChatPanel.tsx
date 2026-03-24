/**
 * AI Chat Panel Component
 *
 * A modern chat interface inspired by Bolt.new featuring:
 * - Floating chat input with prompt suggestions
 * - Message bubble design with syntax highlighting
 * - Agent avatar and typing indicators
 * - Code block renderer with copy button
 * - Quick action chips
 * - Streaming message animation
 *
 * @example
 * <AIChatPanel
 *   messages={messages}
 *   onSendMessage={(msg) => console.log('Send:', msg)}
 *   isTyping={true}
 * />
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Bot,
  User,
  Copy,
  Check,
  Sparkles,
  Code,
  Zap,
  RefreshCw,
  MoreHorizontal,
  Paperclip,
  CornerDownLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { SimpleTooltip as Tooltip } from '@/components/ui/Tooltip';
import { Badge } from '@/components/ui/Badge';

// ============================================================================
// Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface CodeBlock {
  language: string;
  code: string;
  filename?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  codeBlocks?: CodeBlock[];
  timestamp: Date;
  isStreaming?: boolean;
  actions?: QuickAction[];
}

export interface QuickAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

export interface AIChatPanelProps {
  messages: ChatMessage[];
  isTyping?: boolean;
  onSendMessage: (message: string) => void;
  onRegenerate?: (messageId: string) => void;
  onCopyCode?: (code: string) => void;
  onActionClick?: (actionId: string) => void;
  suggestions?: string[];
  className?: string;
}

// ============================================================================
// Code Block Component
// ============================================================================

interface CodeBlockProps {
  block: CodeBlock;
  onCopy?: (code: string) => void;
}

function CodeBlockComponent({ block, onCopy }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(block.code);
      setCopied(true);
      onCopy?.(block.code);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-ide-border bg-ide-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-ide-bg-tertiary border-b border-ide-border">
        <div className="flex items-center gap-2">
          <Code className="h-3.5 w-3.5 text-ide-text-muted" />
          <span className="text-xs text-ide-text-secondary">
            {block.filename || block.language}
          </span>
        </div>
        <Tooltip content={copied ? 'Copied!' : 'Copy code'}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopy}
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Check className="h-3.5 w-3.5 text-ide-accent-success" />
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </Tooltip>
      </div>

      {/* Code content */}
      <div className="p-3 overflow-x-auto">
        <pre className="text-sm font-mono text-ide-text-primary">
          <code>{block.code}</code>
        </pre>
      </div>
    </div>
  );
}

// ============================================================================
// Message Bubble Component
// ============================================================================

interface MessageBubbleProps {
  message: ChatMessage;
  onCopyCode?: (code: string) => void;
  onRegenerate?: () => void;
}

function MessageBubble({ message, onCopyCode, onRegenerate }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'flex gap-3 py-4 px-4',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
        isUser
          ? 'bg-ide-accent-primary/20 text-ide-accent-primary'
          : 'bg-gradient-to-br from-ide-accent-purple to-ide-accent-primary text-white'
      )}>
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div className={cn(
        'flex-1 max-w-[85%]',
        isUser ? 'items-end' : 'items-start'
      )}>
        {/* Header */}
        <div className={cn(
          'flex items-center gap-2 mb-1',
          isUser ? 'justify-end' : 'justify-start'
        )}>
          <span className="text-xs font-medium text-ide-text-secondary">
            {isUser ? 'You' : 'AI Assistant'}
          </span>
          <span className="text-xs text-ide-text-muted">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Message content */}
        <div className={cn(
          'rounded-2xl px-4 py-2.5',
          isUser
            ? 'bg-ide-accent-primary text-white rounded-br-md'
            : 'bg-ide-bg-tertiary border border-ide-border rounded-bl-md'
        )}>
          <p className={cn(
            'text-sm leading-relaxed whitespace-pre-wrap',
            isUser ? 'text-white' : 'text-ide-text-primary'
          )}>
            {message.content}
            {message.isStreaming && (
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="inline-block w-1.5 h-1.5 ml-1 rounded-full bg-current"
              />
            )}
          </p>
        </div>

        {/* Code blocks */}
        {!isUser && message.codeBlocks?.map((block, index) => (
          <CodeBlockComponent
            key={index}
            block={block}
            onCopy={onCopyCode}
          />
        ))}

        {/* Quick actions */}
        {!isUser && message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {message.actions.map((action) => (
              <button
                key={action.id}
                onClick={action.onClick}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                  'bg-ide-bg-secondary border border-ide-border',
                  'text-xs text-ide-text-secondary',
                  'hover:bg-ide-bg-elevated hover:border-ide-accent-primary/50',
                  'hover:text-ide-text-primary transition-all duration-fast'
                )}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Regenerate button for assistant */}
        {!isUser && onRegenerate && (
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-ide-text-muted hover:text-ide-text-secondary"
              onClick={onRegenerate}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Regenerate
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Typing Indicator Component
// ============================================================================

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex gap-3 py-4 px-4"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-ide-accent-purple to-ide-accent-primary flex items-center justify-center">
        <Bot className="h-4 w-4 text-white" />
      </div>
      <div className="flex items-center gap-1 px-4 py-2.5 bg-ide-bg-tertiary border border-ide-border rounded-2xl rounded-bl-md">
        <motion.span
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
          className="w-1.5 h-1.5 rounded-full bg-ide-text-muted"
        />
        <motion.span
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }}
          className="w-1.5 h-1.5 rounded-full bg-ide-text-muted"
        />
        <motion.span
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }}
          className="w-1.5 h-1.5 rounded-full bg-ide-text-muted"
        />
      </div>
    </motion.div>
  );
}

// ============================================================================
// Suggestion Chips Component
// ============================================================================

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

function SuggestionChips({ suggestions, onSelect }: SuggestionChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {suggestions.map((suggestion, index) => (
        <motion.button
          key={index}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.05 }}
          onClick={() => onSelect(suggestion)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
            'bg-ide-bg-secondary border border-ide-border',
            'text-xs text-ide-text-secondary',
            'hover:bg-ide-bg-elevated hover:border-ide-accent-primary/50',
            'hover:text-ide-text-primary transition-all duration-fast'
          )}
        >
          <Sparkles className="h-3 w-3 text-ide-accent-primary" />
          {suggestion}
        </motion.button>
      ))}
    </div>
  );
}

// ============================================================================
// Main AI Chat Panel Component
// ============================================================================

export function AIChatPanel({
  messages,
  isTyping,
  onSendMessage,
  onRegenerate,
  onCopyCode,
  onActionClick,
  suggestions = [
    'Create a React component',
    'Fix this error',
    'Explain this code',
    'Refactor this file',
  ],
  className,
}: AIChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(messages.length === 0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = useCallback(() => {
    if (inputValue.trim()) {
      onSendMessage(inputValue.trim());
      setInputValue('');
      setShowSuggestions(false);
    }
  }, [inputValue, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setInputValue(suggestion);
    inputRef.current?.focus();
  };

  return (
    <div className={cn('flex flex-col h-full bg-ide-bg-base', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border bg-ide-bg-secondary">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ide-accent-purple to-ide-accent-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ide-text-primary">AI Assistant</h3>
            <p className="text-xs text-ide-text-muted">Powered by Claude</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="secondary">Beta</Badge>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto ide-scrollbar">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-ide-accent-purple/20 to-ide-accent-primary/20 flex items-center justify-center mb-4">
              <Zap className="h-8 w-8 text-ide-accent-primary" />
            </div>
            <h2 className="text-lg font-semibold text-ide-text-primary mb-2">
              How can I help you today?
            </h2>
            <p className="text-sm text-ide-text-secondary max-w-xs">
              Ask me anything about your code, get suggestions, or let me help you build something amazing.
            </p>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onCopyCode={onCopyCode}
                onRegenerate={() => onRegenerate?.(message.id)}
              />
            ))}
            <AnimatePresence>
              {isTyping && <TypingIndicator />}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Suggestions */}
      <AnimatePresence>
        {showSuggestions && messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <p className="px-4 text-xs text-ide-text-muted mb-2">Suggested prompts</p>
            <SuggestionChips
              suggestions={suggestions}
              onSelect={handleSuggestionSelect}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="p-4 border-t border-ide-border bg-ide-bg-secondary">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI to help with your code..."
            className={cn(
              'w-full min-h-[80px] max-h-[200px] resize-y',
              'px-4 py-3 pr-12 pb-10',
              'bg-ide-bg-tertiary border border-ide-border rounded-xl',
              'text-sm text-ide-text-primary placeholder:text-ide-text-muted',
              'focus:outline-none focus:border-ide-accent-primary focus:ring-1 focus:ring-ide-accent-primary',
              'transition-all duration-fast'
            )}
            rows={3}
          />

          {/* Input actions */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1">
            <Tooltip content="Attach file">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-ide-text-muted hover:text-ide-text-secondary"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>

          <div className="absolute bottom-3 right-3 flex items-center gap-1">
            <span className="text-xs text-ide-text-muted mr-2">
              <CornerDownLeft className="h-3 w-3 inline mr-1" />
              Enter to send
            </span>
            <Button
              size="sm"
              className={cn(
                'h-8 px-3 transition-all duration-fast',
                !inputValue.trim()
                  ? 'opacity-50 cursor-not-allowed'
                  : 'bg-ide-accent-primary hover:bg-ide-accent-primary-hover'
              )}
              onClick={handleSend}
              disabled={!inputValue.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <p className="mt-2 text-xs text-ide-text-muted text-center">
          AI-generated content may be inaccurate. Please verify important information.
        </p>
      </div>
    </div>
  );
}

export default AIChatPanel;
