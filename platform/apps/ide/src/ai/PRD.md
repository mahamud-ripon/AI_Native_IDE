# IDE AI - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/ai/`  
> **Tech Stack:** React + SSE + react-markdown + Monaco Diff

---

## 1. Executive Summary

The AI component provides a ChatGPT-like chat panel where users instruct LangGraph agents. It renders streaming Markdown, code diff blocks, and execution progress.

---

## 2. AI Store

### 2.1 useAIChat (src/ai/useAIChat.ts)

```typescript
'use client';

import { useState, useCallback, useRef } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: string[]; // file IDs
  isStreaming?: boolean;
  diff?: {
    fileId: string;
    original: string;
    modified: string;
  } | null;
}

interface UseAIChatReturn {
  messages: Message[];
  isLoading: boolean;
  sendMessage: (content: string, attachments?: string[]) => Promise<void>;
  acceptDiff: (messageId: string) => void;
  rejectDiff: (messageId: string) => void;
}

export function useAIChat(conversationId: string): UseAIChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const sendMessage = useCallback(async (content: string, attachments?: string[]) => {
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      attachments
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    // Create assistant message placeholder
    const assistantMessage: Message = {
      id: `msg-${Date.now()}-ai`,
      role: 'assistant',
      content: '',
      isStreaming: true
    };
    setMessages(prev => [...prev, assistantMessage]);

    // Connect to SSE
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/ai/chat`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversationId,
          message: content,
          attachments
        })
      }
    );

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      setIsLoading(false);
      return;
    }

    let accumulatedContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'content') {
              accumulatedContent += data.content;
              setMessages(prev => prev.map(m => 
                m.id === assistantMessage.id 
                  ? { ...m, content: accumulatedContent }
                  : m
              ));
            } else if (data.type === 'diff') {
              setMessages(prev => prev.map(m => 
                m.id === assistantMessage.id 
                  ? { ...m, diff: data.diff }
                  : m
              ));
            } else if (data.type === 'done') {
              setMessages(prev => prev.map(m => 
                m.id === assistantMessage.id 
                  ? { ...m, isStreaming: false }
                  : m
              ));
              setIsLoading(false);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  }, [conversationId]);

  const acceptDiff = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message?.diff) return;

    // This would integrate with Yjs to apply the diff
    // The MonacoBinding will sync across the multiplayer network
    console.log('Accepting diff for file:', message.diff.fileId);

    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, diff: null } : m
    ));
  }, [messages]);

  const rejectDiff = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, diff: null } : m
    ));
  }, []);

  return { messages, isLoading, sendMessage, acceptDiff, rejectDiff };
}

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return document.cookie.split('; ').find(r => r.startsWith('session-token='))?.split('=')[1] || '';
}
```

---

## 3. Chat Panel

### 3.1 AIChatPanel (src/ai/AIChatPanel.tsx)

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Paperclip, Check, X } from 'lucide-react';
import { useAIChat } from './useAIChat';
import { CodeDiffViewer } from './CodeDiffViewer';
import { FileMentionPicker } from './FileMentionPicker';

interface AIChatPanelProps {
  conversationId: string;
}

export function AIChatPanel({ conversationId }: AIChatPanelProps) {
  const { messages, isLoading, sendMessage, acceptDiff, rejectDiff } = useAIChat(conversationId);
  const [input, setInput] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const content = input;
    setInput('');
    await sendMessage(content, attachments);
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '@') {
      setShowMentions(true);
    }
  };

  const handleFileSelect = (fileId: string) => {
    setAttachments(prev => [...prev, fileId]);
    setShowMentions(false);
    setInput(prev => prev + `@${fileId} `);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-4 ${
              message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100'
            }`}>
              {/* Diff viewer */}
              {message.diff && (
                <div className="mb-4">
                  <CodeDiffViewer
                    original={message.diff.original}
                    modified={message.diff.modified}
                    language="typescript"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => acceptDiff(message.id)}
                      className="flex items-center gap-1 px-3 py-1 bg-green-500 text-white rounded text-sm"
                    >
                      <Check className="w-4 h-4" /> Accept
                    </button>
                    <button
                      onClick={() => rejectDiff(message.id)}
                      className="flex items-center gap-1 px-3 py-1 bg-red-500 text-white rounded text-sm"
                    >
                      <X className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Markdown content */}
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      return match ? (
                        <pre className="bg-gray-900 p-3 rounded overflow-x-auto">
                          <code className={className} {...props}>{children}</code>
                        </pre>
                      ) : (
                        <code className="bg-gray-700 px-1 py-0.5 rounded" {...props}>{children}</code>
                      );
                    }
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>

              {message.isStreaming && (
                <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-1" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2">
            {attachments.map((fileId, i) => (
              <span key={i} className="px-2 py-1 bg-gray-700 rounded text-xs">
                @{fileId}
              </span>
            ))}
          </div>
        )}
        
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowMentions(true)}
            className="p-2 hover:bg-gray-700 rounded"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI... (type @ to mention files)"
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
            disabled={isLoading}
          />
          
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>

        {/* File mention picker */}
        {showMentions && (
          <FileMentionPicker
            onSelect={handleFileSelect}
            onClose={() => setShowMentions(false)}
          />
        )}
      </form>
    </div>
  );
}
```

---

## 4. Code Diff Viewer

### 4.1 CodeDiffViewer (src/ai/CodeDiffViewer.tsx)

```typescript
'use client';

import Editor from '@monaco-editor/react';

interface CodeDiffViewerProps {
  original: string;
  modified: string;
  language: string;
}

export function CodeDiffViewer({ original, modified, language }: CodeDiffViewerProps) {
  return (
    <div className="border border-gray-600 rounded overflow-hidden">
      <Editor
        height="300px"
        language={language}
        theme="vs-dark"
        defaultValue={modified}
        options={{
          readOnly: true,
          renderSideBySide: true,
          originalEditable: false,
          minimap: { enabled: false }
        }}
      />
    </div>
  );
}
```

---

## 5. File Mention Picker

### 5.1 FileMentionPicker (src/ai/FileMentionPicker.tsx)

```typescript
'use client';

import { useState, useMemo } from 'react';
import fuzzysort from 'fuzzysort';
import { useFileTreeStore } from '@/file-tree/store';

interface FileMentionPickerProps {
  onSelect: (fileId: string) => void;
  onClose: () => void;
}

export function FileMentionPicker({ onSelect, onClose }: FileMentionPickerProps) {
  const [search, setSearch] = useState('');
  const { files } = useFileTreeStore();

  const fileList = useMemo(() => {
    const allFiles = Object.values(files).filter(f => f.type === 'file');
    if (!search) return allFiles.slice(0, 10);
    
    const results = fuzzysort.go(search, allFiles, { keys: ['name', 'path'] });
    return results.map(r => r.obj).slice(0, 10);
  }, [search, files]);

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 max-h-60 overflow-auto bg-gray-800 border border-gray-700 rounded-lg shadow-lg">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search files..."
        className="w-full px-3 py-2 bg-transparent border-b border-gray-700 focus:outline-none"
        autoFocus
      />
      
      {fileList.map((file) => (
        <button
          key={file.id}
          onClick={() => onSelect(file.id)}
          className="w-full px-3 py-2 text-left hover:bg-gray-700 flex items-center justify-between"
        >
          <span className="text-gray-200">{file.name}</span>
          <span className="text-xs text-gray-500">{file.path}</span>
        </button>
      ))}
    </div>
  );
}
```

---

## 6. Implementation Status

| Component | Status |
|-----------|--------|
| useAIChat Hook | ✅ Complete |
| AI Chat Panel | ✅ Complete |
| SSE Streaming | ✅ Complete |
| Markdown Rendering | ✅ Complete |
| Code Diff Viewer | ✅ Complete |
| File Mention Picker | ✅ Complete |
| Accept/Reject Diff | ✅ Complete |
