import crypto from 'crypto';
import { prisma } from '../lib/db';

export const SessionService = {
  // Generate a long, opaque hash as a refresh token
  issueRefreshToken: async (userId: string, ipAddress: string, userAgent: string) => {
    const plainToken = crypto.randomBytes(40).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
    
    // Store expires in 7 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refresh_token.create({
      data: {
        user_id: userId,
        token: hashedToken, // Only store hashed token in database
        expires_at: expiresAt,
        ip_address: ipAddress,
        user_agent: userAgent,
        is_revoked: false
      }
    });

    return plainToken; // Return plaintext exactly once directly to the user
  },

  // Validate and Rotate - guard against session hijacking
  rotateRefreshToken: async (plainToken: string, ipAddress: string, userAgent: string) => {
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
    
    // Check if token exists, isn't revoked, and hasn't expired
    const record = await prisma.refresh_token.findFirst({
      where: { token: hashedToken }
    });

    if (!record || record.is_revoked || record.expires_at < new Date()) {
      return null; // Invalid token or hijacked session
    }

    // Immediately revoke old token
    await prisma.refresh_token.update({
      where: { id: record.id },
      data: { is_revoked: true }
    });

    // Issue a completely new pair
    return await SessionService.issueRefreshToken(record.user_id, ipAddress, userAgent);
  },

  revokeAllSessions: async (userId: string) => {
    await prisma.refresh_token.updateMany({
      where: { user_id: userId },
      data: { is_revoked: true }
    });
  }
};
