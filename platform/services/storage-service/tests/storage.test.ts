import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock S3 client before any imports
vi.mock('../src/services/s3.service.js', () => ({
  S3Service: {
    upload: vi.fn(),
    download: vi.fn(),
    delete: vi.fn(),
    deleteObjects: vi.fn(),
    listKeys: vi.fn(),
    getMetadata: vi.fn(),
    exists: vi.fn(),
    getSignedUploadUrl: vi.fn(),
    getSignedDownloadUrl: vi.fn(),
    getBucketName: vi.fn((type: string) => `platform-${type}`),
  },
  getS3Client: vi.fn(),
}));

// Mock Prisma
vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    projectCollaborator: {
      findFirst: vi.fn(),
    },
    projectFile: {
      findMany: vi.fn(),
    },
    fileVersion: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
  disconnectPrisma: vi.fn(),
}));

// Mock Redis
vi.mock('../src/lib/redis.js', () => ({
  getRedis: vi.fn(() => null),
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 100, resetAt: Date.now() + 3600000 })),
}));

// Mock config
vi.mock('../src/config/index.js', () => ({
  config: {
    port: 8009,
    nodeEnv: 'test',
    s3: {
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      forcePathStyle: true,
      buckets: {
        userFiles: 'platform-user-files',
        snapshots: 'platform-snapshots',
        buildLogs: 'platform-build-logs',
        artifacts: 'platform-artifacts',
        avatars: 'platform-avatars',
      },
    },
    storage: {
      maxFileSize: 52428800,
      presignedUrlExpiry: {
        upload: 900,
        download: 3600,
      },
      orphanCleanupSafetyHours: 24,
    },
    kafka: { enabled: false },
    clamav: { enabled: false },
    internalApiKey: 'test-api-key',
  },
}));

import { buildApp } from '../src/app.js';
import { S3Service } from '../src/services/s3.service.js';
import { prisma } from '../src/lib/prisma.js';
import type { FastifyInstance } from 'fastify';

describe('Storage Service', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Endpoints', () => {
    it('GET /health should return healthy status', async () => {
      app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('status', 'ok');
      expect(response.json()).toHaveProperty('service', 'storage-service');
    });

    it('GET /health/circuit-breaker should return circuit breaker status', async () => {
      app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/health/circuit-breaker',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('status', 'closed');
    });
  });

  describe('Pre-signed Upload URL', () => {
    it('should reject without auth', async () => {
      app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/presign/upload',
        body: {
          bucket: 'user-files',
          key: 'projects/test-project/files/test.js',
          content_type: 'text/javascript',
          size_bytes: 1024,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should generate upload URL with valid auth', async () => {
      app = await buildApp();
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'test-project',
        ownerId: 'user-123',
        visibility: 'public',
      } as any);

      vi.mocked(S3Service.getSignedUploadUrl).mockResolvedValue('https://s3.example.com/signed-url');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/presign/upload',
        headers: { 'x-user-id': 'user-123' },
        body: {
          bucket: 'user-files',
          key: 'projects/test-project/files/test.js',
          content_type: 'text/javascript',
          size_bytes: 1024,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('success', true);
      expect(response.json()).toHaveProperty('url');
    });

    it('should reject blocked file extensions', async () => {
      app = await buildApp();
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/presign/upload',
        headers: { 'x-user-id': 'user-123' },
        body: {
          bucket: 'user-files',
          key: 'projects/test-project/files/virus.exe',
          content_type: 'application/octet-stream',
          size_bytes: 1024,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject files exceeding size limit', async () => {
      app = await buildApp();
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/presign/upload',
        headers: { 'x-user-id': 'user-123' },
        body: {
          bucket: 'user-files',
          key: 'projects/test-project/files/large.zip',
          content_type: 'application/zip',
          size_bytes: 100 * 1024 * 1024, // 100MB
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Pre-signed Download URL', () => {
    it('should reject without auth', async () => {
      app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/presign/download',
        body: {
          bucket: 'user-files',
          key: 'projects/test-project/files/test.js',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should generate download URL with valid auth', async () => {
      app = await buildApp();
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'test-project',
        ownerId: 'user-123',
        visibility: 'public',
      } as any);

      vi.mocked(S3Service.exists).mockResolvedValue(true);
      vi.mocked(S3Service.getSignedDownloadUrl).mockResolvedValue('https://s3.example.com/signed-download-url');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/presign/download',
        headers: { 'x-user-id': 'user-123' },
        body: {
          bucket: 'user-files',
          key: 'projects/test-project/files/test.js',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('success', true);
      expect(response.json()).toHaveProperty('url');
    });
  });

  describe('Storage Stats', () => {
    it('should reject without auth', async () => {
      app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/storage/stats',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return stats with auth', async () => {
      app = await buildApp();
      
      vi.mocked(S3Service.listKeys).mockResolvedValue(['key1', 'key2']);
      vi.mocked(S3Service.getMetadata).mockResolvedValue({
        size: 1000,
        contentType: 'text/plain',
        lastModified: new Date(),
        etag: 'abc123',
      });
      vi.mocked(prisma.projectFile.findMany).mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/storage/stats',
        headers: { 'x-user-id': 'user-123' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('success', true);
    });
  });

  describe('Delete Objects', () => {
    it('should reject without auth', async () => {
      app = await buildApp();
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/storage/objects',
        body: {
          bucket: 'user-files',
          keys: ['projects/test-project/files/test.js'],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should delete objects with valid auth', async () => {
      app = await buildApp();
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'test-project',
        ownerId: 'user-123',
        visibility: 'public',
      } as any);

      vi.mocked(S3Service.deleteObjects).mockResolvedValue({
        deleted: ['projects/test-project/files/test.js'],
        errors: [],
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/storage/objects',
        headers: { 'x-user-id': 'user-123' },
        body: {
          bucket: 'user-files',
          keys: ['projects/test-project/files/test.js'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('success', true);
    });
  });

  describe('Internal API Key Auth', () => {
    it('should accept internal API key', async () => {
      app = await buildApp();
      
      vi.mocked(S3Service.listKeys).mockResolvedValue([]);
      vi.mocked(prisma.projectFile.findMany).mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/storage/stats',
        headers: { 'x-internal-api-key': 'test-api-key' },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
