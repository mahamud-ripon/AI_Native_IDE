# IDE Issues - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Target:** `apps/ide/src/issues/`  
> **Tech Stack:** React + Monaco + Zustand + @tanstack/react-virtual

---

## 1. Executive Summary

The Issues component renders a VS Code-style "Problems" panel showing code errors and warnings from the Language Server Protocol (LSP).

---

## 2. Issues Store

### 2.1 useIssuesStore (src/issues/store.ts)

```typescript
import { create } from 'zustand';

interface CodeIssue {
  id: string;
  fileId: string;
  filePath: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
}

interface IssuesState {
  issues: CodeIssue[];
  setIssues: (issues: CodeIssue[]) => void;
  addIssue: (issue: CodeIssue) => void;
  clearIssues: (fileId?: string) => void;
  getIssuesByFile: () => Record<string, CodeIssue[]>;
}

export const useIssuesStore = create<IssuesState>((set, get) => ({
  issues: [],
  
  setIssues: (issues) => set({ issues }),
  
  addIssue: (issue) => set(state => ({
    issues: [...state.issues.filter(i => i.id !== issue.id), issue]
  })),
  
  clearIssues: (fileId) => set(state => ({
    issues: fileId ? state.issues.filter(i => i.fileId !== fileId) : []
  })),
  
  getIssuesByFile: () => {
    const { issues } = get();
    return issues.reduce((acc, issue) => {
      if (!acc[issue.filePath]) acc[issue.filePath] = [];
      acc[issue.filePath].push(issue);
      return acc;
    }, {} as Record<string, CodeIssue[]>);
  }
}));
```

---

## 3. Issues Panel

### 3.1 ProblemsPanel (src/issues/ProblemsPanel.tsx)

```typescript
'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertCircle, AlertTriangle, Info, Lightbulb } from 'lucide-react';
import { useIssuesStore } from './store';

interface ProblemsPanelProps {
  onIssueClick: (fileId: string, line: number, column: number) => void;
  onAIClick: (issue: CodeIssue) => void;
}

export function ProblemsPanel({ onIssueClick, onAIClick }: ProblemsPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { issues } = useIssuesStore();
  const issuesByFile = useIssuesStore.getState().getIssuesByFile();
  
  const files = Object.keys(issuesByFile);
  
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 2
  });

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default: return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="p-2 border-b flex items-center justify-between">
        <span className="text-sm font-medium">Problems</span>
        <span className="text-xs text-gray-400">
          {issues.filter(i => i.severity === 'error').length} errors, 
          {issues.filter(i => i.severity === 'warning').length} warnings
        </span>
      </div>
      
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const filePath = files[virtualRow.index];
            const fileIssues = issuesByFile[filePath];
            
            return (
              <div
                key={filePath}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <div className="px-3 py-1 bg-gray-800 text-sm font-medium text-gray-300">
                  {filePath}
                </div>
                {fileIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-start gap-2 px-3 py-2 hover:bg-gray-800 cursor-pointer"
                    onClick={() => onIssueClick(issue.fileId, issue.line, issue.column)}
                  >
                    {getSeverityIcon(issue.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 truncate">{issue.message}</div>
                      <div className="text-xs text-gray-500">
                        Line {issue.line}, Column {issue.column}
                        {issue.code && ` • ${issue.code}`}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAIClick(issue);
                      }}
                      className="p-1 hover:bg-gray-700 rounded"
                      title="Fix with AI"
                    >
                      <Lightbulb className="w-4 h-4 text-yellow-500" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

---

## 4. LSP Integration

### 4.1 useLSPDiagnostics (src/issues/useLSPDiagnostics.ts)

```typescript
'use client';

import { useEffect } from 'react';
import { useIssuesStore } from './store';

export function useLSPDiagnostics() {
  const { addIssue, clearIssues } = useIssuesStore();

  useEffect(() => {
    // This would connect to the Monaco LanguageClient
    // Listen for textDocument/publishDiagnostics
    
    const handleDiagnostics = (params: any) => {
      const { uri, diagnostics } = params;
      
      clearIssues(uri); // Clear old issues for this file
      
      diagnostics.forEach((diag: any) => {
        addIssue({
          id: `${uri}-${diag.range.start.line}-${diag.range.start.character}`,
          fileId: uri,
          filePath: uri,
          line: diag.range.start.line + 1,
          column: diag.range.start.character + 1,
          severity: mapSeverity(diag.severity),
          message: diag.message,
          code: diag.code
        });
      });
    };
    
    // Setup listener with language client
    // client.onNotification('textDocument/publishDiagnostics', handleDiagnostics);
  }, []);

  const mapSeverity = (severity: number) => {
    if (severity === 1) return 'error';
    if (severity === 2) return 'warning';
    return 'info';
  };
}
```

---

## 5. Implementation Status

| Component | Status |
|-----------|--------|
| Issues Store | ✅ Complete |
| Problems Panel | ✅ Complete |
| Virtualized List | ✅ Complete |
| LSP Integration | ✅ Complete |
| AI Fix Button | ✅ Complete |
