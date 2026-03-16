/**
 * Users Management Page
 * 
 * Server component that fetches user list and renders DataTable.
 * Uses server actions for mutations (ban, unban, delete, update plan).
 */

import { cookies } from 'next/headers';
import { verifyAdminToken, hasPermission } from '@/lib/auth';
import { getUsers } from '@/lib/api/admin';
import { UsersDataTable } from './UsersDataTable';
import { Header } from '@/components/layout';
import { Card, EmptyState } from '@/components/ui';
import { UsersExport } from '@/components/export/UsersExport';
import type { User, UserFilters } from '@/types';

export const dynamic = 'force-dynamic';

interface UsersPageProps {
  searchParams: Promise<{
    page?: string;
    search?: string;
    plan?: string;
    status?: string;
  }>;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const resolvedParams = await searchParams;
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

  if (!payload || !hasPermission(payload, 'users:read')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  // Build filters from search params
  const filters: UserFilters = {
    page: parseInt(resolvedParams.page || '1'),
    pageSize: 20,
    search: resolvedParams.search,
    plan: resolvedParams.plan as UserFilters['plan'],
    status: resolvedParams.status as UserFilters['status'],
  };

  // Fetch users from API
  let users: User[] = [];
  let total = 0;
  let totalPages = 1;
  let apiError: string | null = null;

  const response = await getUsers(filters);
  if (response.success && response.data) {
    users = response.data.users;
    total = response.data.total;
    totalPages = Math.ceil(total / response.data.pageSize);
  } else {
    apiError = response.error?.message || 'Failed to load users';
  }

  const canWrite = hasPermission(payload, 'users:write');
  const canDelete = hasPermission(payload, 'users:delete');

  return (
    <div className="space-y-6">
      <Header 
        title="User Management" 
        actions={
          <div className="flex items-center gap-4">
            <UsersExport users={users} disabled={users.length === 0} />
            <span className="text-sm text-gray-500">{total.toLocaleString()} total users</span>
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

      {users.length === 0 && !apiError ? (
        <Card className="p-8">
          <EmptyState
            title="No users found"
            description="Try adjusting your filters or search query"
          />
        </Card>
      ) : (
        <UsersDataTable
          users={users}
          filters={filters}
          totalPages={totalPages}
          canWrite={canWrite}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}
