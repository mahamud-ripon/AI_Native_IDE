/**
 * Settings Panel Component
 * 
 * Client component for managing admin settings.
 */

'use client';

import { useState, useTransition } from 'react';
import { Card, Button, Spinner } from '@/components/ui';
import type { AdminPayload } from '@/lib/auth';

interface SettingsPanelProps {
  admin: AdminPayload;
}

export function SettingsPanel({ admin }: SettingsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Profile settings state
  const [profile, setProfile] = useState({
    name: admin.email.split('@')[0],
    email: admin.email,
  });

  // Security settings state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  
  // Notification preferences
  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    systemAlerts: true,
    weeklyReports: true,
    criticalOnly: false,
  });

  const handleProfileSave = () => {
    startTransition(async () => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setNotification({ type: 'success', message: 'Profile updated successfully' });
    });
  };

  const handleToggle2FA = () => {
    startTransition(async () => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setTwoFactorEnabled(!twoFactorEnabled);
      setNotification({ type: 'success', message: `2FA ${twoFactorEnabled ? 'disabled' : 'enabled'}` });
    });
  };

  const handleNotificationSave = () => {
    startTransition(async () => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setNotification({ type: 'success', message: 'Notification preferences saved' });
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

      {/* Profile Settings */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Profile Settings</h2>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
            />
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <input
              type="text"
              value={admin.role}
              disabled
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
            />
          </div>
          <Button onClick={handleProfileSave} disabled={isPending}>
            {isPending ? <Spinner size="sm" /> : 'Save Changes'}
          </Button>
        </div>
      </Card>

      {/* Security Settings */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Security Settings</h2>
        <div className="space-y-4 max-w-md">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium">Two-Factor Authentication</p>
              <p className="text-sm text-gray-500">Add an extra layer of security to your account</p>
            </div>
            <button
              onClick={handleToggle2FA}
              disabled={isPending}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                twoFactorEnabled ? 'bg-success-500' : 'bg-gray-200'
              } ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
              role="switch"
              aria-checked={twoFactorEnabled}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  twoFactorEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium">Active Sessions</p>
              <p className="text-sm text-gray-500">Manage your active sessions</p>
            </div>
            <Button variant="secondary" size="sm">
              Manage
            </Button>
          </div>
        </div>
      </Card>

      {/* Notification Preferences */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Notification Preferences</h2>
        <div className="space-y-4 max-w-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Email Alerts</p>
              <p className="text-sm text-gray-500">Receive important alerts via email</p>
            </div>
            <input
              type="checkbox"
              checked={notifications.emailAlerts}
              onChange={(e) => setNotifications({ ...notifications, emailAlerts: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">System Alerts</p>
              <p className="text-sm text-gray-500">In-app notifications for system events</p>
            </div>
            <input
              type="checkbox"
              checked={notifications.systemAlerts}
              onChange={(e) => setNotifications({ ...notifications, systemAlerts: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Weekly Reports</p>
              <p className="text-sm text-gray-500">Receive weekly usage summary</p>
            </div>
            <input
              type="checkbox"
              checked={notifications.weeklyReports}
              onChange={(e) => setNotifications({ ...notifications, weeklyReports: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Critical Only</p>
              <p className="text-sm text-gray-500">Only notify for critical events</p>
            </div>
            <input
              type="checkbox"
              checked={notifications.criticalOnly}
              onChange={(e) => setNotifications({ ...notifications, criticalOnly: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
          </div>
          
          <Button onClick={handleNotificationSave} disabled={isPending}>
            {isPending ? <Spinner size="sm" /> : 'Save Preferences'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
