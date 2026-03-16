/**
 * Login Form (Client Component)
 * 
 * Handles authentication via dev login in development,
 * or token-based authentication in production.
 */

'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Spinner } from '@/components/ui';
import { devLogin, tokenLogin } from '@/app/(dashboard)/users/actions';

export function LoginForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');

  const handleDevLogin = (role: 'admin' | 'superadmin') => {
    startTransition(async () => {
      setError(null);
      const result = await devLogin(role);
      
      if (result.success) {
        // Use replace instead of push to avoid NEXT_REDIRECT error
        window.location.href = '/';
      } else {
        setError(result.error || 'Login failed');
      }
    });
  };

  const handleTokenLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!token.trim()) {
      setError('Please enter a valid token');
      return;
    }
    
    startTransition(async () => {
      setError(null);
      const result = await tokenLogin(token.trim());
      
      if (result.success) {
        // Use direct navigation to avoid NEXT_REDIRECT error
        window.location.href = '/';
      } else {
        setError(result.error || 'Invalid token');
      }
    });
  };

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <Card className="p-8">
      {isDev ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-center">Development Login</h2>
          <p className="text-sm text-gray-600 text-center">
            Quick login for development testing
          </p>
          
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => handleDevLogin('admin')}
              disabled={isPending}
              className="w-full"
            >
              {isPending ? <Spinner size="sm" /> : 'Login as Admin'}
            </Button>
            <Button
              onClick={() => handleDevLogin('superadmin')}
              disabled={isPending}
              variant="secondary"
              className="w-full"
            >
              {isPending ? <Spinner size="sm" /> : 'Login as Super Admin'}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-danger-600 text-center">{error}</p>
          )}
        </div>
      ) : (
        <form onSubmit={handleTokenLogin} className="space-y-4">
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-700">
              Admin Token
            </label>
            <input
              type="password"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your admin token"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <Button type="submit" disabled={isPending || !token} className="w-full">
            {isPending ? <Spinner size="sm" /> : 'Sign In'}
          </Button>

          {error && (
            <p className="text-sm text-danger-600 text-center">{error}</p>
          )}
        </form>
      )}
    </Card>
  );
}
