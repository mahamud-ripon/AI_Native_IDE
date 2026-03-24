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

    await prisma.refreshToken.create({
      data: {
        userId: userId,
        tokenHash: hashedToken, // Only store hashed token in database
        expiresAt: expiresAt,
        ipAddress: ipAddress,
        deviceInfo: userAgent,
        isRevoked: false
      }
    });

    return plainToken; // Return plaintext exactly once directly to the user
  },

  // Validate and Rotate - guard against session hijacking
  rotateRefreshToken: async (plainToken: string, ipAddress: string, userAgent: string) => {
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
    
    // Check if token exists, isn't revoked, and hasn't expired
    const record = await prisma.refreshToken.findFirst({
      where: { tokenHash: hashedToken }
    });

    if (!record || record.isRevoked || record.expiresAt < new Date()) {
      return null; // Invalid token or hijacked session
    }

    // Immediately revoke old token
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { isRevoked: true }
    });

    // Issue a completely new pair
    return await SessionService.issueRefreshToken(record.userId, ipAddress, userAgent);
  },

  revokeAllSessions: async (userId: string) => {
    await prisma.refreshToken.updateMany({
      where: { userId: userId },
      data: { isRevoked: true }
    });
  }
};
