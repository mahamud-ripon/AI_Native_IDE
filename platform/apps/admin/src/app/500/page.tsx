/**
 * Internal Server Error Page
 * 
 * Can be linked to from error boundaries or manual redirects.
 */

import Link from 'next/link';
import { Card, Button } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default function ServerErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <Card className="w-full max-w-lg p-8">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-yellow-50 flex items-center justify-center text-yellow-700">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.721-1.36 3.486 0l6.518 11.59c.75 1.334-.213 2.987-1.742 2.987H3.48c-1.53 0-2.492-1.653-1.742-2.987l6.52-11.59zM11 14a1 1 0 10-2 0 1 1 0 002 0zm-1-7a1 1 0 00-1 1v3a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
              <p className="text-sm text-gray-600">We hit an unexpected error while loading the admin panel.</p>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4 text-sm text-gray-700">
            Try refreshing the page. If the issue persists, check logs and recent deployments.
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Link href="/">
              <Button variant="secondary" className="w-full sm:w-auto">
                Go to Dashboard
              </Button>
            </Link>
            <a href="/500" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto">Reload</Button>
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}
