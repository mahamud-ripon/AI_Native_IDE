/**
 * Forbidden Page
 * 
 * Shown when an authenticated admin lacks permission to access a route.
 */

import Link from 'next/link';
import { Card, Button } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <Card className="w-full max-w-lg p-8">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-danger-50 flex items-center justify-center text-danger-600">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v4a1 1 0 102 0V7zm-1 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 15z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Access Denied</h1>
              <p className="text-sm text-gray-600">You don’t have permission to view this page.</p>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4 text-sm text-gray-700">
            If you believe this is a mistake, request access from a superadmin.
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Link href="/">
              <Button variant="secondary" className="w-full sm:w-auto">
                Go to Dashboard
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost" className="w-full sm:w-auto">
                Switch Account
              </Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
