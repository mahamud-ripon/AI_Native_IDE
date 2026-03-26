/**
 * Centralized Auth Token Management
 *
 * Single source of truth for reading/writing auth tokens.
 * All modules should use this instead of raw localStorage.getItem calls.
 */

const ACCESS_TOKEN_KEY = 'access_token';
const AUTH_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

/**
 * Get the access token from storage.
 * Checks both 'access_token' and 'auth_token' keys for backward compatibility.
 */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Get the refresh token from storage.
 */
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Store tokens after login/refresh.
 */
export function setTokens(accessToken: string, refreshToken?: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

/**
 * Clear all auth tokens from storage.
 */
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * Build Authorization header value.
 */
export function authHeader(): { Authorization: string } | Record<string, never> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
