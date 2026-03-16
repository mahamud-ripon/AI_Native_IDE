/**
 * Settings Page
 * 
 * Admin profile settings, security settings, and notification preferences.
 */

import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/auth';
import { SettingsPanel } from './SettingsPanel';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
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

  if (!payload) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Invalid session. Please log in again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your admin account settings</p>
      </div>

      <SettingsPanel admin={payload} />
    </div>
  );
}
