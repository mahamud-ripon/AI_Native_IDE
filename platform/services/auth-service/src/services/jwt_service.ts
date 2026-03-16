import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Load keys from environment or generate ephemeral for development
let privateKey: string;
let publicKey: string;

if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY) {
  // Use environment keys (production/staging with proper key management)
  privateKey = process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
  publicKey = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
} else {
  // Generate ephemeral keys for development only
  console.warn('[JWT] Using ephemeral keys - for production, set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY env vars');
  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = keyPair.privateKey;
  publicKey = keyPair.publicKey;
  
  // Export public key for gateway to use
  console.log('[JWT] Public Key for Gateway (copy to api-gateway .env):');
  console.log('-----BEGIN PUBLIC KEY-----');
  console.log(publicKey.replace('-----BEGIN PUBLIC KEY-----\n', '').replace('\n-----END PUBLIC KEY-----', ''));
  console.log('-----END PUBLIC KEY-----');
}

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
      expiresIn: '15m',
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
