/**
 * Feature Flags Table (Client Component)
 * 
 * Interactive table with toggle switches and edit capabilities.
 */

'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Spinner, Card } from '@/components/ui';
import { toggleFeatureFlag, bulkToggleFeatureFlags } from '@/lib/api/admin';
import type { FeatureFlag } from '@/types';

interface FeatureFlagsTableProps {
  initialFlags: FeatureFlag[];
}

export function FeatureFlagsTable({ initialFlags }: FeatureFlagsTableProps) {
  const [flags, setFlags] = useState<FeatureFlag[]>(initialFlags);
  const [isPending, startTransition] = useTransition();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Filter flags by search query
  const filteredFlags = flags.filter(flag => 
    flag.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    flag.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleToggle = (flagId: string, currentEnabled: boolean) => {
    setUpdatingId(flagId);
    startTransition(async () => {
      const result = await toggleFeatureFlag(flagId, !currentEnabled);
      if (result.success) {
        setFlags(prev =>
          prev.map(f =>
            f.id === flagId
              ? { ...f, enabled: !currentEnabled, updatedAt: new Date().toISOString() }
              : f
          )
        );
      }
      setUpdatingId(null);
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredFlags.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredFlags.map(f => f.id)));
    }
  };

  const handleSelectFlag = (flagId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(flagId)) {
      newSelected.delete(flagId);
    } else {
      newSelected.add(flagId);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkToggle = (enable: boolean) => {
    if (selectedIds.size === 0) return;
    
    startTransition(async () => {
      const result = await bulkToggleFeatureFlags(Array.from(selectedIds), enable);
      if (result.success) {
        setFlags(prev =>
          prev.map(f =>
            selectedIds.has(f.id)
              ? { ...f, enabled: enable, updatedAt: new Date().toISOString() }
              : f
          )
        );
        setNotification({ type: 'success', message: `${selectedIds.size} flags ${enable ? 'enabled' : 'disabled'}` });
        setSelectedIds(new Set());
      } else {
        setNotification({ type: 'error', message: 'Failed to update flags' });
      }
    });
  };

  const formatRollout = (percentage: number) => {
    if (percentage === 100) return 'All users';
    if (percentage === 0) return 'No users';
    return `${percentage}% of users`;
  };

  const formatTargeting = (flag: FeatureFlag) => {
    const targets: string[] = [];
    
    if (flag.targetPlans && flag.targetPlans.length > 0) {
      targets.push(`Plans: ${flag.targetPlans.join(', ')}`);
    }
    
    if (flag.targetUsers && flag.targetUsers.length > 0) {
      targets.push(`${flag.targetUsers.length} specific users`);
    }
    
    return targets.length > 0 ? targets.join(' • ') : 'All users';
  };

  return (
    <div className="space-y-4">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 shadow-lg ${
          notification.type === 'success' 
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {notification.message}
        </div>
      )}

      {/* Search and Bulk Actions */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or key..."
              className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            {searchQuery && (
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                Clear
              </Button>
            )}
          </div>
          
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{selectedIds.size} selected</span>
              <Button variant="secondary" size="sm" onClick={() => handleBulkToggle(true)}>
                Enable All
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleBulkToggle(false)}>
                Disable All
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Table */}
      <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <input
                type="checkbox"
                checked={selectedIds.size === filteredFlags.length && filteredFlags.length > 0}
                onChange={handleSelectAll}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                aria-label="Select all flags"
              />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Flag
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Rollout
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Targeting
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Last Updated
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {filteredFlags.map((flag) => {
            const isUpdating = updatingId === flag.id;
            
            return (
              <tr key={flag.id} className="hover:bg-gray-50">
                <td className="px-4 py-4 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(flag.id)}
                    onChange={() => handleSelectFlag(flag.id)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    aria-label={`Select ${flag.name}`}
                  />
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <Badge variant={flag.enabled ? 'success' : 'default'}>
                    {flag.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </td>
                <td className="px-4 py-4">
                  <div>
                    <div className="font-medium text-gray-900">{flag.name}</div>
                    <div className="text-sm text-gray-500">{flag.key}</div>
                    {flag.description && (
                      <div className="text-xs text-gray-400 mt-1">{flag.description}</div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          flag.enabled ? 'bg-success-500' : 'bg-gray-400'
                        }`}
                        style={{ width: `${flag.rolloutPercentage}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-600">
                      {formatRollout(flag.rolloutPercentage)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span className="text-sm text-gray-600">{formatTargeting(flag)}</span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(flag.updatedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-2">
                    {isUpdating && <Spinner size="sm" />}
                    <button
                      onClick={() => handleToggle(flag.id, flag.enabled)}
                      disabled={isPending}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                        flag.enabled ? 'bg-success-500' : 'bg-gray-200'
                      } ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                      role="switch"
                      aria-checked={flag.enabled}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          flag.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      
      {filteredFlags.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          {searchQuery ? 'No flags match your search' : 'No feature flags found'}
        </div>
      )}
      </div>
    </div>
  );
}
