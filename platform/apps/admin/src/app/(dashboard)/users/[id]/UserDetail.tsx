/**
 * User Detail Component
 * 
 * Displays user information, projects, activity, and quick actions.
 */

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { banUser, unbanUser, updateUserPlan, deleteUser } from '../actions';
import { formatDate, formatNumber } from '@/lib/utils';
import type { User, Project } from '@/types';

interface UserDetailProps {
  user: User;
  projects: Project[];
  canWrite: boolean;
  canDelete: boolean;
}

export function UserDetail({ user, projects, canWrite, canDelete }: UserDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleBan = () => {
    startTransition(async () => {
      const result = user.status === 'banned' 
        ? await unbanUser(user.id)
        : await banUser(user.id, 'Admin action from user detail');
      
      if (result.success) {
        setNotification({ type: 'success', message: `User ${user.status === 'banned' ? 'unbanned' : 'banned'} successfully` });
        router.refresh();
      } else {
        setNotification({ type: 'error', message: result.error || 'Action failed' });
      }
    });
  };

  const handlePlanUpdate = (plan: User['plan']) => {
    startTransition(async () => {
      const result = await updateUserPlan(user.id, plan);
      
      if (result.success) {
        setShowPlanModal(false);
        setNotification({ type: 'success', message: `Plan updated to ${plan}` });
        router.refresh();
      } else {
        setNotification({ type: 'error', message: result.error || 'Failed to update plan' });
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteUser(user.id);
      
      if (result.success) {
        router.push('/users');
        router.refresh();
      } else {
        setNotification({ type: 'error', message: result.error || 'Failed to delete user' });
      }
    });
  };

  return (
    <div className="space-y-6">
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

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/users" className="text-gray-500 hover:text-gray-700">Users</Link>
        <span className="text-gray-300">/</span>
        <span className="font-medium text-gray-900">{user.email}</span>
      </div>

      {/* User Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary-500 flex items-center justify-center text-white text-2xl font-bold">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
              <p className="text-gray-500">{user.email}</p>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant={user.status === 'active' ? 'success' : 'danger'}>
                  {user.status}
                </Badge>
                <Badge variant={
                  user.plan === 'enterprise' ? 'success' :
                  user.plan === 'pro' ? 'info' : 'default'
                }>
                  {user.plan}
                </Badge>
              </div>
            </div>
          </div>
          
          {(canWrite || canDelete) && (
            <div className="flex items-center gap-2">
              {canWrite && (
                <>
                  <Button
                    variant="ghost"
                    onClick={handleBan}
                    disabled={isPending}
                    className={user.status === 'banned' ? 'text-success-600' : 'text-danger-600'}
                  >
                    {user.status === 'banned' ? 'Unban' : 'Ban'}
                  </Button>
                  <Button variant="secondary" onClick={() => setShowPlanModal(true)}>
                    Change Plan
                  </Button>
                </>
              )}
              {canDelete && (
                <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Tokens Used</p>
          <p className="text-2xl font-bold">{formatNumber(user.tokensUsed)}</p>
          <p className="text-xs text-gray-400">of {formatNumber(user.tokensLimit)} limit</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Projects</p>
          <p className="text-2xl font-bold">{user.projectsCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Member Since</p>
          <p className="text-lg font-medium">{formatDate(user.createdAt)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Last Active</p>
          <p className="text-lg font-medium">{formatDate(user.lastActiveAt, 'relative')}</p>
        </Card>
      </div>

      {/* Projects List */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Projects</h2>
        {projects.length === 0 ? (
          <EmptyState title="No projects" description="This user has not created any projects yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Agents</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tokens</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{project.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant={project.status === 'active' ? 'success' : 'default'}>
                        {project.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{project.agentCount}</td>
                    <td className="px-4 py-3">{formatNumber(project.tokensUsed)}</td>
                    <td className="px-4 py-3">{formatDate(project.lastActivityAt, 'relative')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Plan Change Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold">Change Plan for {user.email}</h3>
            <p className="mt-2 text-sm text-gray-600">
              Current plan: <Badge>{user.plan}</Badge>
            </p>
            <div className="mt-4 space-y-2">
              {(['free', 'pro', 'enterprise'] as const).map((plan) => (
                <Button
                  key={plan}
                  variant={user.plan === plan ? 'primary' : 'secondary'}
                  className="w-full justify-center"
                  onClick={() => handlePlanUpdate(plan)}
                  disabled={user.plan === plan || isPending}
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
      {showDeleteModal && (
        <ConfirmationDialog
          isOpen={showDeleteModal}
          title="Delete User"
          message={`Are you sure you want to delete ${user.email}? This action cannot be undone.`}
          variant="danger"
          confirmText="Delete User"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteModal(false)}
          isLoading={isPending}
        />
      )}
    </div>
  );
}
