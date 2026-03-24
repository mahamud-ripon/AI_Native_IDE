/**
 * AI Response Display Component
 *
 * Provides progressive text display with typewriter effect for streaming responses.
 * Integrates with the existing AIChatPanel for a Claude Code-like experience.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAIStream, StreamEvent } from '@/hooks/useAIStream';

interface AIResponseDisplayProps {
  /**
   * Initial prompt to send
   */
  initialPrompt?: string;
  
  /**
   * Project ID for context
   */
  projectId?: string;
  
  /**
   * Workspace ID for context
   */
  workspaceId?: string;
  
  /**
   * Callback when response is complete
   */
  onComplete?: (response: string) => void;
  
  /**
   * Callback when error occurs
   */
  onError?: (error: string) => void;
  
  /**
   * Show progress indicator
   */
  showProgress?: boolean;
  
  /**
   * Typing speed in ms (lower = faster)
   * Set to 0 for instant display
   */
  typingSpeed?: number;
  
  /**
   * Initial characters to show instantly (for perceived performance)
   */
  instantChars?: number;
  
  className?: string;
}

/**
 * Streaming status indicator
 */
function StreamStatus({ 
  progress, 
  currentAgent,
  isStreaming 
}: { 
  progress: number; 
  currentAgent: string | null;
  isStreaming: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-ide-text-muted">
      <AnimatePresence mode="wait">
        {isStreaming ? (
          <motion.div
            key="streaming"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2"
          >
            {/* Progress bar */}
            <div className="w-24 h-1 bg-ide-bg-tertiary rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-ide-accent-primary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            
            {/* Status text */}
            <span>{progress}%</span>
            
            {/* Agent name */}
            {currentAgent && (
              <>
                <span>•</span>
                <span className="text-ide-accent-primary">{currentAgent}</span>
              </>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="complete"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1"
          >
            <span className="text-ide-accent-success">✓</span>
            <span>Complete</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Cursor component for typing effect
 */
function TypingCursor({ show }: { show: boolean }) {
  return (
    <motion.span
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.8, repeat: Infinity }}
      className={cn(
        'inline-block w-0.5 h-4 ml-0.5 align-middle',
        'bg-ide-accent-primary'
      )}
    />
  );
}

/**
 * Main AI Response Display Component
 * 
 * Features:
 * - Real-time streaming via SSE
 * - Typewriter effect for progressive text reveal
 * - Progress tracking per agent
 * - Error handling with retry option
 */
export function AIResponseDisplay({
  initialPrompt,
  projectId,
  workspaceId,
  onComplete,
  onError,
  showProgress = true,
  typingSpeed = 8, // ms per character
  instantChars = 100, // show first 100 chars instantly
  className,
}: AIResponseDisplayProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [fullResponse, setFullResponse] = useState('');
  
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIndexRef = useRef(0);
  
  const handleToken = useCallback((token: string) => {
    setFullResponse(prev => prev + token);
  }, []);
  
  const handleComplete = useCallback((response: string) => {
    setFullResponse(response);
    onComplete?.(response);
  }, [onComplete]);
  
  const handleError = useCallback((error: string) => {
    onError?.(error);
  }, [onError]);
  
  const {
    isStreaming,
    error,
    startStream,
    abortStream,
    progress,
    currentAgent,
  } = useAIStream({
    onToken: handleToken,
    onComplete: handleComplete,
    onError: handleError,
  });
  
  // Typewriter effect when fullResponse updates
  useEffect(() => {
    if (!fullResponse) return;
    
    // If typing speed is 0, show instantly
    if (typingSpeed === 0) {
      setDisplayedText(fullResponse);
      return;
    }
    
    // If this is the first chunk and we have more than instantChars, show first chunk instantly
    if (typingIndexRef.current === 0 && fullResponse.length > instantChars) {
      setDisplayedText(fullResponse.slice(0, instantChars));
      typingIndexRef.current = instantChars;
      setIsTyping(true);
    } else {
      // Continue from where we left off
      if (typingIndexRef.current < fullResponse.length) {
        setIsTyping(true);
      }
    }
    
    // Set up the typing interval
    const typeNextChunk = () => {
      if (typingIndexRef.current >= fullResponse.length) {
        setIsTyping(false);
        return;
      }
      
      // Type a chunk of characters at once for smoother feel
      const chunkSize = typingSpeed < 5 ? 10 : 1;
      const nextIndex = Math.min(typingIndexRef.current + chunkSize, fullResponse.length);
      
      setDisplayedText(fullResponse.slice(0, nextIndex));
      typingIndexRef.current = nextIndex;
      
      if (nextIndex < fullResponse.length) {
        typingTimeoutRef.current = setTimeout(typeNextChunk, typingSpeed);
      } else {
        setIsTyping(false);
      }
    };
    
    // Start typing after initial instant chars are shown
    if (typingIndexRef.current > 0) {
      typingTimeoutRef.current = setTimeout(typeNextChunk, 100);
    }
    
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [fullResponse, typingSpeed, instantChars]);
  
  // Reset when starting new stream
  useEffect(() => {
    if (isStreaming) {
      setDisplayedText('');
      setFullResponse('');
      typingIndexRef.current = 0;
      setIsTyping(false);
    }
  }, [isStreaming]);
  
  // Start streaming on mount if initial prompt provided
  useEffect(() => {
    if (initialPrompt && !isStreaming) {
      startStream(initialPrompt, projectId, workspaceId);
    }
  }, []);
  
  // Handle manual send
  const handleSend = useCallback((prompt: string) => {
    setDisplayedText('');
    setFullResponse('');
    typingIndexRef.current = 0;
    startStream(prompt, projectId, workspaceId);
  }, [startStream, projectId, workspaceId]);
  
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Response area */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="p-4 mb-4 bg-ide-accent-error/10 border border-ide-accent-error/30 rounded-lg">
            <p className="text-sm text-ide-accent-error">{error}</p>
            <button 
              onClick={() => startStream(initialPrompt || '', projectId, workspaceId)}
              className="mt-2 text-xs text-ide-accent-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        
        {(displayedText || isStreaming) && (
          <div className="prose prose-sm max-w-none">
            {/* Streaming status */}
            {showProgress && (
              <div className="mb-4">
                <StreamStatus 
                  progress={progress} 
                  currentAgent={currentAgent}
                  isStreaming={isStreaming}
                />
              </div>
            )}
            
            {/* Response content */}
            <div className="text-ide-text-primary whitespace-pre-wrap">
              {displayedText}
              {isTyping && <TypingCursor show={isTyping} />}
            </div>
            
            {/* Loading indicator when no content yet */}
            {isStreaming && !displayedText && (
              <div className="flex items-center gap-2 text-ide-text-muted">
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  Thinking
                </motion.span>
                <motion.span
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                >
                  ...
                </motion.span>
              </div>
            )}
          </div>
        )}
        
        {/* Empty state */}
        {!displayedText && !isStreaming && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-ide-text-secondary">
              Enter a prompt to start generating
            </p>
          </div>
        )}
      </div>
      
      {/* Input area (can be integrated with existing chat) */}
      <div className="border-t border-ide-border p-4">
        <input
          type="text"
          placeholder="Ask AI to help with your code..."
          className={cn(
            'w-full px-4 py-2',
            'bg-ide-bg-tertiary border border-ide-border rounded-lg',
            'text-sm text-ide-text-primary placeholder:text-ide-text-muted',
            'focus:outline-none focus:border-ide-accent-primary',
            'transition-colors'
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = e.target as HTMLInputElement;
              if (target.value.trim()) {
                handleSend(target.value.trim());
                target.value = '';
              }
            }
          }}
        />
      </div>
    </div>
  );
}

/**
 * Hook for integrating streaming into existing chat components
 * 
 * @example
 * const { message, isStreaming, progress, send } = useChatStream();
 * 
 * return (
 *   <div>
 *     {message}
 *     {isStreaming && <ProgressBar value={progress} />}
 *     <input onKeyDown={e => send(e.target.value)} />
 *   </div>
 * );
 */
export function useChatStream(options?: {
  typingSpeed?: number;
  instantChars?: number;
}) {
  const [message, setMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  
  const { startStream, abortStream } = useAIStream({
    onToken: (token) => setMessage(prev => prev + token),
    onProgress: (p, msg, agent) => {
      setProgress(p);
      setCurrentAgent(agent || null);
    },
    onComplete: () => setIsStreaming(false),
    onError: () => setIsStreaming(false),
  });
  
  const send = useCallback(async (prompt: string, projectId?: string, workspaceId?: string) => {
    setMessage('');
    setIsStreaming(true);
    setProgress(0);
    setCurrentAgent(null);
    await startStream(prompt, projectId, workspaceId);
  }, [startStream]);
  
  return {
    message,
    isStreaming,
    progress,
    currentAgent,
    send,
    abort: abortStream,
  };
}

export default AIResponseDisplay;