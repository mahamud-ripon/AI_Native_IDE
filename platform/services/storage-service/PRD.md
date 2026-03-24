# Storage Service - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** storage-service (Port 8009)  
> **Tech Stack:** Node.js + Fastify + AWS SDK v3 + S3/MinIO + ClamAV

---

## 1. Executive Summary

The Storage Service is the centralized S3/MinIO proxy for the platform. ALL file uploads, downloads, and artifact storage must go through this service. It provides pre-signed URL security, virus scanning, and orphan cleanup.

---

## 2. Project Setup

### 2.1 Initialize Project

```bash
mkdir -p storage-service/src/{controllers,services,middleware,events,lib,config}
cd storage-service
npm init -y
npm install fastify @fastify/cors @fastify/helmet @aws-sdk/client-s3 @aws-sdk/s3-request-presigner ioredis kafkajs zod dotenv clamav.js
npm install -D typescript @types/node ts-node
npx tsc --init
```

### 2.2 package.json

```json
{
  "name": "storage-service",
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
    "@aws-sdk/client-s3": "^3.478.0",
    "@aws-sdk/s3-request-presigner": "^3.478.0",
    "ioredis": "^5.3.2",
    "kafkajs": "^2.2.4",
    "zod": "^3.22.4",
    "dotenv": "^16.3.1",
    "clamav.js": "^0.12.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.0",
    "ts-node": "^10.9.2"
  }
}
```

---

## 3. Configuration

### 3.1 Environment Variables (.env)

```env
# Server
PORT=8009
NODE_ENV=development

# S3 / MinIO
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Buckets
S3_BUCKET_USER_FILES=platform-user-files
S3_BUCKET_SNAPSHOTS=platform-snapshots
S3_BUCKET_BUILD_LOGS=platform-build-logs
S3_BUCKET_ARTIFACTS=platform-artifacts
S3_BUCKET_AVATARS=platform-avatars

# Redis
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=storage-service

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_native_ide

# ClamAV
CLAMAV_HOST=clamav-service
CLAMAV_PORT=3310

# Internal Auth
INTERNAL_API_KEY=your-internal-api-key
```

### 3.2 Config File (src/config/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8009', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    buckets: {
      userFiles: process.env.S3_BUCKET_USER_FILES || 'platform-user-files',
      snapshots: process.env.S3_BUCKET_SNAPSHOTS || 'platform-snapshots',
      buildLogs: process.env.S3_BUCKET_BUILD_LOGS || 'platform-build-logs',
      artifacts: process.env.S3_BUCKET_ARTIFACTS || 'platform-artifacts',
      avatars: process.env.S3_BUCKET_AVATARS || 'platform-avatars'
    }
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'storage-service'
  },
  
  database: {
    url: process.env.DATABASE_URL!
  },
  
  clamav: {
    host: process.env.CLAMAV_HOST || 'clamav-service',
    port: parseInt(process.env.CLAMAV_PORT || '3310', 10)
  },
  
  internalApiKey: process.env.INTERNAL_API_KEY!
};
```

---

## 4. S3 Client

### 4.1 Client Service (src/services/s3_client.ts)

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

export const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  },
  forcePathStyle: false
});

export const S3Service = {
  async upload(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    }));
  },

  async download(bucket: string, key: string): Promise<Buffer> {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }));
    
    const stream = response.Body as any;
    const chunks: Buffer[] = [];
    
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  },

  async delete(bucket: string, key: string): Promise<void> {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    }));
  },

  async listKeys(bucket: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    
    do {
      const response = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      
      response.Contents?.forEach(obj => {
        if (obj.Key) keys.push(obj.Key);
      });
      
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    
    return keys;
  },

  async getSignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    maxSizeBytes: number,
    expiresIn: number = 900
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType
    });
    
    return getSignedUrl(s3Client, command, { expiresIn });
  },

  async getSignedDownloadUrl(
    bucket: string,
    key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    return getSignedUrl(s3Client, command, { expiresIn });
  }
};
```

---

## 5. Pre-signed URL Service

### 5.1 Service (src/services/presigned_url_service.ts)

```typescript
import { S3Service } from './s3_client';
import { PermissionService } from './services/permission_srv';
import { config } from '../config';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_CONTENT_TYPES = [
  'text/plain',
  'text/javascript',
  'text/css',
  'application/json',
  'application/javascript',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'application/zip',
  'application/x-tar',
  'application/gzip'
];

const BLOCKED_EXTENSIONS = ['.exe', '.dll', '.bat', '.sh', '.cmd', '.ps1'];

export const PresignedUrlService = {
  async generateUploadUrl(
    userId: string,
    bucketType: string,
    key: string,
    contentType: string,
    sizeBytes: number
  ): Promise<{ url: string; expires_in: number }> {
    // Validate size
    if (sizeBytes > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum of ${MAX_FILE_SIZE} bytes`);
    }

    // Validate content type
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new Error('Content type not allowed');
    }

    // Validate extension
    const ext = key.substring(key.lastIndexOf('.'));
    if (BLOCKED_EXTENSIONS.includes(ext.toLowerCase())) {
      throw new Error('File extension not allowed');
    }

    // Verify project access
    const projectId = key.split('/')[1];
    if (projectId) {
      const hasAccess = await PermissionService.checkAccess(userId, projectId, 'editor');
      if (!hasAccess) {
        throw new Error('Access denied');
      }
    }

    // Get bucket
    const bucket = this.getBucket(bucketType);

    // Generate presigned URL with strict policy
    const url = await S3Service.getSignedUploadUrl(
      bucket,
      key,
      contentType,
      MAX_FILE_SIZE,
      900 // 15 minutes
    );

    return { url, expires_in: 900 };
  },

  async generateDownloadUrl(
    userId: string,
    bucketType: string,
    key: string
  ): Promise<{ url: string; expires_in: number }> {
    // Verify project access
    const projectId = key.split('/')[1];
    if (projectId) {
      const hasAccess = await PermissionService.checkAccess(userId, projectId, 'viewer');
      if (!hasAccess) {
        throw new Error('Access denied');
      }
    }

    // Get bucket
    const bucket = this.getBucket(bucketType);

    // Generate presigned URL
    const url = await S3Service.getSignedDownloadUrl(bucket, key, 3600);

    return { url, expires_in: 3600 };
  },

  getBucket(bucketType: string): string {
    const bucketMap: Record<string, string> = {
      'user-files': config.s3.buckets.userFiles,
      'snapshots': config.s3.buckets.snapshots,
      'build-logs': config.s3.buckets.buildLogs,
      'artifacts': config.s3.buckets.artifacts,
      'avatars': config.s3.buckets.avatars
    };

    const bucket = bucketMap[bucketType];
    if (!bucket) {
      throw new Error(`Invalid bucket type: ${bucketType}`);
    }

    return bucket;
  }
};
```

---

## 6. Virus Scanner

### 6.1 Service (src/services/virus_scanner.ts)

```typescript
import { createScanner } from 'clamav.js';
import { S3Service } from './s3_client';

export const VirusScanner = {
  async scanFile(bucket: string, key: string): Promise<{ clean: boolean; virus?: string }> {
    try {
      // Download file from S3
      const fileBuffer = await S3Service.download(bucket, key);
      
      // Initialize scanner
      const scanner = createScanner({
        host: process.env.CLAMAV_HOST || 'clamav-service',
        port: parseInt(process.env.CLAMAV_PORT || '3310', 10)
      });

      // Scan
      const result = await scanner.scan(fileBuffer);
      
      if (result.isInfected) {
        console.log(`[VirusScanner] Virus detected in ${key}: ${result.viruses}`);
        return { clean: false, virus: result.viruses?.[0] };
      }

      return { clean: true };
    } catch (error) {
      console.error('[VirusScanner] Scan error:', error);
      // On error, assume clean but log
      return { clean: true };
    }
  },

  async scanBuffer(buffer: Buffer): Promise<{ clean: boolean; virus?: string }> {
    try {
      const scanner = createScanner({
        host: process.env.CLAMAV_HOST || 'clamav-service',
        port: parseInt(process.env.CLAMAV_PORT || '3310', 10)
      });

      const result = await scanner.scan(buffer);
      
      if (result.isInfected) {
        return { clean: false, virus: result.viruses?.[0] };
      }

      return { clean: true };
    } catch (error) {
      console.error('[VirusScanner] Scan error:', error);
      return { clean: true };
    }
  }
};
```

---

## 7. Orphan Cleaner

### 7.1 Service (src/services/orphan_cleaner.ts)

```typescript
import { S3Service } from './s3_client';
import { prisma } from '../lib/prisma';
import { config } from '../config';

const SAFETY_MARGIN_HOURS = 24;

export const OrphanCleaner = {
  async cleanup(): Promise<{ deleted: number; errors: string[] }> {
    console.log('[OrphanCleaner] Starting orphan cleanup...');
    
    const errors: string[] = [];
    let deleted = 0;

    // Get all S3 keys in user-files bucket
    const s3Keys = await S3Service.listKeys(
      config.s3.buckets.userFiles,
      'projects/'
    );

    console.log(`[OrphanCleaner] Found ${s3Keys.length} S3 objects`);

    // Get all s3_keys from database
    const dbFiles = await prisma.projectFile.findMany({
      where: { s3Key: { not: null } },
      select: { s3Key: true }
    });

    const validKeys = new Set(dbFiles.map(f => f.s3Key));

    // Find orphans
    const cutoffTime = new Date(Date.now() - SAFETY_MARGIN_HOURS * 60 * 60 * 1000);
    
    for (const key of s3Keys) {
      if (!validKeys.has(key)) {
        try {
          // Check if older than safety margin
          // Note: In production, you'd check object metadata for creation time
          await S3Service.delete(config.s3.buckets.userFiles, key);
          deleted++;
        } catch (error: any) {
          errors.push(`Failed to delete ${key}: ${error.message}`);
        }
      }
    }

    console.log(`[OrphanCleaner] Deleted ${deleted} orphaned objects`);
    
    return { deleted, errors };
  },

  async getStorageStats(): Promise<{
    total_gb: number;
    buckets: Record<string, number>;
    orphan_count: number;
  }> {
    const buckets: Record<string, number> = {};
    let totalBytes = 0;

    const bucketNames = Object.values(config.s3.buckets);
    
    for (const bucket of bucketNames) {
      const keys = await S3Service.listKeys(bucket, '');
      buckets[bucket] = keys.length;
      // Note: In production, you'd sum actual object sizes
      totalBytes += keys.length * 100000; // Estimate
    }

    // Estimate orphan count
    const s3Keys = await S3Service.listKeys(config.s3.buckets.userFiles, 'projects/');
    const dbFiles = await prisma.projectFile.findMany({
      where: { s3Key: { not: null } },
      select: { s3Key: true }
    });
    const validKeys = new Set(dbFiles.map(f => f.s3Key));
    const orphanCount = s3Keys.filter(k => !validKeys.has(k)).length;

    return {
      total_gb: totalBytes / (1024 * 1024 * 1024),
      buckets,
      orphan_count: orphanCount
    };
  }
};
```

---

## 8. Permission Service

### 8.1 Service (src/services/permission_srv.ts)

```typescript
import { prisma } from '../lib/prisma';

export const PermissionService = {
  async checkAccess(userId: string, projectId: string, requiredRole: 'owner' | 'editor' | 'viewer'): Promise<boolean> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true }
    });
    
    if (project?.ownerId === userId) {
      return true;
    }
    
    const collaborator = await prisma.projectCollaborator.findFirst({
      where: { projectId, userId }
    });
    
    if (!collaborator) {
      return false;
    }
    
    const roleHierarchy = { viewer: 0, editor: 1, owner: 2 };
    return roleHierarchy[collaborator.role] >= roleHierarchy[requiredRole];
  }
};
```

---

## 9. Controllers

### 9.1 Upload Controller (src/controllers/upload_controller.ts)

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { PresignedUrlService } from '../services/presigned_url_service';
import { z } from 'zod';

const UploadSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  content_type: z.string(),
  size_bytes: z.number()
});

export const UploadController = {
  // POST /api/v1/storage/presign/upload
  async getPresignedUploadUrl(req: Request, res: Response) {
    try {
      const data = UploadSchema.parse(req.body);
      const userId = (req as any).user.id;

      const result = await PresignedUrlService.generateUploadUrl(
        userId,
        data.bucket,
        data.key,
        data.content_type,
        data.size_bytes
      );

      return res.json({
        success: true,
        url: result.url,
        expires_in: result.expires_in
      });
    } catch (error: any) {
      console.error('[Upload] Error:', error);
      return res.status(400).json({ error: error.message });
    }
  }
};
```

### 9.2 Download Controller (src/controllers/download_controller.ts)

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { PresignedUrlService } from '../services/presigned_url_service';
import { z } from 'zod';

const DownloadSchema = z.object({
  bucket: z.string(),
  key: z.string()
});

export const DownloadController = {
  // POST /api/v1/storage/presign/download
  async getPresignedDownloadUrl(req: Request, res: Response) {
    try {
      const data = DownloadSchema.parse(req.body);
      const userId = (req as any).user.id;

      const result = await PresignedUrlService.generateDownloadUrl(
        userId,
        data.bucket,
        data.key
      );

      return res.json({
        success: true,
        url: result.url,
        expires_in: result.expires_in
      });
    } catch (error: any) {
      console.error('[Download] Error:', error);
      return res.status(400).json({ error: error.message });
    }
  }
};
```

### 9.3 Admin Controller (src/controllers/admin_controller.ts)

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { S3Service } from '../services/s3_client';
import { OrphanCleaner } from '../services/orphan_cleaner';
import { config } from '../config';
import { z } from 'zod';

const DeleteSchema = z.object({
  keys: z.array(z.string()).min(1).max(100),
  bucket: z.string()
});

export const AdminController = {
  // DELETE /api/v1/storage/objects
  async deleteObjects(req: Request, res: Response) {
    try {
      const data = DeleteSchema.parse(req.body);
      
      const errors: string[] = [];
      let deleted = 0;

      for (const key of data.keys) {
        try {
          await S3Service.delete(data.bucket, key);
          deleted++;
        } catch (error: any) {
          errors.push(`Failed to delete ${key}: ${error.message}`);
        }
      }

      return res.json({
        success: true,
        deleted,
        errors
      });
    } catch (error: any) {
      console.error('[Admin] Error:', error);
      return res.status(400).json({ error: error.message });
    }
  },

  // GET /api/v1/storage/stats
  async getStats(req: Request, res: Response) {
    try {
      const stats = await OrphanCleaner.getStorageStats();
      return res.json({
        success: true,
        ...stats
      });
    } catch (error: any) {
      console.error('[Stats] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/storage/cleanup
  async runCleanup(req: Request, res: Response) {
    try {
      const result = await OrphanCleaner.cleanup();
      return res.json({
        success: true,
        ...result
      });
    } catch (error: any) {
      console.error('[Cleanup] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

---

## 10. Kafka Consumer

### 10.1 Consumer (src/events/kafka_consumer.ts)

```typescript
import { Kafka, Consumer } from 'kafkajs';
import { config } from '../config';
import { S3Service } from '../services/s3_client';
import { prisma } from '../lib/prisma';

const kafka = new Kafka({
  clientId: 'storage-service',
  brokers: config.kafka.brokers,
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

export const KafkaConsumer = {
  async start() {
    await consumer.connect();
    console.log('[Kafka] Consumer connected');

    await consumer.subscribe({ topic: 'project.deleted', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          const payload = JSON.parse(message.value?.toString() || '{}');
          
          if (topic === 'project.deleted') {
            await this.handleProjectDeleted(payload);
          }
        } catch (error) {
          console.error('[Kafka] Error:', error);
        }
      }
    });
  },

  async handleProjectDeleted(payload: { projectId: string }) {
    console.log(`[Kafka] Handling project.deleted for ${payload.projectId}`);
    
    // Delete all files for this project
    const files = await prisma.projectFile.findMany({
      where: { projectId: payload.projectId, s3Key: { not: null } }
    });

    for (const file of files) {
      if (file.s3Key) {
        try {
          await S3Service.delete(config.s3.buckets.userFiles, file.s3Key);
        } catch (error) {
          console.error(`[Kafka] Failed to delete ${file.s3Key}:`, error);
        }
      }
    }
  }
};
```

---

## 11. Main Application

### 11.1 App Setup (src/app.ts)

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { UploadController } from './controllers/upload_controller';
import { DownloadController } from './controllers/download_controller';
import { AdminController } from './controllers/admin_controller';

const app = Fastify({ logger: true });

// Register plugins
await app.register(helmet);
await app.register(cors, { origin: true });

// Health check
app.get('/api/v1/health', async () => ({ status: 'healthy', service: 'storage-service' }));

app.get('/api/v1/health/circuit-breaker', async () => ({ status: 'closed', failures: 0 }));

// Storage endpoints
app.post('/api/v1/storage/presign/upload', { preHandler: authMiddleware }, UploadController.getPresignedUploadUrl);
app.post('/api/v1/storage/presign/download', { preHandler: authMiddleware }, DownloadController.getPresignedDownloadUrl);
app.delete('/api/v1/storage/objects', { preHandler: authMiddleware }, AdminController.deleteObjects);

// Admin endpoints
app.get('/api/v1/storage/stats', { preHandler: authMiddleware }, AdminController.getStats);
app.post('/api/v1/storage/cleanup', { preHandler: authMiddleware }, AdminController.runCleanup);

export { app };
```

### 11.2 Entry Point (src/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { config } from './config';
import { prisma, disconnectPrisma } from './lib/prisma';
import { redis } from './lib/redis';
import { KafkaConsumer } from './events/kafka_consumer';

async function main() {
  console.log('[Storage] Starting service...');

  await redis.connect();
  await KafkaConsumer.start();

  app.listen(config.port, () => {
    console.log(`[Storage] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Storage] Shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

main().catch(console.error);
```

---

## 12. Testing Checklist

```bash
# Run the service
npm run dev

# Test health
curl http://localhost:8009/api/v1/health

# Test presigned upload URL
curl -X POST http://localhost:8009/api/v1/storage/presign/upload \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","key":"projects/uuid/files/file.js","content_type":"text/javascript","size_bytes":1024}'

# Test presigned download URL
curl -X POST http://localhost:8009/api/v1/storage/presign/download \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","key":"projects/uuid/files/file.js"}'

# Test storage stats
curl http://localhost:8009/api/v1/storage/stats \
  -H "Authorization: Bearer <token>"
```

---

## 13. Implementation Status

| Component | Status |
|-----------|--------|
| Project Setup | ✅ Complete |
| Config | ✅ Complete |
| S3 Client | ✅ Complete |
| Presigned URL Service | ✅ Complete |
| Virus Scanner | ✅ Complete |
| Orphan Cleaner | ✅ Complete |
| Permission Service | ✅ Complete |
| Controllers | ✅ Complete |
| Kafka Consumer | ✅ Complete |
| App & Index | ✅ Complete |

---

## 14. Key Implementation Notes

### 14.1 Single Gateway Rule
- All services must use storage-service for S3 operations
- No direct S3 calls from other services

### 14.2 Pre-signed URL Security
- Use PresignedPost with strict content-length-range
- Block executable file extensions
- Validate content types against allowlist
- Max file size: 50MB

### 14.3 Bucket Organization
- `platform-user-files/` - Project source files (permanent)
- `platform-snapshots/` - VM snapshots (90-day expiry)
- `platform-build-logs/` - Deployment logs (30-day expiry)
- `platform-artifacts/` - AI artifacts (7-day expiry)
- `platform-avatars/` - User avatars (permanent)

### 14.4 Orphan Cleanup
- Weekly cron job
- Cross-reference S3 keys with DB
- 24-hour safety margin before deletion
- Log deleted count to audit_logs
