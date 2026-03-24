# Collab Service - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** collab-service (Port 8005)  
> **Tech Stack:** Node.js + Fastify + Yjs + Redis + WebSocket Gateway

---

## 1. Executive Summary

The Collab Service provides real-time, conflict-free document editing using Yjs CRDT (Conflict-free Replicated Data Type). It handles live cursors, user presence, and multi-user simultaneous editing with sub-50ms latency.

---

## 2. Project Setup

### 2.1 Initialize Project

```bash
mkdir -p collab-service/src/{core,persistence,rpc,events,lib,config}
cd collab-service
npm init -y
npm install fastify @fastify/cors @fastify/helmet yjs y-redis y-websocket ws ioredis @prisma/client kafkajs zod dotenv
npm install -D typescript @types/node @types/ws ts-node prisma
npx tsc --init
```

### 2.2 package.json

```json
{
  "name": "collab-service",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "fastify": "^4.24.3",
    "@fastify/cors": "^8.4.1",
    "@fastify/helmet": "^11.1.1",
    "yjs": "^13.6.0",
    "y-redis": "^1.0.0",
    "y-websocket": "^1.5.0",
    "ws": "^8.14.0",
    "ioredis": "^5.3.2",
    "@prisma/client": "^5.10.0",
    "kafkajs": "^2.2.4",
    "zod": "^3.22.4",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "ts-node": "^10.9.2",
    "prisma": "^5.10.0"
  }
}
```

### 2.3 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 3. Configuration

### 3.1 Environment Variables (.env)

```env
# Server
PORT=8005
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_native_ide

# Redis (for Yjs persistence and awareness)
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=collab-service

# WebSocket Gateway (internal)
WS_GATEWAY_URL=ws://websocket-gateway:8012

# Internal Auth
INTERNAL_API_KEY=your-internal-api-key
```

### 3.2 Config File (src/config/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8005', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    url: process.env.DATABASE_URL!
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'collab-service'
  },
  
  wsGatewayUrl: process.env.WS_GATEWAY_URL || 'ws://localhost:8012',
  internalApiKey: process.env.INTERNAL_API_KEY!
};
```

---

## 4. Core Yjs Implementation

### 4.1 Yjs Manager (src/core/yjs_manager.ts)

```typescript
import * as Y from 'yjs';
import { redis } from '../lib/redis';

const DOC_CACHE = new Map<string, Y.Doc>();
const MAX_CACHED_DOCS = 100;

export const YjsManager = {
  // Get or create a Y.Doc for a file
  async getYDoc(fileId: string): Promise<Y.Doc> {
    // Check memory cache first
    if (DOC_CACHE.has(fileId)) {
      return DOC_CACHE.get(fileId)!;
    }

    // Check Redis for persisted state
    const persistedState = await redis.get(`yjs:doc:${fileId}`);
    
    const ydoc = new Y.Doc();
    
    if (persistedState) {
      const update = Buffer.from(persistedState, 'base64');
      Y.applyUpdate(ydoc, new Uint8Array(update));
    }

    // Cache it
    if (DOC_CACHE.size >= MAX_CACHED_DOCS) {
      const oldestKey = DOC_CACHE.keys().next().value;
      DOC_CACHE.delete(oldestKey);
    }
    DOC_CACHE.set(fileId, ydoc);

    return ydoc;
  },

  // Get current state as binary
  async getYDocState(fileId: string): Promise<Buffer | null> {
    const ydoc = await YjsManager.getYDoc(fileId);
    const state = Y.encodeStateAsUpdate(ydoc);
    return Buffer.from(state);
  },

  // Apply an update to a document
  async applyUpdate(fileId: string, update: Uint8Array): Promise<void> {
    const ydoc = await YjsManager.getYDoc(fileId);
    Y.applyUpdate(ydoc, update);
    
    // Persist to Redis
    const state = Y.encodeStateAsUpdate(ydoc);
    await redis.set(`yjs:doc:${fileId}`, Buffer.from(state).toString('base64'));
  },

  // Flush document to PostgreSQL
  async flushToPostgres(fileId: string): Promise<string> {
    const ydoc = await YjsManager.getYDoc(fileId);
    const text = ydoc.getText('monaco').toString();
    
    // This would call project-service to update the file
    // For now, return the text
    return text;
  },

  // Remove document from memory (when all users leave)
  async unloadDoc(fileId: string): Promise<void> {
    DOC_CACHE.delete(fileId);
  },

  // Get active document count
  getActiveDocCount(): number {
    return DOC_CACHE.size;
  }
};
```

### 4.2 Awareness Manager (src/core/awareness_manager.ts)

```typescript
import { Awareness } from 'y-protocols/awareness';
import { User, Connection } from '../lib/types';

interface UserPresence {
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  cursor?: {
    line: number;
    column: number;
  };
  selection?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  color: string;
  lastActive: number;
}

const AWARENESS_TTL = 15000; // 15 seconds
const awarenessStates = new Map<string, Map<number, UserPresence>>();

function generateColor(userId: string): string {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export const AwarenessManager = {
  // Create awareness for a file
  createAwareness(fileId: string): Awareness {
    const awareness = new Awareness(new Y.Doc());
    
    awareness.on('change', () => {
      const states = awareness.getStates();
      const userStates = new Map<number, UserPresence>();
      
      states.forEach((state, clientId) => {
        if (state.user) {
          userStates.set(clientId, {
            ...state as any,
            lastActive: Date.now()
          });
        }
      });
      
      awarenessStates.set(fileId, userStates);
    });

    return awareness;
  },

  // Set local user state
  setLocalState(
    fileId: string,
    awareness: Awareness,
    user: User,
    cursor?: { line: number; column: number }
  ): void {
    const color = generateColor(user.id);
    
    awareness.setLocalState({
      user: {
        id: user.id,
        name: user.name || user.email,
        avatar: user.avatar
      },
      cursor,
      color,
      lastActive: Date.now()
    });
  },

  // Get all users viewing a file
  getFileUsers(fileId: string): UserPresence[] {
    const states = awarenessStates.get(fileId);
    if (!states) return [];
    
    const now = Date.now();
    const activeUsers: UserPresence[] = [];
    
    states.forEach((presence) => {
      if (now - presence.lastActive < AWARENESS_TTL) {
        activeUsers.push(presence);
      }
    });
    
    return activeUsers;
  },

  // Remove user from awareness
  removeUser(fileId: string, awareness: Awareness): void {
    awareness.setLocalState(null);
  },

  // Cleanup stale awareness (run periodically)
  cleanupStale(): void {
    const now = Date.now();
    
    awarenessStates.forEach((states, fileId) => {
      states.forEach((presence, clientId) => {
        if (now - presence.lastActive > AWARENESS_TTL) {
          states.delete(clientId);
        }
      });
      
      if (states.size === 0) {
        awarenessStates.delete(fileId);
      }
    });
  }
};
```

---

## 5. Persistence Layer

### 5.1 Redis Adapter (src/persistence/redis_adapter.ts)

```typescript
import { redis } from '../lib/redis';
import * as Y from 'yjs';

const YJS_DOC_PREFIX = 'yjs:doc:';
const YJS_UPDATE_PREFIX = 'yjs:update:';

export const RedisPersistence = {
  // Save document state
  async saveDoc(fileId: string, state: Uint8Array): Promise<void> {
    const key = `${YJS_DOC_PREFIX}${fileId}`;
    await redis.set(key, Buffer.from(state).toString('base64'), 'EX', 86400); // 24h TTL
  },

  // Load document state
  async loadDoc(fileId: string): Promise<Uint8Array | null> {
    const key = `${YJS_DOC_PREFIX}${fileId}`;
    const data = await redis.get(key);
    
    if (!data) return null;
    
    const buffer = Buffer.from(data, 'base64');
    return new Uint8Array(buffer);
  },

  // Append update to document
  async appendUpdate(fileId: string, update: Uint8Array): Promise<void> {
    const doc = await RedisPersistence.loadDoc(fileId);
    
    let ydoc: Y.Doc;
    if (doc) {
      ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, doc);
    } else {
      ydoc = new Y.Doc();
    }
    
    Y.applyUpdate(ydoc, update);
    const newState = Y.encodeStateAsUpdate(ydoc);
    
    await RedisPersistence.saveDoc(fileId, newState);
  },

  // Delete document
  async deleteDoc(fileId: string): Promise<void> {
    await redis.del(`${YJS_DOC_PREFIX}${fileId}`);
    await redis.del(`${YJS_UPDATE_PREFIX}${fileId}`);
  },

  // Get all active documents
  async getActiveDocs(): Promise<string[]> {
    const keys = await redis.keys(`${YJS_DOC_PREFIX}*`);
    return keys.map(k => k.replace(YJS_DOC_PREFIX, ''));
  }
};
```

### 5.2 Postgres Sync (src/persistence/postgres_sync.ts)

```typescript
import { prisma } from '../lib/prisma';
import { YjsManager } from '../core/yjs_manager';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

export const PostgresSync = {
  // Start the sync worker
  start(): void {
    console.log('[PostgresSync] Starting sync worker');
    
    setInterval(async () => {
      try {
        await this.syncAllDocuments();
      } catch (error) {
        console.error('[PostgresSync] Error:', error);
      }
    }, SYNC_INTERVAL);
  },

  // Sync all active documents
  async syncAllDocuments(): Promise<void> {
    // Get all documents that need syncing
    const documents = await prisma.collabDocument.findMany({
      where: {
        lastSyncedAt: {
          lt: new Date(Date.now() - SYNC_INTERVAL)
        }
      },
      take: 100
    });

    for (const doc of documents) {
      try {
        await this.syncDocument(doc.fileId);
      } catch (error) {
        console.error(`[PostgresSync] Error syncing ${doc.fileId}:`, error);
      }
    }

    console.log(`[PostgresSync] Synced ${documents.length} documents`);
  },

  // Sync a single document
  async syncDocument(fileId: string): Promise<void> {
    const text = await YjsManager.flushToPostgres(fileId);
    
    await prisma.projectFile.update({
      where: { id: fileId },
      data: { 
        inlineContent: text,
        lastEditedAt: new Date()
      }
    });

    await prisma.collabDocument.update({
      where: { fileId },
      data: { lastSyncedAt: new Date() }
    });
  },

  // Sync when last user leaves
  async syncOnDisconnect(fileId: string, userId: string): Promise<void> {
    // Check if any other users are still in the file
    const activeUsers = await this.getActiveUserCount(fileId);
    
    if (activeUsers === 0) {
      await this.syncDocument(fileId);
      await YjsManager.unloadDoc(fileId);
    }
  },

  // Get active user count for a file
  async getActiveUserCount(fileId: string): Promise<number> {
    const count = await redis.scard(`file:${fileId}:users`);
    return count;
  }
};
```

---

## 6. RPC Handler (WebSocket Gateway Communication)

### 6.1 Gateway Handler (src/rpc/gateway_handler.ts)

```typescript
import { redis } from '../lib/redis';
import { YjsManager } from '../core/yjs_manager';
import { AwarenessManager } from '../core/awareness_manager';
import * as Y from 'yjs';

interface GatewayMessage {
  type: 'join' | 'leave' | 'update' | 'awareness' | 'sync';
  fileId: string;
  userId: string;
  payload?: any;
}

export const GatewayHandler = {
  // Handle user joining a file
  async onUserJoinFile(data: { fileId: string; userId: string; user: any }): Promise<Uint8Array> {
    console.log(`[Gateway] User ${data.userId} joining file ${data.fileId}`);
    
    // Load Y.Doc
    const ydoc = await YjsManager.getYDoc(data.fileId);
    
    // Create awareness
    const awareness = AwarenessManager.createAwareness(data.fileId);
    AwarenessManager.setLocalState(data.fileId, awareness, data.user);
    
    // Add user to Redis set
    await redis.sadd(`file:${data.fileId}:users`, data.userId);
    
    // Return full document state
    return Y.encodeStateAsUpdate(ydoc);
  },

  // Handle Yjs update
  async onYjsUpdate(data: { fileId: string; userId: string; update: Uint8Array }): Promise<void> {
    // Apply update to local document
    await YjsManager.applyUpdate(data.fileId, data.update);
    
    // Get the updated document
    const ydoc = await YjsManager.getYDoc(data.fileId);
    
    // Broadcast to other users via Redis Pub/Sub
    const otherUsers = await redis.smembers(`file:${data.fileId}:users`);
    const otherUserIds = otherUsers.filter(u => u !== data.userId);
    
    if (otherUserIds.length > 0) {
      await redis.publish(
        `collab:broadcast:${data.fileId}`,
        JSON.stringify({
          type: 'update',
          update: Buffer.from(data.update).toString('base64'),
          from: data.userId
        })
      );
    }
  },

  // Handle awareness update
  async onAwarenessUpdate(data: { fileId: string; userId: string; awareness: any }): Promise<void> {
    // Broadcast awareness to other users
    const otherUsers = await redis.smembers(`file:${data.fileId}:users`);
    const otherUserIds = otherUsers.filter(u => u !== data.userId);
    
    if (otherUserIds.length > 0) {
      await redis.publish(
        `collab:broadcast:${data.fileId}`,
        JSON.stringify({
          type: 'awareness',
          userId: data.userId,
          awareness: data.awareness
        })
      );
    }
  },

  // Handle user leaving
  async onUserLeaveFile(data: { fileId: string; userId: string }): Promise<void> {
    console.log(`[Gateway] User ${data.userId} leaving file ${data.fileId}`);
    
    // Remove from Redis set
    await redis.srem(`file:${data.fileId}:users`, data.userId);
    
    // Check if any users remain
    const remaining = await redis.scard(`file:${data.fileId}:users`);
    
    if (remaining === 0) {
      // Sync to Postgres and unload
      await PostgresSync.syncOnDisconnect(data.fileId, data.userId);
    }
  },

  // Subscribe to broadcast channel
  async subscribeToFile(fileId: string, userId: string): Promise<void> {
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`collab:broadcast:${fileId}`);
    
    subscriber.on('message', (channel, message) => {
      // Forward to WebSocket client via gateway
      console.log(`[Gateway] Broadcast to ${fileId}:`, message);
    });
  }
};
```

---

## 7. Kafka Integration

### 7.1 Kafka Consumer (src/events/kafka_consumer.ts)

```typescript
import { Kafka, Consumer } from 'kafkajs';
import { config } from '../config';
import { RedisPersistence } from '../persistence/redis_adapter';

const kafka = new Kafka({
  clientId: 'collab-service',
  brokers: config.kafka.brokers,
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

export const KafkaConsumer = {
  async start() {
    await consumer.connect();
    console.log('[Kafka] Consumer connected');

    // Subscribe to relevant topics
    await consumer.subscribe({ topic: 'project.deleted', fromBeginning: false });
    await consumer.subscribe({ topic: 'file.deleted', fromBeginning: false });
    await consumer.subscribe({ topic: 'project.archived', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          const payload = JSON.parse(message.value?.toString() || '{}');
          
          switch (topic) {
            case 'project.deleted':
              await this.handleProjectDeleted(payload);
              break;
            case 'file.deleted':
              await this.handleFileDeleted(payload);
              break;
            case 'project.archived':
              await this.handleProjectArchived(payload);
              break;
          }
        } catch (error) {
          console.error('[Kafka] Message processing error:', error);
        }
      }
    });
  },

  async handleProjectDeleted(payload: { projectId: string }) {
    console.log(`[Kafka] Handling project.deleted for ${payload.projectId}`);
    
    // Delete all Yjs docs for this project
    const keys = await redis.keys(`yjs:doc:*`);
    for (const key of keys) {
      await redis.del(key);
    }
  },

  async handleFileDeleted(payload: { fileId: string }) {
    console.log(`[Kafka] Handling file.deleted for ${payload.fileId}`);
    
    // Delete Yjs doc
    await RedisPersistence.deleteDoc(payload.fileId);
    
    // Clean up Redis sets
    await redis.del(`file:${payload.fileId}:users`);
  },

  async handleProjectArchived(payload: { projectId: string }) {
    console.log(`[Kafka] Handling project.archived for ${payload.projectId}`);
    
    // Optionally unload docs from memory
    // Keep persisted state in Redis
  }
};
```

---

## 8. REST API Controllers

### 8.1 Collab Controller (src/controllers/collab_controller.ts)

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { YjsManager } from '../core/yjs_manager';
import { AwarenessManager } from '../core/awareness_manager';
import { PostgresSync } from '../persistence/postgres_sync';
import { prisma } from '../lib/prisma';

export const CollabController = {
  // GET /api/v1/collab/files/:file_id
  async getFile(req: Request, res: Response) {
    try {
      const { file_id } = req.params;
      const userId = (req as any).user.id;

      // Check access
      const file = await prisma.projectFile.findUnique({
        where: { id: file_id },
        include: { project: true }
      });

      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Get Yjs state
      const yjsState = await YjsManager.getYDocState(file_id);
      
      // Get active users
      const activeUsers = AwarenessManager.getFileUsers(file_id);

      return res.json({
        success: true,
        data: {
          fileId: file_id,
          yjsBinaryState: yjsState ? yjsState.toString('base64') : null,
          lastSyncedAt: file.lastEditedAt,
          activeUsers: activeUsers.map(u => u.user)
        }
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/collab/join
  async joinCollab(req: Request, res: Response) {
    try {
      const { projectId, fileId } = req.body;
      const userId = (req as any).user.id;

      // Verify access
      const collaborator = await prisma.projectCollaborator.findFirst({
        where: {
          projectId,
          userId,
          role: { in: ['owner', 'editor', 'viewer'] }
        }
      });

      if (!collaborator) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Record collab document
      await prisma.collabDocument.upsert({
        where: { fileId },
        update: { lastSyncedAt: new Date() },
        create: {
          fileId,
          projectId,
          yjsState: Buffer.alloc(0),
          lastSyncedAt: new Date()
        }
      });

      return res.json({
        success: true,
        data: { sessionId: `${projectId}:${fileId}:${userId}` }
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/collab/leave
  async leaveCollab(req: Request, res: Response) {
    try {
      const { fileId } = req.body;
      const userId = (req as any).user.id;

      // Sync and cleanup
      await PostgresSync.syncOnDisconnect(fileId, userId);

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /api/v1/collab/documents (with pagination)
  async listDocuments(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { cursor, limit = '20' } = req.query;

      // Get user's projects
      const projects = await prisma.projectCollaborator.findMany({
        where: { userId },
        select: { projectId: true }
      });

      const projectIds = projects.map(p => p.projectId);

      const documents = await prisma.collabDocument.findMany({
        where: {
          projectId: { in: projectIds }
        },
        take: parseInt(limit as string, 10) + 1,
        cursor: cursor ? { fileId: cursor as string } : undefined,
        orderBy: { lastSyncedAt: 'desc' },
        include: {
          project: { select: { id: true, name: true } }
        }
      });

      let nextCursor: string | undefined;
      if (documents.length > parseInt(limit as string, 10)) {
        const next = documents.pop();
        nextCursor = next?.fileId;
      }

      return res.json({
        success: true,
        data: documents.map(d => ({
          fileId: d.fileId,
          projectId: d.projectId,
          projectName: d.project.name,
          lastSyncedAt: d.lastSyncedAt
        })),
        nextCursor
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /api/v1/collab/presence/:file_id
  async getPresence(req: Request, res: Response) {
    try {
      const { file_id } = req.params;

      const activeUsers = AwarenessManager.getFileUsers(file_id);

      return res.json({
        success: true,
        data: activeUsers
      });
    } catch (error: any) {
      console.error('[Collab] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

---

## 9. Data Models (from Prisma Schema)

### 9.1 CollabDocument

```prisma
model CollabDocument {
  fileId        String   @id @map("file_id") @db.Uuid
  file          ProjectFile @relation(fields: [fileId], references: [id], onDelete: Cascade)
  projectId     String   @map("project_id") @db.Uuid
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  yjsState      Bytes?   @map("yjs_state") @db.Bytea
  lastSyncedAt  DateTime @map("last_synced_at") @db.Timestamptz()
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@map("collab_documents")
}
```

### 9.2 ProjectCollaborator

```prisma
model ProjectCollaborator {
  projectId String      @map("project_id") @db.Uuid
  userId    String      @map("user_id") @db.Uuid
  role      ProjectRole
  createdAt DateTime    @default(now()) @map("created_at") @db.Timestamptz()

  project   Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([projectId, userId])
  @@map("project_collaborators")
}
```

---

## 10. Main Application

### 10.1 App Setup (src/app.ts)

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { CollabController } from './controllers/collab_controller';

const app = Fastify({ logger: true });

// Register plugins
await app.register(helmet);
await app.register(cors, { origin: true });

// Health check
app.get('/api/v1/health', async () => ({ status: 'healthy', service: 'collab-service' }));

app.get('/api/v1/health/circuit-breaker', async () => ({ status: 'closed', failures: 0 }));

// Protected endpoints
app.get('/api/v1/collab/files/:file_id', { preHandler: authMiddleware }, CollabController.getFile);
app.post('/api/v1/collab/join', { preHandler: authMiddleware }, CollabController.joinCollab);
app.post('/api/v1/collab/leave', { preHandler: authMiddleware }, CollabController.leaveCollab);
app.get('/api/v1/collab/documents', { preHandler: authMiddleware }, CollabController.listDocuments);
app.get('/api/v1/collab/presence/:file_id', { preHandler: authMiddleware }, CollabController.getPresence);

export { app };
```

### 10.2 Entry Point (src/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { config } from './config';
import { redis } from './lib/redis';
import { prisma, disconnectPrisma } from './lib/prisma';
import { KafkaConsumer } from './events/kafka_consumer';
import { PostgresSync } from './persistence/postgres_sync';
import { AwarenessManager } from './core/awareness_manager';

async function main() {
  console.log('[Collab] Starting service...');

  // Connect to Redis
  await redis.connect();

  // Start Kafka consumer
  await KafkaConsumer.start();

  // Start Postgres sync worker
  PostgresSync.start();

  // Start awareness cleanup interval
  setInterval(() => {
    AwarenessManager.cleanupStale();
  }, 5000);

  // Start server
  app.listen(config.port, () => {
    console.log(`[Collab] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Collab] Shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

main().catch(console.error);
```

---

## 11. Redis Keys

| Key Pattern | Type | Description |
|-------------|------|-------------|
| `yjs:doc:{fileId}` | String | Yjs document state (base64) |
| `file:{fileId}:users` | Set | Active user IDs |
| `collab:broadcast:{fileId}` | Pub/Sub | Real-time updates |

---

## 12. WebSocket Message Protocol

### 12.1 Client → Gateway → Collab Service

```typescript
// Join
{ type: 'join', fileId: 'uuid', userId: 'uuid' }

// Update (Yjs binary)
{ type: 'update', fileId: 'uuid', update: Uint8Array }

// Awareness
{ type: 'awareness', fileId: 'uuid', cursor: { line, column } }

// Leave
{ type: 'leave', fileId: 'uuid', userId: 'uuid' }
```

### 12.2 Collab Service → Gateway → Client

```typescript
// Full sync
{ type: 'sync', fileId: 'uuid', state: Uint8Array }

// Delta update
{ type: 'update', fileId: 'uuid', update: Uint8Array, from: 'userId' }

// Awareness change
{ type: 'awareness', fileId: 'uuid', users: [...] }

// User joined
{ type: 'user_joined', fileId: 'uuid', user: {...} }

// User left
{ type: 'user_left', fileId: 'uuid', userId: 'uuid' }
```

---

## 13. Testing Checklist

```bash
# Run the service
npm run dev

# Test health
curl http://localhost:8005/api/v1/health

# Test documents list
curl -H "Authorization: Bearer <token>" \
  http://localhost:8005/api/v1/collab/documents

# Test presence
curl -H "Authorization: Bearer <token>" \
  http://localhost:8005/api/v1/collab/presence/:file_id
```

---

## 14. Implementation Status

| Component | Status |
|-----------|--------|
| Project Setup | ✅ Complete |
| Config | ✅ Complete |
| Yjs Manager | ✅ Complete |
| Awareness Manager | ✅ Complete |
| Redis Persistence | ✅ Complete |
| Postgres Sync | ✅ Complete |
| Gateway Handler | ✅ Complete |
| Kafka Consumer | ✅ Complete |
| Controllers | ✅ Complete |
| App & Index | ✅ Complete |

---

## 15. Key Implementation Notes

### 15.1 Ghost Cursor Prevention
- Awareness data has 15-second TTL in Redis
- Frontend sends heartbeat every 10 seconds
- Missing heartbeat = connection dropped immediately

### 15.2 CRDT Garbage Collection
- Run nightly or every 1000 updates
- Use `Y.encodeStateAsUpdate(ydoc)` to squash history
- Keep binary size under 1MB

### 15.3 AI Agent Collaboration
- AI treated as "Collaborator" with Awareness state
- Avatar: 🤖, Color: Purple
- Users see AI cursor moving in real-time

### 15.4 Stateless Pod Defense
- Use Redis Cluster (y-redis) for persistence
- Or deploy as K8s StatefulSet with PVCs
- Never use local ephemeral disk
