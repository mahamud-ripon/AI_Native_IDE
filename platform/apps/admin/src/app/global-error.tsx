/**
 * Global Error Boundary
 */

'use client';

import Link from 'next/link';
import { Card, Button } from '@/components/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <Card className="w-full max-w-lg p-8">
            <div className="space-y-4">
              <h1 className="text-xl font-semibold text-gray-900">Application Error</h1>
              <p className="text-sm text-gray-600">
                An unrecoverable error occurred.
              </p>
              <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                {error.message}
              </pre>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => reset()} className="w-full sm:w-auto">
                  Try again
                </Button>
                <Link href="/">
                  <Button variant="ghost" className="w-full sm:w-auto">Go to Dashboard</Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </body>
    </html>
  );
}
