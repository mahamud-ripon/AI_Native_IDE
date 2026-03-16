/**
 * Users Data Table (Client Component)
 * 
 * Interactive table with search, filters, actions, and bulk operations.
 * Uses server actions for mutations.
 */

'use client';

import { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { Button, Badge, Card, Spinner, EmptyState } from '@/components/ui';
import { BulkActionBar, type BulkAction } from '@/components/ui/BulkActionBar';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { 
  BulkSelectionProvider, 
  useBulkSelection, 
  useRowSelection 
} from '@/contexts/BulkSelectionContext';
import { banUser, unbanUser, updateUserPlan, deleteUser } from './actions';
import { bulkBanUsers, bulkUnbanUsers, bulkDeleteUsers } from '@/lib/api/admin';
import type { User, UserFilters } from '@/types';

interface UsersDataTableProps {
  users: User[];
  filters: UserFilters;
  totalPages: number;
  canWrite: boolean;
  canDelete: boolean;
}

function UsersDataTableInner({
  users,
  filters,
  totalPages,
  canWrite,
  canDelete,
}: UsersDataTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const {
    selectedIds,
    hasSelection,
    isAllSelected,
    toggleItem,
    toggleAll,
    clearSelection,
    setAllItems,
    getSelectedItems,
  } = useBulkSelection<User>();

  // Update all items when users change
  useEffect(() => {
    setAllItems(users);
  }, [users, setAllItems]);

  // Auto-hide notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const search = formData.get('search') as string;
    
    const params = new URLSearchParams(searchParams);
    if (search) {
      params.set('search', search);
    } else {
      params.delete('search');
    }
    params.delete('page');
    
    router.push(`/users?${params.toString()}`);
  };

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value && value !== 'all') {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    
    router.push(`/users?${params.toString()}`);
  };

  const handleBan = (userId: string, currentlyBanned: boolean) => {
    startTransition(async () => {
      const result = currentlyBanned
        ? await unbanUser(userId)
        : await banUser(userId, 'Admin action');
      
      if (result.success) {
        router.refresh();
      } else {
        setNotification({ type: 'error', message: result.error || 'Action failed' });
      }
    });
  };

  const handlePlanUpdate = (userId: string, plan: User['plan']) => {
    startTransition(async () => {
      const result = await updateUserPlan(userId, plan);
      
      if (result.success) {
        setShowPlanModal(false);
        setSelectedUser(null);
        router.refresh();
      } else {
        setNotification({ type: 'error', message: result.error || 'Failed to update plan' });
      }
    });
  };

  const handleDelete = (userId: string) => {
    startTransition(async () => {
      const result = await deleteUser(userId);
      
      if (result.success) {
        setShowDeleteModal(false);
        setSelectedUser(null);
        router.refresh();
      } else {
        setNotification({ type: 'error', message: result.error || 'Failed to delete user' });
      }
    });
  };

  // Bulk actions
  const bulkActions: BulkAction[] = [
    {
      id: 'ban',
      label: 'Ban Selected',
      variant: 'danger',
      isDestructive: true,
      confirmation: {
        title: 'Ban Users',
        message: 'Are you sure you want to ban the selected users? They will lose access immediately.',
        variant: 'warning',
      },
      onExecute: async (ids) => {
        const result = await bulkBanUsers(ids, 'Admin bulk action');
        if (result.success && result.data) {
          const { succeeded, failed } = result.data;
          if (failed.length > 0) {
            setNotification({ 
              type: 'error', 
              message: `Banned ${succeeded.length} users. Failed: ${failed.length}` 
            });
          } else {
            setNotification({ 
              type: 'success', 
              message: `Successfully banned ${succeeded.length} users` 
            });
          }
          router.refresh();
          return { success: true };
        }
        return { success: false, error: result.error?.message };
      },
    },
    {
      id: 'unban',
      label: 'Unban Selected',
      variant: 'secondary',
      onExecute: async (ids) => {
        const result = await bulkUnbanUsers(ids);
        if (result.success && result.data) {
          const { succeeded, failed } = result.data;
          if (failed.length > 0) {
            setNotification({ 
              type: 'error', 
              message: `Unbanned ${succeeded.length} users. Failed: ${failed.length}` 
            });
          } else {
            setNotification({ 
              type: 'success', 
              message: `Successfully unbanned ${succeeded.length} users` 
            });
          }
          router.refresh();
          return { success: true };
        }
        return { success: false, error: result.error?.message };
      },
    },
    {
      id: 'delete',
      label: 'Delete Selected',
      variant: 'danger',
      isDestructive: true,
      confirmation: {
        title: 'Delete Users',
        message: 'Are you sure you want to permanently delete the selected users? This action cannot be undone.',
        variant: 'danger',
      },
      onExecute: async (ids) => {
        const result = await bulkDeleteUsers(ids);
        if (result.success && result.data) {
          const { succeeded, failed } = result.data;
          if (failed.length > 0) {
            setNotification({ 
              type: 'error', 
              message: `Deleted ${succeeded.length} users. Failed: ${failed.length}` 
            });
          } else {
            setNotification({ 
              type: 'success', 
              message: `Successfully deleted ${succeeded.length} users` 
            });
          }
          router.refresh();
          return { success: true };
        }
        return { success: false, error: result.error?.message };
      },
    },
  ];

  // Filter actions based on permissions
  const availableActions = bulkActions.filter((action) => {
    if (action.id === 'delete') return canDelete;
    return canWrite;
  });

  return (
    <div className="space-y-4">
      {/* Notification */}
      {notification && (
        <div 
          className={cn(
            "fixed top-4 right-4 z-50 rounded-lg px-4 py-3 shadow-lg animate-slide-down",
            notification.type === 'success' 
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-red-50 border border-red-200 text-red-800"
          )}
        >
          {notification.message}
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              name="search"
              defaultValue={filters.search}
              placeholder="Search by email or name..."
              className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={filters.plan || 'all'}
              onChange={(e) => handleFilterChange('plan', e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Plans</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>

            <select
              value={filters.status || 'all'}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Banned</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden relative">
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
            <Spinner size="lg" />
          </div>
        )}

        {users.length === 0 ? (
          <EmptyState
            title="No users found"
            description="Try adjusting your search or filters"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      aria-label="Select all users"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Plan</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tokens Used</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Projects</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Last Active</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isSelected={selectedIds.has(user.id)}
                    onToggleSelect={() => toggleItem(user.id)}
                    canWrite={canWrite}
                    canDelete={canDelete}
                    onBan={handleBan}
                    onPlanChange={() => {
                      setSelectedUser(user);
                      setShowPlanModal(true);
                    }}
                    onDelete={() => {
                      setSelectedUser(user);
                      setShowDeleteModal(true);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-gray-600">
              Page {filters.page} of {totalPages}
            </p>
            <div className="flex gap-2">
              {filters.page > 1 && (
                <Link
                  href={`/users?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(filters.page - 1) }).toString()}`}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                >
                  Previous
                </Link>
              )}
              {filters.page < totalPages && (
                <Link
                  href={`/users?${new URLSearchParams({ ...Object.fromEntries(searchParams), page: String(filters.page + 1) }).toString()}`}
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Bulk Action Bar */}
      {hasSelection && (
        <BulkActionBar
          selectionType="user"
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          actions={availableActions}
          onClearSelection={clearSelection}
        />
      )}

      {/* Plan Change Modal */}
      {showPlanModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold">Change Plan for {selectedUser.email}</h3>
            <p className="mt-2 text-sm text-gray-600">
              Current plan: <Badge>{selectedUser.plan}</Badge>
            </p>
            <div className="mt-4 space-y-2">
              {(['free', 'pro', 'enterprise'] as const).map((plan) => (
                <Button
                  key={plan}
                  variant={selectedUser.plan === plan ? 'primary' : 'secondary'}
                  className="w-full justify-center"
                  onClick={() => handlePlanUpdate(selectedUser.id, plan)}
                  disabled={selectedUser.plan === plan}
                >
                  {plan.charAt(0).toUpperCase() + plan.slice(1)}
                </Button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="ghost" onClick={() => setShowPlanModal(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedUser && (
        <ConfirmationDialog
          isOpen={showDeleteModal}
          title="Delete User"
          message={`Are you sure you want to delete ${selectedUser.email}? This action cannot be undone.`}
          variant="danger"
          confirmText="Delete User"
          onConfirm={() => handleDelete(selectedUser.id)}
          onCancel={() => setShowDeleteModal(false)}
          isLoading={isPending}
        />
      )}
    </div>
  );
}

// Separate row component for better performance
interface UserRowProps {
  user: User;
  isSelected: boolean;
  onToggleSelect: () => void;
  canWrite: boolean;
  canDelete: boolean;
  onBan: (userId: string, currentlyBanned: boolean) => void;
  onPlanChange: () => void;
  onDelete: () => void;
}

function UserRow({
  user,
  isSelected,
  onToggleSelect,
  canWrite,
  canDelete,
  onBan,
  onPlanChange,
  onDelete,
}: UserRowProps) {
  return (
    <tr className={cn("hover:bg-gray-50", isSelected && "bg-primary-50")}>
      <td className="w-12 px-4 py-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          aria-label={`Select ${user.email}`}
        />
      </td>
      <td className="px-4 py-3">
        <div>
          <p className="font-medium text-gray-900">{user.name}</p>
          <p className="text-gray-500">{user.email}</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge
          variant={
            user.plan === 'enterprise'
              ? 'success'
              : user.plan === 'pro'
              ? 'info'
              : 'default'
          }
        >
          {user.plan}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <Badge variant={user.status === 'active' ? 'success' : 'danger'}>
          {user.status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-gray-600">
        {formatNumber(user.tokensUsed)}
      </td>
      <td className="px-4 py-3 text-gray-600">
        {user.projectsCount}
      </td>
      <td className="px-4 py-3 text-gray-600">
        {formatDate(user.lastActiveAt, 'relative')}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          {canWrite && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onBan(user.id, user.status === 'banned')}
                className={cn(
                  user.status === 'banned' ? 'text-success-600' : 'text-danger-600'
                )}
              >
                {user.status === 'banned' ? 'Unban' : 'Ban'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onPlanChange}
              >
                Change Plan
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger-600"
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Wrapper component with provider
export function UsersDataTable(props: UsersDataTableProps) {
  return (
    <BulkSelectionProvider selectionType="user" getKey={(user) => (user as User).id}>
      <UsersDataTableInner {...props} />
    </BulkSelectionProvider>
  );
}
