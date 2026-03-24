import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this file for reliable path resolution
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try multiple possible locations for the auth-service key file
const POSSIBLE_KEY_PATHS = [
  // When running from turbo (platform root)
  path.join(process.cwd(), 'services', 'auth-service', '.jwt-keys.json'),
  // When running standalone from project-service
  path.join(process.cwd(), '..', '..', 'services', 'auth-service', '.jwt-keys.json'),
  // Relative to this file
  path.join(__dirname, '..', '..', '..', '..', 'services', 'auth-service', '.jwt-keys.json'),
];

function findKeyFile(): string | null {
  for (const keyPath of POSSIBLE_KEY_PATHS) {
    try {
      if (fs.existsSync(keyPath)) {
        console.log('[JWT] Found key file at:', keyPath);
        return keyPath;
      }
    } catch {
      // Continue to next path
    }
  }
  console.warn('[JWT] Key file not found in any location');
  return null;
}

function loadPublicKey(): string {
  // 1. Try environment variable first
  if (process.env.JWT_PUBLIC_KEY) {
    return process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
  }

  // 2. Try to load from auth-service's key file
  const keyFile = findKeyFile();
  if (keyFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      if (saved.publicKey) {
        return saved.publicKey;
      }
    } catch {
      console.warn('[JWT] Failed to parse key file');
    }
  }

  console.warn('[JWT] No public key available - JWT verification disabled');
  return '';
}

const publicKey = loadPublicKey();

export const JwtVerifier = {
  verifyAccessToken: (token: string): any | null => {
    try {
      console.log('[JWT] Verifying token, publicKey available:', !!publicKey);
      if (!publicKey) {
        // Fallback: just decode without verification for development
        const parts = token.split('.');
        if (parts.length !== 3) {
          console.log('[JWT] Invalid token format');
          return null;
        }
        const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        console.log('[JWT] Decoded without verification:', decoded.sub);
        return decoded;
      }
      const verified = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      console.log('[JWT] Verified token for user:', (verified as any).sub);
      return verified;
    } catch (e: any) {
      console.warn('[JWT] Verification failed:', e.message);
      return null;
    }
  }
};
