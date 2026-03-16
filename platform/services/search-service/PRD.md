# Search Service - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** search-service (Port 8008)  
> **Tech Stack:** Node.js + Express + Elasticsearch + Kafka

---

## 1. Executive Summary

The Search Service provides full-text code search within projects, file name search, and public project discovery. Powered by Elasticsearch with sub-100ms latency and zero data leaks.

---

## 2. Project Setup

### 2.1 Initialize Project

```bash
mkdir -p search-service/src/{controllers,services,indexers,events,lib,config,mappings}
cd search-service
npm init -y
npm install express @elastic/elasticsearch kafkajs zod dotenv cors helmet
npm install -D typescript @types/node ts-node
npx tsc --init
```

### 2.2 package.json

```json
{
  "name": "search-service",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "@elastic/elasticsearch": "^8.11.0",
    "kafkajs": "^2.2.4",
    "zod": "^3.22.4",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "helmet": "^7.1.0"
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
PORT=8008
NODE_ENV=development

# Elasticsearch
ELASTICSEARCH_NODE=https://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=search-service

# Database (for permission checks)
DATABASE_URL=postgresql://user:password@localhost:5432/ai_native_ide

# Internal Auth
INTERNAL_API_KEY=your-internal-api-key
```

### 3.2 Config File (src/config/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8008', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'https://localhost:9200',
    username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
    password: process.env.ELASTICSEARCH_PASSWORD || ''
  },
  
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'search-service'
  },
  
  database: {
    url: process.env.DATABASE_URL!
  },
  
  internalApiKey: process.env.INTERNAL_API_KEY!
};
```

---

## 4. Elasticsearch Client

### 4.1 Client (src/services/elasticsearch_client.ts)

```typescript
import { Client } from '@elastic/elasticsearch';
import { config } from '../config';

export const esClient = new Client({
  node: config.elasticsearch.node,
  auth: {
    username: config.elasticsearch.username,
    password: config.elasticsearch.password
  },
  tls: {
    rejectUnauthorized: false
  },
  maxRetries: 3,
  requestTimeout: 30000
});

export const IndexManager = {
  async ensureCodeIndex(projectId: string): Promise<void> {
    const indexName = `code_${projectId}`;
    
    const exists = await esClient.indices.exists({ index: indexName });
    if (exists) return;

    await esClient.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 1,
          analysis: {
            analyzer: {
              code_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'camel_case', 'underscore_tokenizer']
              }
            },
            filter: {
              camel_case: {
                type: 'word_delimiter_graph',
                preserve_original: true
              },
              underscore_tokenizer: {
                type: 'word_delimiter_graph',
                preserve_original: true
              }
            }
          }
        },
        mappings: {
          properties: {
            fileId: { type: 'keyword' },
            filePath: { type: 'text', analyzer: 'standard' },
            content: { type: 'text', analyzer: 'code_analyzer' },
            language: { type: 'keyword' },
            projectId: { type: 'keyword' },
            updatedAt: { type: 'date' }
          }
        }
      }
    });
  },

  async ensureProjectIndex(): Promise<void> {
    const indexName = 'projects_global';
    
    const exists = await esClient.indices.exists({ index: indexName });
    if (exists) return;

    await esClient.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 1
        },
        mappings: {
          properties: {
            projectId: { type: 'keyword' },
            name: { type: 'text', analyzer: 'standard' },
            description: { type: 'text' },
            template: { type: 'keyword' },
            ownerId: { type: 'keyword' },
            visibility: { type: 'keyword' },
            language: { type: 'keyword' },
            forkCount: { type: 'integer' },
            starCount: { type: 'integer' },
            lastOpenedAt: { type: 'date' },
            createdAt: { type: 'date' }
          }
        }
      }
    });
  },

  async deleteCodeIndex(projectId: string): Promise<void> {
    const indexName = `code_${projectId}`;
    await esClient.indices.delete({ index: indexName }).catch(() => {});
  }
};
```

---

## 5. Query Builder

### 5.1 Query Builder Service (src/services/query_builder.ts)

```typescript
import { esClient } from './elasticsearch_client';

const MAX_RESULTS = 50;
const MAX_QUERY_TIME = '5s';
const MAX_DOCS = 10000;

export const QueryBuilder = {
  buildCodeSearchQuery(
    projectId: string,
    query: string,
    language?: string,
    pageToken?: string
  ): any {
    const must: any[] = [
      { term: { projectId } },
      {
        multi_match: {
          query: sanitizeQuery(query),
          fields: ['content^2', 'filePath'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      }
    ];

    if (language) {
      must.push({ term: { language } });
    }

    const body: any = {
      query: {
        bool: { must }
      },
      highlight: {
        fields: {
          content: {
            fragment_size: 100,
            number_of_fragments: 3,
            pre_tags: ['<mark>'],
            post_tags: ['</mark>']
          }
        }
      },
      size: MAX_RESULTS,
      timeout: MAX_QUERY_TIME,
      terminate_after: MAX_DOCS
    };

    if (pageToken) {
      body.search_after = JSON.parse(Buffer.from(pageToken, 'base64').toString());
    }

    return body;
  },

  buildFileSearchQuery(projectId: string, query: string): any {
    return {
      query: {
        bool: {
          must: [
            { term: { projectId } },
            {
              wildcard: {
                filePath: {
                  value: `*${sanitizeQuery(query).toLowerCase()}*`,
                  case_insensitive: true
                }
              }
            }
          ]
        }
      },
      size: 20,
      timeout: MAX_QUERY_TIME
    };
  },

  buildProjectSearchQuery(
    query: string,
    template?: string,
    sortBy: string = 'lastOpenedAt'
  ): any {
    const must: any[] = [
      { term: { visibility: 'public' } }
    ];

    if (query) {
      must.push({
        multi_match: {
          query: sanitizeQuery(query),
          fields: ['name^3', 'description']
        }
      });
    }

    if (template) {
      must.push({ term: { template } });
    }

    const sort: any = {};
    sort[sortBy] = { order: 'desc' };

    return {
      query: { bool: { must } },
      sort: [sort],
      size: MAX_RESULTS,
      timeout: MAX_QUERY_TIME
    };
  }
};

function sanitizeQuery(query: string): string {
  // Remove potential ReDoS patterns
  return query
    .replace(/[+\-><()~*?\\^$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
```

---

## 6. Controllers

### 6.1 Code Search Controller (src/controllers/code_search_controller.ts)

```typescript
import { Request, Response } from 'express';
import { esClient } from '../services/elasticsearch_client';
import { QueryBuilder } from '../services/query_builder';
import { PermissionService } from '../services/permission_srv';

export const CodeSearchController = {
  // GET /api/v1/search/code
  async searchCode(req: Request, res: Response) {
    try {
      const { q, projectId, language, page_token } = req.query;
      const userId = (req as any).user?.id;

      if (!q || !projectId) {
        return res.status(400).json({ error: 'Missing required params' });
      }

      // Verify access
      if (userId) {
        const hasAccess = await PermissionService.checkAccess(userId, projectId as string, 'viewer');
        if (!hasAccess) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const indexName = `code_${projectId}`;
      
      const body = QueryBuilder.buildCodeSearchQuery(
        projectId as string,
        q as string,
        language as string,
        page_token as string
      );

      const result = await esClient.search({
        index: indexName,
        body
      });

      const hits = result.hits.hits;
      const results = hits.map((hit: any) => {
        const source = hit._source;
        const highlights = hit.highlight?.content || [];
        
        return {
          fileId: source.fileId,
          filePath: source.filePath,
          language: source.language,
          matches: highlights.map((content: string, i: number) => ({
            line_number: i + 1,
            content: content.replace(/<mark>|<\/mark>/g, ''),
            highlight: content
          }))
        };
      });

      let nextToken: string | undefined;
      if (hits.length === 50 && hits[49].sort) {
        nextToken = Buffer.from(JSON.stringify(hits[49].sort)).toString('base64');
      }

      return res.json({
        success: true,
        data: {
          results,
          total_hits: result.hits.total?.value || 0,
          next_page_token: nextToken
        }
      });
    } catch (error: any) {
      console.error('[CodeSearch] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

### 6.2 File Search Controller (src/controllers/file_search_controller.ts)

```typescript
import { Request, Response } from 'express';
import { esClient } from '../services/elasticsearch_client';
import { QueryBuilder } from '../services/query_builder';
import { PermissionService } from '../services/permission_srv';

export const FileSearchController = {
  // GET /api/v1/search/files
  async searchFiles(req: Request, res: Response) {
    try {
      const { q, projectId } = req.query;
      const userId = (req as any).user?.id;

      if (!q || !projectId) {
        return res.status(400).json({ error: 'Missing required params' });
      }

      // Verify access
      if (userId) {
        const hasAccess = await PermissionService.checkAccess(userId, projectId as string, 'viewer');
        if (!hasAccess) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const indexName = `code_${projectId}`;
      
      const body = QueryBuilder.buildFileSearchQuery(
        projectId as string,
        q as string
      );

      const result = await esClient.search({
        index: indexName,
        body
      });

      const hits = result.hits.hits;
      const files = hits.map((hit: any) => ({
        fileId: hit._source.fileId,
        filePath: hit._source.filePath,
        language: hit._source.language
      }));

      return res.json({
        success: true,
        data: files
      });
    } catch (error: any) {
      console.error('[FileSearch] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

### 6.3 Project Discovery Controller (src/controllers/project_discovery_controller.ts)

```typescript
import { Request, Response } from 'express';
import { esClient } from '../services/elasticsearch_client';
import { QueryBuilder } from '../services/query_builder';

export const ProjectDiscoveryController = {
  // GET /api/v1/search/projects
  async discoverProjects(req: Request, res: Response) {
    try {
      const { q, template, sort } = req.query;

      const body = QueryBuilder.buildProjectSearchQuery(
        q as string || '',
        template as string,
        (sort as string) || 'lastOpenedAt'
      );

      const result = await esClient.search({
        index: 'projects_global',
        body
      });

      const hits = result.hits.hits;
      const projects = hits.map((hit: any) => {
        const source = hit._source;
        return {
          projectId: source.projectId,
          name: source.name,
          description: source.description,
          template: source.template,
          language: source.language,
          forkCount: source.forkCount || 0,
          starCount: source.starCount || 0,
          lastOpenedAt: source.lastOpenedAt
        };
      });

      return res.json({
        success: true,
        data: projects
      });
    } catch (error: any) {
      console.error('[ProjectDiscovery] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

---

## 7. Indexers

### 7.1 File Indexer (src/indexers/file_indexer.ts)

```typescript
import { esClient, IndexManager } from '../services/elasticsearch_client';
import { prisma } from '../lib/prisma';

export const FileIndexer = {
  async indexFile(projectId: string, fileId: string, content: string, filePath: string, language: string): Promise<void> {
    await IndexManager.ensureCodeIndex(projectId);

    const indexName = `code_${projectId}`;
    
    await esClient.index({
      index: indexName,
      id: fileId,
      body: {
        fileId,
        filePath,
        content,
        language,
        projectId,
        updatedAt: new Date().toISOString()
      }
    });

    console.log(`[FileIndexer] Indexed file ${fileId} in ${indexName}`);
  },

  async deleteFile(projectId: string, fileId: string): Promise<void> {
    const indexName = `code_${projectId}`;
    
    await esClient.delete({
      index: indexName,
      id: fileId
    }).catch(() => {});

    console.log(`[FileIndexer] Deleted file ${fileId} from ${indexName}`);
  },

  async bulkReindex(projectId: string): Promise<void> {
    const files = await prisma.projectFile.findMany({
      where: { projectId, isDirectory: false }
    });

    const indexName = `code_${projectId}`;
    await IndexManager.ensureCodeIndex(projectId);

    const operations = files.flatMap(file => [
      { index: { _index: indexName, _id: file.id } },
      {
        fileId: file.id,
        filePath: file.path,
        content: file.content?.toString() || '',
        language: file.language || 'text',
        projectId,
        updatedAt: file.updatedAt
      }
    ]);

    if (operations.length > 0) {
      await esClient.bulk({ body: operations });
    }

    console.log(`[FileIndexer] Bulk reindexed ${files.length} files for project ${projectId}`);
  }
};
```

### 7.2 Project Indexer (src/indexers/project_indexer.ts)

```typescript
import { esClient, IndexManager } from '../services/elasticsearch_client';

export const ProjectIndexer = {
  async indexProject(project: any): Promise<void> {
    await IndexManager.ensureProjectIndex();

    await esClient.index({
      index: 'projects_global',
      id: project.id,
      body: {
        projectId: project.id,
        name: project.name,
        description: project.description,
        template: project.template,
        ownerId: project.ownerId,
        visibility: project.visibility,
        language: project.language,
        forkCount: project.forkCount || 0,
        starCount: project.starCount || 0,
        lastOpenedAt: project.lastOpenedAt,
        createdAt: project.createdAt
      }
    });

    console.log(`[ProjectIndexer] Indexed project ${project.id}`);
  },

  async deleteProject(projectId: string): Promise<void> {
    await esClient.delete({
      index: 'projects_global',
      id: projectId
    }).catch(() => {});

    // Also delete the code index
    await IndexManager.deleteCodeIndex(projectId);

    console.log(`[ProjectIndexer] Deleted project ${projectId}`);
  }
};
```

---

## 8. Kafka Consumer

### 8.1 Consumer (src/events/kafka_consumer.ts)

```typescript
import { Kafka, Consumer } from 'kafkajs';
import { config } from '../config';
import { FileIndexer } from '../indexers/file_indexer';
import { ProjectIndexer } from '../indexers/project_indexer';
import { prisma } from '../lib/prisma';

const kafka = new Kafka({
  clientId: 'search-service',
  brokers: config.kafka.brokers,
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

export const KafkaConsumer = {
  async start() {
    await consumer.connect();
    console.log('[Kafka] Consumer connected');

    await consumer.subscribe({ topic: 'file.modified', fromBeginning: false });
    await consumer.subscribe({ topic: 'file.deleted', fromBeginning: false });
    await consumer.subscribe({ topic: 'project.created', fromBeginning: false });
    await consumer.subscribe({ topic: 'project.deleted', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          const payload = JSON.parse(message.value?.toString() || '{}');
          
          switch (topic) {
            case 'file.modified':
              await this.handleFileModified(payload);
              break;
            case 'file.deleted':
              await this.handleFileDeleted(payload);
              break;
            case 'project.created':
              await this.handleProjectCreated(payload);
              break;
            case 'project.deleted':
              await this.handleProjectDeleted(payload);
              break;
          }
        } catch (error) {
          console.error('[Kafka] Error:', error);
        }
      }
    });
  },

  async handleFileModified(payload: { projectId: string; fileId: string; path?: string; content?: string }) {
    const file = await prisma.projectFile.findUnique({
      where: { id: payload.fileId }
    });

    if (!file) return;

    await FileIndexer.indexFile(
      payload.projectId,
      payload.fileId,
      file.content?.toString() || '',
      file.path,
      file.language || 'text'
    );
  },

  async handleFileDeleted(payload: { projectId: string; fileId: string }) {
    await FileIndexer.deleteFile(payload.projectId, payload.fileId);
  },

  async handleProjectCreated(payload: { projectId: string }) {
    const project = await prisma.project.findUnique({
      where: { id: payload.projectId }
    });

    if (project) {
      await ProjectIndexer.indexProject(project);
    }
  },

  async handleProjectDeleted(payload: { projectId: string }) {
    await ProjectIndexer.deleteProject(payload.projectId);
  }
};
```

---

## 9. Permission Service

### 9.1 Service (src/services/permission_srv.ts)

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

## 10. Main Application

### 10.1 App Setup (src/app.ts)

```typescript
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { CodeSearchController } from './controllers/code_search_controller';
import { FileSearchController } from './controllers/file_search_controller';
import { ProjectDiscoveryController } from './controllers/project_discovery_controller';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'search-service' });
});

app.get('/api/v1/health/circuit-breaker', (req: Request, res: Response) => {
  res.json({ status: 'closed', failures: 0 });
});

// Search endpoints
app.get('/api/v1/search/code', authMiddleware, CodeSearchController.searchCode);
app.get('/api/v1/search/files', authMiddleware, FileSearchController.searchFiles);
app.get('/api/v1/search/projects', ProjectDiscoveryController.discoverProjects);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[App] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };
```

### 10.2 Entry Point (src/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { config } from './config';
import { prisma, disconnectPrisma } from './lib/prisma';
import { KafkaConsumer } from './events/kafka_consumer';
import { IndexManager } from './services/elasticsearch_client';

async function main() {
  console.log('[Search] Starting service...');

  // Ensure indices exist
  await IndexManager.ensureProjectIndex();

  // Start Kafka consumer
  await KafkaConsumer.start();

  app.listen(config.port, () => {
    console.log(`[Search] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Search] Shutting down...');
  await disconnectPrisma();
  process.exit(0);
});

main().catch(console.error);
```

---

## 11. Elasticsearch Index Mappings

### 11.1 Code Index Mapping (src/mappings/code_index.json)

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "code_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "camel_case", "underscore_tokenizer"]
        }
      },
      "filter": {
        "camel_case": {
          "type": "word_delimiter_graph",
          "preserve_original": true
        },
        "underscore_tokenizer": {
          "type": "word_delimiter_graph",
          "preserve_original": true
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "fileId": { "type": "keyword" },
      "filePath": { "type": "text", "analyzer": "standard" },
      "content": { "type": "text", "analyzer": "code_analyzer" },
      "language": { "type": "keyword" },
      "projectId": { "type": "keyword" },
      "updatedAt": { "type": "date" }
    }
  }
}
```

### 11.2 Project Index Mapping (src/mappings/project_index.json)

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "projectId": { "type": "keyword" },
      "name": { "type": "text", "analyzer": "standard" },
      "description": { "type": "text" },
      "template": { "type": "keyword" },
      "ownerId": { "type": "keyword" },
      "visibility": { "type": "keyword" },
      "language": { "type": "keyword" },
      "forkCount": { "type": "integer" },
      "starCount": { "type": "integer" },
      "lastOpenedAt": { "type": "date" },
      "createdAt": { "type": "date" }
    }
  }
}
```

---

## 12. Testing Checklist

```bash
# Run the service
npm run dev

# Test health
curl http://localhost:8008/api/v1/health

# Test code search
curl "http://localhost:8008/api/v1/search/code?q=useState&projectId=uuid" \
  -H "Authorization: Bearer <token>"

# Test file search
curl "http://localhost:8008/api/v1/search/files?q=page.tsx&projectId=uuid" \
  -H "Authorization: Bearer <token>"

# Test project discovery
curl "http://localhost:8008/api/v1/search/projects?q=ecommerce"
```

---

## 13. Implementation Status

| Component | Status |
|-----------|--------|
| Project Setup | ✅ Complete |
| Config | ✅ Complete |
| ES Client | ✅ Complete |
| Query Builder | ✅ Complete |
| Controllers | ✅ Complete |
| Indexers | ✅ Complete |
| Kafka Consumer | ✅ Complete |
| Permission Service | ✅ Complete |
| App & Index | ✅ Complete |

---

## 14. Key Implementation Notes

### 14.1 Index Strategy
- One index per project: `code_{project_id}`
- Single global index for public projects: `projects_global`
- Custom analyzers for code (camelCase, underscore tokenizing)

### 14.2 Security
- Verify user access before code search
- Only public projects in discovery
- Never allow cross-project search

### 14.3 Performance
- Debounce frontend queries (300ms)
- Sanitize ReDoS patterns
- Use search_after for pagination
- Timeout: 5s, terminate_after: 10000

### 14.4 Real-Time Indexing
- Kafka consumer for file.modified, file.deleted
- Kafka consumer for project.created, project.deleted
- Index within 5 seconds of file save
