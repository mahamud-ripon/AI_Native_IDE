/**
 * User Detail Page
 * 
 * Shows individual user details, projects, activity, and actions.
 */

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { verifyAdminToken, hasPermission } from '@/lib/auth';
import { getUser, getUserProjects } from '@/lib/api/admin';
import { UserDetail } from './UserDetail';
import type { User, Project } from '@/types';

export const dynamic = 'force-dynamic';

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = await params;
  
  const cookieStore = await cookies();
  const token = cookieStore.get('admin-token')?.value;

  if (!token) {
    redirect('/login');
  }

  const payload = await verifyAdminToken(token);

  if (!payload || !hasPermission(payload, 'users:read')) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  // Fetch user data
  const userResult = await getUser(id, token);
  
  if (!userResult.success || !userResult.data) {
    notFound();
  }

  const user = userResult.data.user;
  
  // Fetch user projects
  const projectsResult = await getUserProjects(id, token);
  const projects = projectsResult.success && projectsResult.data ? projectsResult.data.projects : [];

  const canWrite = hasPermission(payload, 'users:write');
  const canDelete = hasPermission(payload, 'users:delete');

  return (
    <UserDetail 
      user={user} 
      projects={projects}
      canWrite={canWrite}
      canDelete={canDelete}
    />
  );
}
