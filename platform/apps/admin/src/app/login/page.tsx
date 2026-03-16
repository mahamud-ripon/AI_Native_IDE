/**
 * Login Page
 * 
 * Handles admin authentication via JWT token.
 * In development, provides dev login for testing.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Check if already logged in
  const cookieStore = await cookies();
  const token = cookieStore.get('admin-token')?.value;

  if (token) {
    // Verify token is valid
    const { verifyAdminToken } = await import('@/lib/auth');
    const payload = await verifyAdminToken(token);
    
    if (payload) {
      redirect('/');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        {/* Logo */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign in to access the dashboard
          </p>
        </div>

        {/* Login Form */}
        <LoginForm />

        {/* Footer */}
        <div className="text-center text-xs text-gray-500">
          <p>Secure admin access only</p>
          <p className="mt-1">All actions are logged for audit purposes</p>
        </div>
      </div>
    </div>
  );
}
