/**
 * HomeSettingsModal Component
 *
 * Tabbed settings modal for the IDE homepage.
 * Uses the existing Modal component as foundation.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';

type TabId = 'general' | 'subscription' | 'applications' | 'cloud' | 'knowledge' | 'connectors';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

interface HomeSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: TabId;
  className?: string;
}

const tabs: Tab[] = [
  { id: 'general', label: 'General', icon: <SunIcon /> },
  { id: 'subscription', label: 'Subscription & Tokens', icon: <CreditCardIcon /> },
  { id: 'applications', label: 'Applications', icon: <GridIcon /> },
  { id: 'cloud', label: 'Cloud', icon: <CloudIcon /> },
  { id: 'knowledge', label: 'Knowledge', icon: <BookIcon /> },
  { id: 'connectors', label: 'Connectors (MCP)', icon: <PlugIcon /> },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function CreditCardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 16.98h-5.99c-1.1 0-1.95.68-2.95 1.76C8.07 19.83 6.51 21 5 21c-1.65 0-3-1.35-3-3 0-1.65 1.35-3 3-3 1.51 0 3.07 1.17 4.06 2.26 1 1.08 1.85 1.76 2.95 1.76H18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-5.99c-1.1 0-1.95.68-2.95 1.76C8.07 8.83 6.51 10 5 10c-1.65 0-3-1.35-3-3s1.35-3 3-3c1.51 0 3.07 1.17 4.06 2.26 1 1.08 1.85 1.76 2.95 1.76H18c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange?: (checked: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="sr-only peer"
      />
      <div className={cn(
        'w-11 h-6 rounded-full peer transition-colors',
        checked ? 'bg-[#3b82f6]' : 'bg-[#27272a]'
      )}>
        <div className={cn(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform',
          checked && 'translate-x-5'
        )} />
      </div>
    </label>
  );
}

function DropdownButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="flex items-center gap-2 px-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-white text-sm hover:border-[#3b82f6] transition-colors">
      {children}
      <ChevronDownIcon />
    </button>
  );
}

export function HomeSettingsModal({
  open,
  onOpenChange,
  defaultTab = 'general',
  className,
}: HomeSettingsModalProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>(defaultTab);

  React.useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
    }
  }, [open, defaultTab]);

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
                />
              </DialogPrimitive.Overlay>

              {/* Modal Container - Centers the modal */}
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8"
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    onOpenChange(false);
                  }
                }}
              >
                {/* Modal Content */}
                <DialogPrimitive.Content asChild>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className={cn(
                      'w-[95vw] max-w-[95vw] h-[85vh] max-h-[85vh] sm:w-[95vw] sm:max-w-[95vw] sm:h-[70vh] sm:max-h-[70vh] md:w-[85vw] md:max-w-[900px] md:h-[70vh] md:max-h-[500px] lg:w-[900px] lg:max-w-[900px] lg:h-[500px] lg:max-h-[500px]',
                      'bg-[#111111] border border-[#27272a] rounded-2xl shadow-2xl',
                      'flex flex-col md:flex-row overflow-hidden',
                      className
                    )}
                    style={{ position: 'relative' }}
                  >
                    {/* Close Button */}
                    <DialogPrimitive.Close asChild>
                      <button
                        className="absolute top-3 right-3 md:top-4 md:right-4 w-8 h-8 flex items-center justify-center rounded-lg text-[#71717a] hover:text-white hover:bg-[#18181b] transition-colors z-10"
                        aria-label="Close"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </DialogPrimitive.Close>

{/* Left Sidebar */}
                  <div className="w-full md:w-[220px] bg-[#0a0a0a] md:border-r border-[#1a1a1a] py-4 md:py-5 flex-shrink-0">
                    <div className="px-4 md:px-5 mb-3 md:mb-4">
                      <div className="text-sm font-semibold text-[#a1a1aa]">
                        Personal Settings
                      </div>
                    </div>
                    <nav className="flex md:flex-col gap-1 px-2 md:px-0 overflow-x-auto md:overflow-visible">
                      {tabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => handleTabChange(tab.id)}
                          className={cn(
                            'w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors',
                            'border-l-2',
                            activeTab === tab.id
                              ? 'bg-[#18181b] text-white border-l-[#3b82f6]'
                              : 'text-[#a1a1aa] border-l-transparent hover:bg-[#18181b] hover:text-white'
                          )}
                        >
                          {tab.icon}
                          <span className="truncate">{tab.label}</span>
                        </button>
                      ))}
                    </nav>
                  </div>

                  {/* Content Area */}
                  <div className="flex-1 overflow-y-auto p-8">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.15 }}
                      >
                        {activeTab === 'general' && <GeneralTab />}
                        {activeTab === 'subscription' && <SubscriptionTab />}
                        {activeTab === 'applications' && <ApplicationsTab />}
                        {activeTab === 'cloud' && <CloudTab />}
                        {activeTab === 'knowledge' && <KnowledgeTab />}
                        {activeTab === 'connectors' && <ConnectorsTab />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  </motion.div>
                </DialogPrimitive.Content>
              </div>
            </DialogPrimitive.Portal>
          </>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-xs text-[#71717a] uppercase tracking-wider mb-4 font-medium">
        {title}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

function SettingsItem({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between py-4 border-b border-[#1a1a1a] last:border-b-0">
      <div className="flex-1 pr-5">
        <div className="text-sm font-medium text-white mb-1">{label}</div>
        {description && (
          <div className="text-sm text-[#71717a] leading-relaxed">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  );
}

function GeneralTab() {
  const [theme, setTheme] = React.useState('dark');
  const [defaultModel, setDefaultModel] = React.useState('Sonnet 4.5');
  const [displayTokens, setDisplayTokens] = React.useState(false);
  const [soundNotification, setSoundNotification] = React.useState(true);
  const [lineWrapping, setLineWrapping] = React.useState(true);

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">General</h2>

      <SettingsSection title="Appearance and notifications">
        <SettingsItem
          label="Theme"
          description="Change the interface to light, dark or your default system preference."
        >
          <DropdownButton>
            <span className="capitalize">{theme}</span>
          </DropdownButton>
        </SettingsItem>

        <SettingsItem
          label="Display token usage in chat"
          description="When activated, your token consumption will be shown above the prompt field at all times."
        >
          <ToggleSwitch checked={displayTokens} onChange={setDisplayTokens} />
        </SettingsItem>

        <SettingsItem
          label="Sound notification"
          description="Play a chime when Bolt finishes responding. This only works in your active browser tab."
        >
          <ToggleSwitch checked={soundNotification} onChange={setSoundNotification} />
        </SettingsItem>
      </SettingsSection>

      <SettingsSection title="Chat">
        <SettingsItem
          label="Default model"
          description="Choose the model used for new chats. This only changes the default model for new projects."
        >
          <DropdownButton>
            {defaultModel}
          </DropdownButton>
        </SettingsItem>
      </SettingsSection>

      <SettingsSection title="Code">
        <SettingsItem
          label="Editor line wrapping"
          description="When enabled, long lines of code will visually wrap to the next line within the editor."
        >
          <ToggleSwitch checked={lineWrapping} onChange={setLineWrapping} />
        </SettingsItem>
      </SettingsSection>
    </div>
  );
}

function SubscriptionTab() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Subscription & Tokens</h2>

      <SettingsSection title="Current Plan">
        <div className="flex items-start justify-between py-4 border-b border-[#1a1a1a]">
          <div className="flex-1 pr-5">
            <div className="text-sm font-medium text-white mb-1">Free Plan</div>
            <div className="text-sm text-[#71717a] leading-relaxed">
              You are currently on the free plan with limited features.
            </div>
          </div>
          <Button
            variant="default"
            size="sm"
            className="bg-gradient-to-r from-[#3b82f6] to-[#2563eb] hover:opacity-90"
          >
            Upgrade
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Token Balance">
        <div className="flex items-start justify-between py-4 border-b border-[#1a1a1a]">
          <div className="flex-1 pr-5">
            <div className="text-sm font-medium text-white mb-1">Available Tokens</div>
            <div className="text-sm text-[#71717a] leading-relaxed">
              Tokens remaining for this billing period.
            </div>
          </div>
          <span className="text-2xl font-semibold text-[#22c55e]">5,000</span>
        </div>

        <div className="flex items-start justify-between py-4 border-b border-[#1a1a1a]">
          <div className="flex-1 pr-5">
            <div className="text-sm font-medium text-white mb-1">Get Free Tokens</div>
            <div className="text-sm text-[#71717a] leading-relaxed">
              Earn free tokens by completing tasks or inviting friends.
            </div>
          </div>
          <Button
            variant="default"
            size="sm"
            className="bg-[#22c55e] hover:bg-[#4ade80]"
          >
            Get Tokens
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Billing">
        <div className="flex items-start justify-between py-4 border-b border-[#1a1a1a]">
          <div className="flex-1 pr-5">
            <div className="text-sm font-medium text-white mb-1">Billing History</div>
            <div className="text-sm text-[#71717a] leading-relaxed">
              View your past invoices and payment history.
            </div>
          </div>
          <button className="text-sm text-[#3b82f6] hover:text-[#60a5fa] transition-colors">
            View
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}

function ApplicationsTab() {
  const apps = [
    { name: 'GitHub', desc: 'Connect your GitHub account to import repositories.' },
    { name: 'Figma', desc: 'Import designs directly from Figma.' },
    { name: 'VS Code', desc: 'Sync your settings with VS Code extension.' },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Applications</h2>

      <SettingsSection title="Connected Apps">
        {apps.map((app) => (
          <div key={app.name} className="flex items-start justify-between py-4 border-b border-[#1a1a1a]">
            <div className="flex-1 pr-5">
              <div className="text-sm font-medium text-white mb-1">{app.name}</div>
              <div className="text-sm text-[#71717a] leading-relaxed">{app.desc}</div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="bg-[#18181b] border-[#27272a] hover:border-[#3b82f6]"
            >
              Connect
            </Button>
          </div>
        ))}
      </SettingsSection>
    </div>
  );
}

function CloudTab() {
  const [autoSync, setAutoSync] = React.useState(true);

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Cloud</h2>

      <SettingsSection title="Cloud Storage">
        <div className="flex items-start justify-between py-4 border-b border-[#1a1a1a]">
          <div className="flex-1 pr-5">
            <div className="text-sm font-medium text-white mb-1">Storage Used</div>
            <div className="text-sm text-[#71717a] leading-relaxed">
              You have used 2.5 GB of 10 GB available storage.
            </div>
          </div>
          <span className="text-sm text-[#a1a1aa]">2.5 GB / 10 GB</span>
        </div>

        <SettingsItem
          label="Auto-sync projects"
          description="Automatically sync your projects to the cloud."
        >
          <ToggleSwitch checked={autoSync} onChange={setAutoSync} />
        </SettingsItem>
      </SettingsSection>
    </div>
  );
}

function KnowledgeTab() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Knowledge</h2>
      <p className="text-sm text-[#71717a]">Knowledge base settings coming soon.</p>
    </div>
  );
}

function ConnectorsTab() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Connectors (MCP)</h2>
      <p className="text-sm text-[#71717a]">MCP connector settings coming soon.</p>
    </div>
  );
}

export default HomeSettingsModal;
