/**
 * Feature Flags Management Page
 * 
 * Server Component with RBAC check and data fetching.
 */

import { DashboardLayout } from '@/components/layout';
import { Card, Spinner, Badge, EmptyState } from '@/components/ui';
import { FeatureFlagsTable } from './FeatureFlagsTable';
import { getFeatureFlags } from '@/lib/api/admin';
import { verifyAdminToken, hasPermission } from '@/lib/auth';
import { cookies } from 'next/headers';
import type { FeatureFlag } from '@/types';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface FlagsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function FeatureFlagsPage({ searchParams }: FlagsPageProps) {
  const resolvedSearchParams = await searchParams;
  
  // RBAC check - only admins and superadmins
  const token = (await cookies()).get('admin-token')?.value;
  const payload = token ? await verifyAdminToken(token) : null;
  const hasAccess = payload ? hasPermission(payload, 'flags:read') : false;
  
  if (!hasAccess) {
    return (
      <DashboardLayout title="Access Denied">
        <Card className="p-8 text-center">
          <div className="text-danger-600 mb-4">
            <svg className="h-12 w-12 mx-auto" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You do not have permission to manage feature flags.</p>
        </Card>
      </DashboardLayout>
    );
  }

  // Fetch feature flags from API
  const result = await getFeatureFlags();
  const flags = result.success ? result.data!.flags : [];
  const total = result.success ? result.data!.total : 0;
  const apiError = !result.success ? result.error?.message : null;

  return (
    <DashboardLayout title="Feature Flags">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Feature Flags</h2>
            <p className="text-sm text-gray-500">
              Manage feature rollouts and toggles across the platform
            </p>
          </div>
          <Badge variant="info">{total} flags</Badge>
        </div>

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

        {/* Flags Table */}
        <Card>
          {flags.length === 0 && !apiError ? (
            <EmptyState
              title="No feature flags"
              description="No feature flags have been configured yet"
            />
          ) : (
            <FeatureFlagsTable initialFlags={flags} />
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
