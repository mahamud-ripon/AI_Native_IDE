/**
 * HomeSidebar Component
 *
 * Slide-in sidebar for the IDE homepage.
 * Triggered by hover on menu/account icons in the nav.
 * Features: logo, new chat button, search, chat history, menu items, user profile.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Plus,
  Search,
  MessageSquare,
  Settings,
  HelpCircle,
  FileText,
  Users,
  LogOut,
  Zap,
  X,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { SimpleTooltip } from '../ui/Tooltip';

interface MenuItem {
  id: string;
  icon: React.ElementType;
  label: string;
  highlight?: boolean;
  onClick?: () => void;
}

interface HomeSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branding?: {
    name: string;
    logo?: React.ReactNode;
  };
  user?: {
    email: string;
    initial: string;
  };
  onNewChat?: () => void;
  onSettings?: () => void;
  onHelp?: () => void;
  onSubscription?: () => void;
  onSelectAccount?: () => void;
  onSignOut?: () => void;
  className?: string;
}

export function HomeSidebar({
  open,
  onOpenChange,
  branding = { name: 'AI-Native IDE' },
  user = { email: 'user@example.com', initial: 'U' },
  onNewChat,
  onSettings,
  onHelp,
  onSubscription,
  onSelectAccount,
  onSignOut,
  className,
}: HomeSidebarProps) {
  const [hoverTimeout, setHoverTimeout] = React.useState<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    onOpenChange(true);
  };

  const handleMouseLeave = () => {
    const timeout = setTimeout(() => {
      onOpenChange(false);
    }, 100);
    setHoverTimeout(timeout);
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const menuItems: MenuItem[] = [
    { id: 'tokens', icon: Zap, label: 'Get free tokens', highlight: true, onClick: onSubscription },
    { id: 'settings', icon: Settings, label: 'Settings', onClick: onSettings },
    { id: 'help', icon: HelpCircle, label: 'Help Center', onClick: onHelp },
    { id: 'subscription', icon: FileText, label: 'My Subscription', onClick: onSubscription },
    { id: 'account', icon: Users, label: 'Select Account', onClick: onSelectAccount },
  ];

  return (
    <>
      {/* Invisible trigger area to keep sidebar open when moving mouse */}
      {open && (
        <div
          className="fixed top-0 left-0 w-16 h-full z-[150]"
          onMouseEnter={handleMouseEnter}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ x: open ? 0 : -280 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          'fixed top-0 left-0 h-full w-[280px] bg-[#111111] border-r border-[#1a1a1a] z-[200] flex flex-col',
          className
        )}
      >
        {/* Header */}
        <div className="p-5 border-b border-[#1a1a1a]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center">
                {branding.logo || <Sparkles className="w-4 h-4 text-white" />}
              </div>
              <span className="text-lg font-bold text-white">{branding.name}</span>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#71717a] hover:text-white hover:bg-[#18181b] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* New Chat Button */}
          <button
            onClick={() => { onNewChat?.(); handleClose(); }}
            className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#3b82f6] to-[#2563eb] rounded-lg text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Start new chat
          </button>
        </div>

        {/* Search */}
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
            <input
              type="text"
              placeholder="Search"
              className="w-full pl-10 pr-4 py-2.5 bg-[#18181b] border border-[#27272a] rounded-lg text-white text-sm placeholder:text-[#71717a] outline-none focus:border-[#3b82f6] transition-colors"
            />
          </div>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs text-[#71717a] uppercase tracking-wider mb-2 font-medium">
            Your Chats
          </div>
          <div className="text-sm text-[#52525b] py-4 text-center">
            No previous conversations
          </div>
        </div>

        {/* Menu Items */}
        <div className="p-4 border-t border-[#1a1a1a]">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => { item.onClick?.(); handleClose(); }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                  item.highlight
                    ? 'text-[#22c55e] hover:text-[#4ade80] hover:bg-[#18181b]'
                    : 'text-[#a1a1aa] hover:text-white hover:bg-[#18181b]'
                )}
              >
                <Icon className="w-[18px] h-[18px]" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* User Profile */}
        <div className="p-5 border-t border-[#1a1a1a]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#f97316] to-[#ea580c] flex items-center justify-center text-white text-sm font-semibold">
              {user.initial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#a1a1aa] truncate">{user.email}</div>
              <button
                onClick={() => { onSignOut?.(); handleClose(); }}
                className="text-xs text-[#71717a] hover:text-white transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
}

export default HomeSidebar;
