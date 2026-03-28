/**
 * HomeLeftIconBar Component
 *
 * Fixed vertical icon bar on the left side of the homepage.
 * Provides quick navigation to Chat, Templates, Projects, Files, Settings, Help.
 */

import * as React from 'react';
import {
  MessageSquare,
  Layout,
  FolderKanban,
  FileCode,
  Settings,
  HelpCircle,
  PanelLeft,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { SimpleTooltip } from '../ui/Tooltip';

type IconId = 'sidebar' | 'chat' | 'templates' | 'projects' | 'files' | 'settings' | 'help';

interface IconItem {
  id: IconId;
  icon: LucideIcon;
  label: string;
}

interface HomeLeftIconBarProps {
  activeIcon?: IconId;
  onIconClick?: (id: IconId) => void;
  className?: string;
}

const iconItems: IconItem[] = [
  { id: 'sidebar', icon: PanelLeft, label: 'Sidebar' },
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'templates', icon: Layout, label: 'Templates' },
  { id: 'projects', icon: FolderKanban, label: 'Projects' },
  { id: 'files', icon: FileCode, label: 'Files' },
  { id: 'settings', icon: Settings, label: 'Settings' },
  { id: 'help', icon: HelpCircle, label: 'Help' },
];

export function HomeLeftIconBar({
  activeIcon = 'chat',
  onIconClick,
  className,
}: HomeLeftIconBarProps) {
  const [hoveredIcon, setHoveredIcon] = React.useState<IconId | null>(null);

  return (
    <div
      className={cn(
        'fixed left-0 top-1/2 -translate-y-1/2 flex flex-col gap-2 p-3 z-[50]',
        className
      )}
      style={{
        backgroundColor: 'transparent',
      }}
    >
      {iconItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeIcon === item.id;
        const isHovered = hoveredIcon === item.id;

        return (
          <SimpleTooltip
            key={item.id}
            content={item.label}
            side="right"
          >
            <button
              onClick={() => onIconClick?.(item.id)}
              onMouseEnter={() => setHoveredIcon(item.id)}
              onMouseLeave={() => setHoveredIcon(null)}
              className={cn(
                'relative w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200',
                'border backdrop-blur-sm',
                isActive
                  ? 'bg-[#3b82f6] text-white border-[#3b82f6]'
                  : isHovered
                  ? 'bg-[#27272a] text-white border-[#3b82f6] scale-110'
                  : 'bg-[rgba(24,24,27,0.8)] text-[#71717a] border-[#27272a] hover:border-[#3b82f6]'
              )}
              aria-label={item.label}
              aria-pressed={isActive}
            >
              <Icon className="w-5 h-5" />
            </button>
          </SimpleTooltip>
        );
      })}
    </div>
  );
}

export default HomeLeftIconBar;
