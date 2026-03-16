/**
 * Dashboard Segment Error Boundary
 */

'use client';

import Link from 'next/link';
import { Card, Button } from '@/components/ui';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-lg p-8">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Dashboard Error</h2>
          <p className="text-sm text-gray-600">
            Something failed while rendering this dashboard section.
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
            {error.message}
          </pre>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => reset()} className="w-full sm:w-auto">
              Retry
            </Button>
            <Link href="/">
              <Button variant="ghost" className="w-full sm:w-auto">Back to Dashboard</Button>
            </Link>
            <Link href="/500">
              <Button className="w-full sm:w-auto">Open 500 Page</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
