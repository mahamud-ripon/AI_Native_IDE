// This file is a stub for @workspace/database, allowing standalone testing
import crypto from 'crypto';

// Basic in-memory representations for development testing
export const db = {
  users: [] as any[],
  refresh_tokens: [] as any[],
  audit_logs: [] as any[],
};

// Simulated Prisma Client methods
export const prisma = {
  user: {
    findUnique: async ({ where }: any) => db.users.find(u => 
      (where.email && u.email === where.email) || 
      (where.username && u.username === where.username)
    ) || null,
    
    create: async ({ data }: any) => {
      const newUser = { id: crypto.randomUUID(), ...data, mfa_enabled: false };
      db.users.push(newUser);
      return newUser;
    }
  },
  refresh_token: {
    findFirst: async ({ where }: any) => db.refresh_tokens.find(rt => rt.token === where.token && !rt.is_revoked) || null,
    
    create: async ({ data }: any) => {
      const entry = { id: crypto.randomUUID(), ...data };
      db.refresh_tokens.push(entry);
      return entry;
    },
    
    update: async ({ where, data }: any) => {
      const tokenIndex = db.refresh_tokens.findIndex(rt => rt.id === where.id);
      if (tokenIndex !== -1) {
        db.refresh_tokens[tokenIndex] = { ...db.refresh_tokens[tokenIndex], ...data };
        return db.refresh_tokens[tokenIndex];
      }
      return null;
    },
    
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const rt of db.refresh_tokens) {
        if (rt.user_id === where.user_id) {
          Object.assign(rt, data);
          count++;
        }
      }
      return { count };
    }
  },
  audit_log: {
    create: async ({ data }: any) => {
      db.audit_logs.push(data);
      return data;
    }
  }
};
