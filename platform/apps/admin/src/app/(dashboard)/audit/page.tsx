/**
 * Audit Logs Page
 * 
 * Server component that fetches audit logs and renders a client table.
 * Enforces RBAC via server-side permission checks.
 */

import { cookies } from 'next/headers';
import { verifyAdminToken, hasPermission } from '@/lib/auth';
import { getAuditLogs } from '@/lib/api/admin';
import { Header } from '@/components/layout';
import { Card, EmptyState } from '@/components/ui';
import { AuditLogsTable } from './AuditLogsTable';
import { AuditLogsExport } from '@/components/export/ExportButtons';
import type { AuditLog } from '@/types';

export const dynamic = 'force-dynamic';

interface AuditPageProps {
  searchParams: Promise<{
    page?: string;
    targetType?: AuditLog['targetType'] | 'all';
  }>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const resolved = await searchParams;

  const cookieStore = await cookies();
  const token = cookieStore.get('admin-token')?.value;

  if (!token) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Authentication required. Please log in.</p>
      </div>
    );
  }

  const payload = await verifyAdminToken(token);

  if (!payload || !hasPermission(payload, 'audit:read')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  const page = Math.max(1, parseInt(resolved.page || '1'));
  const pageSize = 50;
  const targetType = resolved.targetType && resolved.targetType !== 'all' ? resolved.targetType : undefined;

  // Fetch audit logs from API
  let logs: AuditLog[] = [];
  let total = 0;
  let totalPages = 1;
  let apiError: string | null = null;

  const response = await getAuditLogs(page, pageSize, targetType);
  if (response.success && response.data) {
    logs = response.data.logs;
    total = response.data.total;
    totalPages = Math.max(1, Math.ceil(total / response.data.pageSize));
  } else {
    apiError = response.error?.message || 'Failed to load audit logs';
  }

  return (
    <div className="space-y-6">
      <Header
        title="Audit Logs"
        actions={
          <div className="flex items-center gap-4">
            <AuditLogsExport logs={logs} filters={{ targetType }} />
            <div className="text-sm text-gray-500">
              {total.toLocaleString()} total events
            </div>
          </div>
        }
      />

      {apiError && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium text-yellow-800">{apiError}</span>
          </div>
        </div>
      )}

      {logs.length === 0 && !apiError ? (
        <Card className="p-8">
          <EmptyState
            title="No audit logs found"
            description="No logs match the current filter criteria"
          />
        </Card>
      ) : (
        <AuditLogsTable
          logs={logs}
          page={page}
          totalPages={totalPages}
          targetType={resolved.targetType || 'all'}
        />
      )}
    </div>
  );
}
