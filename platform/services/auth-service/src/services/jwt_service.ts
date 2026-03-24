import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const KEYS_FILE = path.join(process.cwd(), '.jwt-keys.json');

// Load keys from environment, file, or generate new ones
function loadKeys(): { privateKey: string; publicKey: string } {
  // 1. Try environment variables first
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY) {
    return {
      privateKey: process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      publicKey: process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
    };
  }

  // 2. Try to load from file for development persistence
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (saved.privateKey && saved.publicKey) {
        console.log('[JWT] Loaded keys from file');
        return saved;
      }
    }
  } catch {
    console.warn('[JWT] Failed to load keys from file');
  }

  // 3. Generate new keys
  console.warn('[JWT] Generating new ephemeral keys');
  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keys = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  };

  // Save to file for persistence
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys));
    console.log('[JWT] Keys saved to .jwt-keys.json');
  } catch {
    console.warn('[JWT] Failed to save keys');
  }

  return keys;
}

const { privateKey, publicKey } = loadKeys();

export const JwtService = {
  
  // Create Short-Lived Access Token (15 minutes) - RS256
  issueAccessToken: (user: any) => {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role || 'user',
      iss: 'ai-native-ide.auth',
    };

    return jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      expiresIn: '24h',
      jwtid: crypto.randomUUID(), // Unique exact trace identifier
    });
  },

  verifyAccessToken: (token: string) => {
    try {
      return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    } catch (e) {
      return null;
    }
  }
};
