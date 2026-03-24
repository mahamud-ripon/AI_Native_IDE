/**
 * Bottom Panel Component
 *
 * Tabbed bottom panel with Terminal and Preview integration.
 * Supports maximize/minimize toggle and tab management.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal,
  Play,
  X,
  Maximize2,
  Minimize2,
  PanelBottom,
  AlertCircle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { SimpleTooltip as Tooltip } from '@/components/ui/Tooltip';

export type BottomPanelTab = 'terminal' | 'preview' | 'problems' | 'output';

export interface BottomPanelProps {
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  onClose?: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  children?: React.ReactNode;
  className?: string;
}

const tabs: { id: BottomPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'terminal', label: 'Terminal', icon: <Terminal className="h-3.5 w-3.5" /> },
  { id: 'preview', label: 'Preview', icon: <Play className="h-3.5 w-3.5" /> },
  { id: 'problems', label: 'Problems', icon: <AlertCircle className="h-3.5 w-3.5" /> },
  { id: 'output', label: 'Output', icon: <CheckCircle className="h-3.5 w-3.5" /> },
];

export function BottomPanel({
  activeTab,
  onTabChange,
  onClose,
  onToggleMaximize,
  isMaximized,
  children,
  className,
}: BottomPanelProps) {
  return (
    <div className={cn('flex flex-col h-full bg-ide-bg-secondary', className)}>
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-ide-border bg-ide-bg-tertiary">
        <div className="flex items-center">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all duration-fast',
                'border-b-2 border-transparent',
                activeTab === tab.id
                  ? 'text-ide-text-primary border-ide-accent-primary bg-ide-bg-primary'
                  : 'text-ide-text-muted hover:text-ide-text-secondary hover:bg-ide-bg-secondary'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 px-2">
          <Tooltip content={isMaximized ? 'Restore' : 'Maximize'} side="top">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onToggleMaximize}
            >
              {isMaximized ? (
                <PanelBottom className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </Tooltip>
          <Tooltip content="Close panel" side="top">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export default BottomPanel;
