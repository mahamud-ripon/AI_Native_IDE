/**
 * Dashboard Layout
 * 
 * Wraps all dashboard pages with sidebar navigation.
 * Uses React Server Components for auth verification.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminToken } from '@/lib/auth';
import { DashboardLayout } from '@/components/layout';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin-token')?.value;

  if (!token) {
    redirect('/login');
  }

  const payload = await verifyAdminToken(token);

  if (!payload) {
    redirect('/login');
  }

  return (
    <DashboardLayout user={payload}>
      {children}
    </DashboardLayout>
  );
}
