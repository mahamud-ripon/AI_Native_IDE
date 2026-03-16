/**
 * Audit Logs Table (Client Component)
 */

'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Card, Badge, EmptyState, Button } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { AuditLog } from '@/types';

interface AuditLogsTableProps {
  logs: AuditLog[];
  page: number;
  totalPages: number;
  targetType: AuditLog['targetType'] | 'all';
}

export function AuditLogsTable({ logs, page, totalPages, targetType }: AuditLogsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');

  const handleTargetTypeChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === 'all') {
      params.delete('targetType');
    } else {
      params.set('targetType', value);
    }
    params.delete('page');
    router.push(`/audit?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    } else {
      params.delete('search');
    }
    params.delete('page');
    router.push(`/audit?${params.toString()}`);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    const params = new URLSearchParams(searchParams);
    params.delete('search');
    params.delete('page');
    router.push(`/audit?${params.toString()}`);
  };

  const actionVariant = (action: string): 'default' | 'info' | 'success' | 'warning' | 'danger' => {
    if (action.includes('DELETE')) return 'danger';
    if (action.includes('BAN') || action.includes('SUSPEND')) return 'warning';
    if (action.includes('UNBAN') || action.includes('RESTORE')) return 'success';
    if (action.includes('UPDATE') || action.includes('SETTINGS')) return 'info';
    return 'default';
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by admin email, action, or target ID..."
              className="w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
            {searchQuery && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClearSearch}>
                Clear
              </Button>
            )}
          </form>
          
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Filter by:</span>
            <select
              value={targetType}
              onChange={(e) => handleTargetTypeChange(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="user">User</option>
              <option value="project">Project</option>
              <option value="vm">VM</option>
              <option value="system">System</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {logs.length === 0 ? (
          <EmptyState
            title="No audit events"
            description="No matching events found for the selected filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Admin</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Target</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">IP</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">
                      {formatDate(log.timestamp, 'relative')}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <div className="font-medium text-gray-900">{log.adminEmail}</div>
                        <div className="text-xs text-gray-500">{log.adminId}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={actionVariant(log.action)}>{log.action}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="default">{log.targetType}</Badge>
                        <span className="text-gray-700">{log.targetId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{log.ipAddress}</td>
                    <td className="px-4 py-3">
                      <pre className="max-w-[520px] overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-100">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/audit?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(page - 1) }).toString()}`}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                >
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/audit?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(page + 1) }).toString()}`}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
