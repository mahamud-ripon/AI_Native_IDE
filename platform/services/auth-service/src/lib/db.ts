// This file is a stub for @workspace/database, allowing standalone testing
import crypto from 'crypto';

// Basic in-memory representations for development testing
export const db = {
  users: [] as any[],
  refreshTokens: [] as any[],
  auditLogs: [] as any[],
};

// Simulated Prisma Client methods - using correct Prisma model names
export const prisma = {
  user: {
    findUnique: async ({ where }: any) => db.users.find(u => 
      (where.email && u.email === where.email) || 
      (where.username && u.username === where.username)
    ) || null,
    
    findFirst: async ({ where }: any) => {
      if (where.OR) {
        return db.users.find(u => 
          where.OR.some((cond: any) => 
            (cond.email && u.email === cond.email) || 
            (cond.username && u.username === cond.username)
          ) && (!where.deletedAt || u.deletedAt === null)
        ) || null;
      }
      return db.users.find(u => 
        (where.email && u.email === where.email) || 
        (where.username && u.username === where.username)
      ) || null;
    },
    
    create: async ({ data }: any) => {
      const newUser = { id: crypto.randomUUID(), ...data, mfaEnabled: data.mfaEnabled || false, hashedPassword: data.hashedPassword };
      db.users.push(newUser);
      return newUser;
    }
  },
  refreshToken: {
    findFirst: async ({ where, include }: any) => {
      const token = db.refreshTokens.find(rt => rt.tokenHash === where.tokenHash && !rt.isRevoked) || null;
      if (token && include?.user) {
        (token as any).user = db.users.find(u => u.id === token.userId);
      }
      return token;
    },
    
    create: async ({ data }: any) => {
      const entry = { id: crypto.randomUUID(), ...data };
      db.refreshTokens.push(entry);
      return entry;
    },
    
    update: async ({ where, data }: any) => {
      const tokenIndex = db.refreshTokens.findIndex(rt => rt.id === where.id);
      if (tokenIndex !== -1) {
        db.refreshTokens[tokenIndex] = { ...db.refreshTokens[tokenIndex], ...data };
        return db.refreshTokens[tokenIndex];
      }
      return null;
    },
    
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const rt of db.refreshTokens) {
        if (rt.userId === where.userId) {
          Object.assign(rt, data);
          count++;
        }
      }
      return { count };
    }
  },
  auditLog: {
    create: async ({ data }: any) => {
      db.auditLogs.push(data);
      return data;
    }
  }
};
