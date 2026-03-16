import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Elasticsearch
vi.mock('../src/services/elasticsearch.service.js', () => ({
  esClient: {
    index: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    bulk: vi.fn().mockResolvedValue({}),
    indices: {
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  },
  IndexManager: {
    ensureCodeIndex: vi.fn().mockResolvedValue(undefined),
    ensureProjectIndex: vi.fn().mockResolvedValue(undefined),
    deleteCodeIndex: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Prisma
vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    projectFile: {
      findMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('File Indexer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should index a file to Elasticsearch', async () => {
    const { esClient, IndexManager } = await import('../src/services/elasticsearch.service.js');
    const { FileIndexer } = await import('../src/indexers/file-indexer.js');

    await FileIndexer.indexFile(
      'project-123',
      'file-456',
      'console.log("hello")',
      'src/index.ts',
      'typescript',
      100
    );

    expect(IndexManager.ensureCodeIndex).toHaveBeenCalledWith('project-123');
    expect(esClient.index).toHaveBeenCalledWith({
      index: 'code_project_123',
      id: 'file-456',
      document: expect.objectContaining({
        fileId: 'file-456',
        filePath: 'src/index.ts',
        language: 'typescript',
        projectId: 'project-123',
      }),
    });
  });

  it('should delete a file from Elasticsearch', async () => {
    const { esClient } = await import('../src/services/elasticsearch.service.js');
    const { FileIndexer } = await import('../src/indexers/file-indexer.js');

    await FileIndexer.deleteFile('project-123', 'file-456');

    expect(esClient.delete).toHaveBeenCalledWith({
      index: 'code_project_123',
      id: 'file-456',
    });
  });

  it('should bulk reindex all project files', async () => {
    const { prisma } = await import('../src/lib/prisma.js');
    const { esClient } = await import('../src/services/elasticsearch.service.js');
    const { FileIndexer } = await import('../src/indexers/file-indexer.js');

    vi.mocked(prisma.projectFile.findMany).mockResolvedValue([
      {
        id: 'file-1',
        path: 'src/index.ts',
        inlineContent: Buffer.from('content1'),
        language: 'typescript',
        sizeBytes: 100,
        updatedAt: new Date(),
      },
      {
        id: 'file-2',
        path: 'src/utils.ts',
        inlineContent: Buffer.from('content2'),
        language: 'typescript',
        sizeBytes: 200,
        updatedAt: new Date(),
      },
    ] as any);

    const result = await FileIndexer.bulkReindex('project-123');

    expect(result.indexed).toBe(2);
    expect(result.errors).toBe(0);
    expect(esClient.bulk).toHaveBeenCalled();
  });
});

describe('Project Indexer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should index a project to Elasticsearch', async () => {
    const { esClient, IndexManager } = await import('../src/services/elasticsearch.service.js');
    const { ProjectIndexer } = await import('../src/indexers/project-indexer.js');

    await ProjectIndexer.indexProject({
      id: 'project-123',
      name: 'Test Project',
      description: 'A test project',
      template: 'react',
      ownerId: 'user-456',
      visibility: 'public',
      language: 'typescript',
      framework: 'react',
      lastOpenedAt: new Date(),
      createdAt: new Date(),
    });

    expect(IndexManager.ensureProjectIndex).toHaveBeenCalled();
    expect(esClient.index).toHaveBeenCalledWith({
      index: 'projects_global',
      id: 'project-123',
      document: expect.objectContaining({
        projectId: 'project-123',
        name: 'Test Project',
        visibility: 'public',
      }),
    });
  });

  it('should delete a project and its code index', async () => {
    const { esClient, IndexManager } = await import('../src/services/elasticsearch.service.js');
    const { ProjectIndexer } = await import('../src/indexers/project-indexer.js');

    await ProjectIndexer.deleteProject('project-123');

    expect(esClient.delete).toHaveBeenCalledWith({
      index: 'projects_global',
      id: 'project-123',
    });
    expect(IndexManager.deleteCodeIndex).toHaveBeenCalledWith('project-123');
  });
});

describe('Bulk Reindexer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reindex all projects', async () => {
    const { prisma } = await import('../src/lib/prisma.js');
    const { FileIndexer } = await import('../src/indexers/file-indexer.js');
    const { ProjectIndexer } = await import('../src/indexers/project-indexer.js');
    const { BulkReindexer } = await import('../src/indexers/bulk-reindexer.js');

    vi.mocked(prisma.project.findMany).mockResolvedValue([
      {
        id: 'project-1',
        name: 'Project 1',
        description: 'Test',
        template: null,
        ownerId: 'user-1',
        visibility: 'public',
        language: 'typescript',
        framework: null,
        lastOpenedAt: new Date(),
        createdAt: new Date(),
      },
    ] as any);

    // Mock the indexer methods
    vi.spyOn(ProjectIndexer, 'indexProject').mockResolvedValue(undefined);
    vi.spyOn(FileIndexer, 'bulkReindex').mockResolvedValue({ indexed: 5, errors: 0 });

    const result = await BulkReindexer.reindexAll();

    expect(result.projects).toBe(1);
    expect(result.files).toBe(5);
  });

  it('should reindex a specific project', async () => {
    const { prisma } = await import('../src/lib/prisma.js');
    const { FileIndexer } = await import('../src/indexers/file-indexer.js');
    const { ProjectIndexer } = await import('../src/indexers/project-indexer.js');
    const { BulkReindexer } = await import('../src/indexers/bulk-reindexer.js');

    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'project-123',
      name: 'Test Project',
      description: 'Test',
      template: null,
      ownerId: 'user-1',
      visibility: 'public',
      language: 'typescript',
      framework: null,
      lastOpenedAt: new Date(),
      createdAt: new Date(),
    } as any);

    vi.spyOn(ProjectIndexer, 'indexProject').mockResolvedValue(undefined);
    vi.spyOn(FileIndexer, 'bulkReindex').mockResolvedValue({ indexed: 10, errors: 1 });

    const result = await BulkReindexer.reindexProject('project-123');

    expect(result.files).toBe(10);
    expect(result.errors).toBe(1);
  });
});
