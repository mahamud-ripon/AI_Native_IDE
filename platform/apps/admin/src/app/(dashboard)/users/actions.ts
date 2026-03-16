/**
 * Server Actions for User Management
 * 
 * All destructive actions use 'use server' directive.
 * Re-validates admin auth before executing.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { verifyAdminToken, hasPermission } from '@/lib/auth';

const API_BASE = process.env.API_GATEWAY_URL || 'http://localhost:8000';

/**
 * Get admin headers with auth token
 */
async function getAdminHeaders() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin-token')?.value;
  
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  const payload = await verifyAdminToken(token);
  
  if (!payload) {
    throw new Error('Invalid session');
  }
  
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.ADMIN_API_KEY || ''}`,
    'X-Admin-Id': payload.sub,
    'X-Admin-Email': payload.email,
  };
}

/**
 * Log admin action to audit trail
 */
async function logAuditEvent(
  action: string,
  targetType: 'user' | 'project' | 'vm' | 'system',
  targetId: string,
  details: Record<string, unknown>
) {
  try {
    const headers = await getAdminHeaders();
    
    await fetch(`${API_BASE}/api/v1/admin/audit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action,
        targetType,
        targetId,
        details,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

// ============================================
// User Management Actions
// ============================================

export async function banUser(
  userId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const payload = await verifyAdminToken(token);
    
    if (!payload || !hasPermission(payload, 'users:write')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const headers = await getAdminHeaders();
    
    const response = await fetch(`${API_BASE}/api/v1/admin/users/${userId}/ban`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return { success: false, error: error.message || 'Failed to ban user' };
    }
    
    // Log audit event
    await logAuditEvent('ban_user', 'user', userId, { reason });
    
    revalidatePath('/users');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function unbanUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const payload = await verifyAdminToken(token);
    
    if (!payload || !hasPermission(payload, 'users:write')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const headers = await getAdminHeaders();
    
    const response = await fetch(`${API_BASE}/api/v1/admin/users/${userId}/unban`, {
      method: 'POST',
      headers,
    });
    
    if (!response.ok) {
      return { success: false, error: 'Failed to unban user' };
    }
    
    await logAuditEvent('unban_user', 'user', userId, {});
    
    revalidatePath('/users');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function updateUserPlan(
  userId: string,
  plan: 'free' | 'pro' | 'enterprise'
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const payload = await verifyAdminToken(token);
    
    if (!payload || !hasPermission(payload, 'users:write')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const headers = await getAdminHeaders();
    
    const response = await fetch(`${API_BASE}/api/v1/admin/users/${userId}/plan`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ plan }),
    });
    
    if (!response.ok) {
      return { success: false, error: 'Failed to update plan' };
    }
    
    await logAuditEvent('update_plan', 'user', userId, { newPlan: plan });
    
    revalidatePath('/users');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const payload = await verifyAdminToken(token);
    
    if (!payload || !hasPermission(payload, 'users:delete')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const headers = await getAdminHeaders();
    
    const response = await fetch(`${API_BASE}/api/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers,
    });
    
    if (!response.ok) {
      return { success: false, error: 'Failed to delete user' };
    }
    
    await logAuditEvent('delete_user', 'user', userId, {});
    
    revalidatePath('/users');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================
// VM Management Actions
// ============================================

export async function restartVm(
  vmId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const payload = await verifyAdminToken(token);
    
    if (!payload || !hasPermission(payload, 'infrastructure:write')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const headers = await getAdminHeaders();
    
    const response = await fetch(`${API_BASE}/api/v1/admin/infrastructure/vms/${vmId}/restart`, {
      method: 'POST',
      headers,
    });
    
    if (!response.ok) {
      return { success: false, error: 'Failed to restart VM' };
    }
    
    await logAuditEvent('restart_vm', 'vm', vmId, {});
    
    revalidatePath('/infrastructure');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function stopVm(
  vmId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const payload = await verifyAdminToken(token);
    
    if (!payload || !hasPermission(payload, 'infrastructure:write')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const headers = await getAdminHeaders();
    
    const response = await fetch(`${API_BASE}/api/v1/admin/infrastructure/vms/${vmId}/stop`, {
      method: 'POST',
      headers,
    });
    
    if (!response.ok) {
      return { success: false, error: 'Failed to stop VM' };
    }
    
    await logAuditEvent('stop_vm', 'vm', vmId, {});
    
    revalidatePath('/infrastructure');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================
// Authentication Actions
// ============================================

export async function logout(): Promise<{ success: boolean }> {
  const cookieStore = await cookies();
  cookieStore.delete('admin-token');
  
  return { success: true };
}

export async function devLogin(
  role: 'admin' | 'superadmin' = 'admin'
): Promise<{ success: boolean; error?: string }> {
  // Only works in development
  if (process.env.NODE_ENV === 'production') {
    return { success: false, error: 'Not available in production' };
  }
  
  try {
    const { generateDevToken } = await import('@/lib/auth');
    const token = await generateDevToken(role);
    
    const cookieStore = await cookies();
    cookieStore.set('admin-token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
    });
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Token-based login for production
 * Validates a JWT token provided by external auth system
 */
export async function tokenLogin(
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify the token is valid
    const payload = await verifyAdminToken(token);
    
    if (!payload) {
      return { success: false, error: 'Invalid or expired token' };
    }
    
    // Set the token as a cookie
    const cookieStore = await cookies();
    cookieStore.set('admin-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
    });
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Authentication failed' };
  }
}
