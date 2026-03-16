import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

// Mock Elasticsearch client
vi.mock('../src/services/elasticsearch.service.js', () => ({
  esClient: {
    search: vi.fn(),
    indices: {
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    cluster: {
      health: vi.fn().mockResolvedValue({ status: 'green', cluster_name: 'test-cluster' }),
    },
    index: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    bulk: vi.fn().mockResolvedValue({}),
  },
  IndexManager: {
    ensureCodeIndex: vi.fn().mockResolvedValue(undefined),
    ensureProjectIndex: vi.fn().mockResolvedValue(undefined),
    deleteCodeIndex: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ status: 'green', cluster_name: 'test-cluster' }),
  },
}));

// Mock Prisma
vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    projectFile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    projectCollaborator: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
  disconnectPrisma: vi.fn().mockResolvedValue(undefined),
}));

// Mock Kafka
vi.mock('../src/events/kafka-consumer.js', () => ({
  KafkaConsumer: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Search Service', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.KAFKA_ENABLED = 'false';
    process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';
    process.env.JWT_SECRET = 'test-secret';
    process.env.INTERNAL_API_KEY = 'test-api-key';
    
    app = await buildApp();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Health Endpoints', () => {
    it('GET /health should return service status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('search-service');
      expect(body.elasticsearch).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('GET /health/circuit-breaker should return circuit breaker status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/circuit-breaker',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('closed');
      expect(body.failures).toBe(0);
    });
  });

  describe('Code Search Endpoint', () => {
    it('GET /api/v1/search/code should reject without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/code',
        query: { q: 'function', projectId: 'test-project-id' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Unauthorized');
    });

    it('GET /api/v1/search/code should accept with X-User-Id header', async () => {
      const { prisma } = await import('../src/lib/prisma.js');
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      // Mock permission check
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'test-project-id',
        ownerId: 'user-123',
        visibility: 'public',
      } as any);
      
      // Mock ES search
      vi.mocked(esClient.search).mockResolvedValue({
        hits: {
          total: { value: 0 },
          hits: [],
        },
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/code',
        query: { q: 'function', projectId: 'test-project-id' },
        headers: { 'x-user-id': 'user-123' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('GET /api/v1/search/code should reject with missing params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/code',
        headers: { 'x-user-id': 'user-123' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('GET /api/v1/search/code should accept with internal API key', async () => {
      const { prisma } = await import('../src/lib/prisma.js');
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'test-project-id',
        ownerId: 'user-123',
        visibility: 'public',
      } as any);
      
      vi.mocked(esClient.search).mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/code',
        query: { q: 'function', projectId: 'test-project-id' },
        headers: { 'x-internal-api-key': 'internal-api-key' }, // Match the default config value
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('File Search Endpoint', () => {
    it('GET /api/v1/search/files should reject without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/files',
        query: { q: 'index.ts', projectId: 'test-project-id' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('GET /api/v1/search/files should accept with auth', async () => {
      const { prisma } = await import('../src/lib/prisma.js');
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'test-project-id',
        ownerId: 'user-123',
        visibility: 'public',
      } as any);
      
      vi.mocked(esClient.search).mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/files',
        query: { q: 'index.ts', projectId: 'test-project-id' },
        headers: { 'x-user-id': 'user-123' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });
  });

  describe('Project Discovery Endpoint', () => {
    it('GET /api/v1/search/projects should allow anonymous access', async () => {
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      vi.mocked(esClient.search).mockResolvedValue({
        hits: {
          total: { value: 2 },
          hits: [
            { _source: { projectId: 'p1', name: 'Project 1', visibility: 'public' } },
            { _source: { projectId: 'p2', name: 'Project 2', visibility: 'public' } },
          ],
        },
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/projects',
        query: { q: 'test' },
      });

      // Should not return 401 (unauthorized)
      expect(response.statusCode).not.toBe(401);
    });

    it('GET /api/v1/search/projects should filter by language', async () => {
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      vi.mocked(esClient.search).mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/projects',
        query: { q: 'test', language: 'typescript' },
      });

      expect(response.statusCode).toBe(200);
      // Verify ES was called
      expect(esClient.search).toHaveBeenCalled();
    });

    it('GET /api/v1/search/projects should filter by template', async () => {
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      vi.mocked(esClient.search).mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/projects',
        query: { template: 'react' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Permission Service', () => {
    it('should deny access to private projects for non-owners', async () => {
      const { prisma } = await import('../src/lib/prisma.js');
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'private-project',
        ownerId: 'owner-123',
        visibility: 'private',
      } as any);
      
      vi.mocked(prisma.projectCollaborator.findFirst).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/code',
        query: { q: 'test', projectId: 'private-project' },
        headers: { 'x-user-id': 'other-user' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('Access denied');
    });

    it('should allow access to public projects for anyone', async () => {
      const { prisma } = await import('../src/lib/prisma.js');
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'public-project',
        ownerId: 'owner-123',
        visibility: 'public',
      } as any);
      
      vi.mocked(esClient.search).mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/code',
        query: { q: 'test', projectId: 'public-project' },
        headers: { 'x-user-id': 'anonymous-user' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Query Sanitization', () => {
    it('should sanitize malicious regex patterns', async () => {
      const { prisma } = await import('../src/lib/prisma.js');
      const { esClient } = await import('../src/services/elasticsearch.service.js');
      
      vi.mocked(prisma.project.findUnique).mockResolvedValue({
        id: 'test-project',
        ownerId: 'user-123',
        visibility: 'public',
      } as any);
      
      vi.mocked(esClient.search).mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      } as any);

      // Attempt ReDoS attack
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/search/code',
        query: { q: '(a+)+$', projectId: 'test-project' },
        headers: { 'x-user-id': 'user-123' },
      });

      expect(response.statusCode).toBe(200);
      // Verify the query was sanitized (special chars removed)
      const searchCall = vi.mocked(esClient.search).mock.calls[0];
      const body = searchCall[0] as any;
      expect(body.body.query.bool.must[1].multi_match.query).not.toContain('$');
    });
  });
});
