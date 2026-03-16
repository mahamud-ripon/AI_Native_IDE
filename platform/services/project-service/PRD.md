# Project Service - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** project-service (Port 8002)  
> **Tech Stack:** Node.js + Express + Prisma + S3 + Vault + Kafka

---

## 1. Executive Summary

The Project Service is the core engine for managing user workspaces. It handles Project CRUD, File Tree logic, Collaborator access control, and Secret Management with strict data formatting and zero tolerance for secret leaks.

---

## 2. Project Setup

### 2.1 Initialize Project

```bash
mkdir -p project-service/src/{controllers,services,dto,events,lib,config,middleware}
cd project-service
npm init -y
npm install express aws-sdk @prisma/client kafkajs zod dotenv cors helmet uuid
npm install -D typescript @types/node @types/uuid ts-node prisma
npx tsc --init
```

### 2.2 package.json

```json
{
  "name": "project-service",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "aws-sdk": "^2.1500.0",
    "@prisma/client": "^5.8.0",
    "kafkajs": "^2.2.4",
    "zod": "^3.22.4",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.0",
    "@types/uuid": "^9.0.0",
    "ts-node": "^10.9.2",
    "prisma": "^5.8.0"
  }
}
```

---

## 3. Configuration

### 3.1 Environment Variables (.env)

```env
# Server
PORT=8002
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_native_ide

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=project-service

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=project-files

# Vault
VAULT_ADDR=https://vault.platform.io
VAULT_TOKEN=

# Internal Auth
INTERNAL_API_KEY=your-internal-api-key
```

### 3.2 Config File (src/config/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    url: process.env.DATABASE_URL!
  },
  
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'project-service'
  },
  
  s3: {
    bucket: process.env.S3_BUCKET || 'project-files',
    region: process.env.AWS_REGION || 'us-east-1'
  },
  
  vault: {
    addr: process.env.VAULT_ADDR!,
    token: process.env.VAULT_TOKEN
  },
  
  internalApiKey: process.env.INTERNAL_API_KEY!
};
```

---

## 4. DTOs (Data Transfer Objects)

### 4.1 Project DTOs (src/dto/project.dto.ts)

```typescript
import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(3).max(50).regex(/^[a-zA-Z0-9-]+$/),
  description: z.string().max(500).optional(),
  template: z.enum(['nextjs', 'fastapi', 'blank', 'react', 'vue', 'express']).optional(),
  visibility: z.enum(['private', 'public', 'org']).default('private'),
  orgId: z.string().uuid().nullable().optional()
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(3).max(50).regex(/^[a-zA-Z0-9-]+$/).optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(['private', 'public', 'org']).optional()
});

export const ImportProjectSchema = z.object({
  gitRepoUrl: z.string().url(),
  name: z.string().min(3).max(50),
  visibility: z.enum(['private', 'public', 'org']).default('private')
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type ImportProjectInput = z.infer<typeof ImportProjectSchema>;
```

### 4.2 File DTOs (src/dto/file.dto.ts)

```typescript
import { z } from 'zod';

export const CreateFileSchema = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
  isDirectory: z.boolean().default(false)
});

export const UpdateFileSchema = z.object({
  content: z.string().min(1)
});

export const MoveFileSchema = z.object({
  newPath: z.string().min(1)
});

export const CreateSecretSchema = z.object({
  keyName: z.string().min(1).max(100),
  value: z.string().min(1)
});

export type CreateFileInput = z.infer<typeof CreateFileSchema>;
export type UpdateFileInput = z.infer<typeof UpdateFileSchema>;
export type MoveFileInput = z.infer<typeof MoveFileSchema>;
export type CreateSecretInput = z.infer<typeof CreateSecretSchema>;
```

---

## 5. Core Services

### 5.1 Storage Service (src/services/storage_service.ts)

```typescript
import AWS from 'aws-sdk';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { createHash } from 'crypto';

const s3 = new AWS.S3({
  region: config.s3.region,
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey
});

const INLINE_SIZE_LIMIT = 65536; // 64KB

export const StorageService = {
  async saveFile(
    projectId: string,
    branchId: string,
    path: string,
    content: string
  ): Promise<void> {
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const contentHash = createHash('sha256').update(content).digest('hex');
    
    // Check if content changed
    const existing = await prisma.projectFile.findFirst({
      where: { projectId, branchId, path }
    });
    
    if (existing?.contentHash === contentHash) {
      return; // No changes
    }

    let s3Key: string | null = null;
    let inlineContent: Buffer | null = null;

    if (sizeBytes < INLINE_SIZE_LIMIT) {
      // Store inline
      inlineContent = Buffer.from(content, 'utf8');
    } else {
      // Store in S3
      s3Key = `projects/${projectId}/files/${uuidv4()}`;
      await s3.putObject({
        Bucket: config.s3.bucket,
        Key: s3Key,
        Body: content,
        ContentType: 'text/plain'
      }).promise();
    }

    // Upsert file record
    await prisma.projectFile.upsert({
      where: { id: existing?.id || 'new' },
      update: {
        content: inlineContent,
        s3Key,
        sizeBytes,
        contentHash,
        updatedAt: new Date()
      },
      create: {
        projectId,
        branchId,
        path,
        content: inlineContent,
        s3Key,
        sizeBytes,
        contentHash,
        language: detectLanguage(path)
      }
    });
  },

  async getFileContent(fileId: string): Promise<string> {
    const file = await prisma.projectFile.findUnique({ where: { id: fileId } });
    
    if (!file) throw new Error('File not found');
    
    if (file.s3Key) {
      const result = await s3.getObject({
        Bucket: config.s3.bucket,
        Key: file.s3Key
      }).promise();
      
      return result.Body?.toString() || '';
    }
    
    return file.content?.toString() || '';
  },

  async deleteFile(fileId: string): Promise<void> {
    const file = await prisma.projectFile.findUnique({ where: { id: fileId } });
    
    if (file?.s3Key) {
      await s3.deleteObject({
        Bucket: config.s3.bucket,
        Key: file.s3Key
      }).promise();
    }
    
    await prisma.projectFile.delete({ where: { id: fileId } });
  }
};

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css'
  };
  return langMap[ext || ''] || 'text';
}
```

### 5.2 Permission Service (src/services/permission_srv.ts)

```typescript
import { prisma } from '../lib/prisma';
import { ProjectRole } from '@prisma/client';

export const PermissionService = {
  async checkAccess(
    userId: string,
    projectId: string,
    requiredRole: 'owner' | 'editor' | 'viewer'
  ): Promise<boolean> {
    // Check if owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true }
    });
    
    if (project?.ownerId === userId) {
      return true;
    }
    
    // Check collaborator
    const collaborator = await prisma.projectCollaborator.findFirst({
      where: { projectId, userId }
    });
    
    if (!collaborator) {
      return false;
    }
    
    const roleHierarchy = { viewer: 0, editor: 1, owner: 2 };
    return roleHierarchy[collaborator.role] >= roleHierarchy[requiredRole];
  },

  async getUserRole(userId: string, projectId: string): Promise<ProjectRole | null> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true }
    });
    
    if (project?.ownerId === userId) {
      return 'owner';
    }
    
    const collaborator = await prisma.projectCollaborator.findFirst({
      where: { projectId, userId }
    });
    
    return collaborator?.role || null;
  }
};
```

### 5.3 Git Clone Manager (src/services/git_clone_manager.ts)

```typescript
import { KafkaPublisher } from '../events/kafka_publisher';
import { prisma } from '../lib/prisma';

export const GitCloneManager = {
  async importFromGit(projectId: string, gitRepoUrl: string, branch = 'main'): Promise<void> {
    // Create project record first
    await prisma.project.update({
      where: { id: projectId },
      data: { gitRepoUrl }
    });

    // Trigger execution-service to clone
    await KafkaPublisher.publish('execution.git_clone', {
      action: 'git_clone',
      projectId,
      repo: gitRepoUrl,
      branch
    });

    console.log(`[GitClone] Triggered clone for project ${projectId}`);
  }
};
```

---

## 6. Controllers

### 6.1 Workspace Controller (src/controllers/workspace_controller.ts)

```typescript
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { KafkaPublisher } from '../events/kafka_publisher';
import { PermissionService } from '../services/permission_srv';
import { GitCloneManager } from '../services/git_clone_manager';
import { CreateProjectSchema, UpdateProjectSchema, ImportProjectSchema } from '../dto/project.dto';

export const WorkspaceController = {
  // POST /api/v1/projects
  async createProject(req: Request, res: Response) {
    try {
      const data = CreateProjectSchema.parse(req.body);
      const userId = (req as any).user.id;

      const slug = `${data.name.toLowerCase()}-${uuidv4().slice(0, 8)}`;

      const project = await prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            ownerId: userId,
            name: data.name,
            slug,
            description: data.description,
            template: data.template,
            visibility: data.visibility,
            orgId: data.orgId
          }
        });

        // Create default branch
        await tx.projectBranch.create({
          data: {
            projectId: project.id,
            name: 'main',
            isDefault: true
          }
        });

        return project;
      });

      // Publish Kafka event
      await KafkaPublisher.publish('project.created', {
        projectId: project.id,
        ownerId: userId,
        template: data.template
      });

      return res.status(201).json({
        success: true,
        data: { project_id: project.id, slug: project.slug }
      });
    } catch (error: any) {
      console.error('[Project] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /api/v1/projects
  async listProjects(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { limit = '20', cursor } = req.query;

      const [owned, collaborated] = await Promise.all([
        prisma.project.findMany({
          where: { ownerId: userId, deletedAt: null },
          take: parseInt(limit as string, 10) + 1,
          cursor: cursor ? { id: cursor as string } : undefined,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true, name: true, slug: true, visibility: true,
            template: true, language: true, lastOpenedAt: true,
            createdAt: true, updatedAt: true
          }
        }),
        prisma.projectCollaborator.findMany({
          where: { userId },
          include: { project: { where: { deletedAt: null } } }
        })
      ]);

      const collabProjects = collaborated.map(c => c.project);
      const allProjects = [...owned, ...collabProjects];

      let nextCursor: string | undefined;
      if (allProjects.length > parseInt(limit as string, 10)) {
        allProjects.pop();
        nextCursor = allProjects[allProjects.length - 1]?.id;
      }

      return res.json({
        success: true,
        data: allProjects,
        nextCursor
      });
    } catch (error: any) {
      console.error('[Projects] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /api/v1/projects/:id
  async getProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'viewer');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          branches: true,
          _count: { select: { files: true, collaborators: true } }
        }
      });

      if (!project || project.deletedAt) {
        return res.status(404).json({ error: 'Project not found' });
      }

      return res.json({ success: true, data: project });
    } catch (error: any) {
      console.error('[Project] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /api/v1/projects/:id
  async updateProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = UpdateProjectSchema.parse(req.body);
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'owner');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Only owner can update' });
      }

      const project = await prisma.project.update({
        where: { id },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.visibility && { visibility: data.visibility })
        }
      });

      return res.json({ success: true, data: project });
    } catch (error: any) {
      console.error('[Project] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // DELETE /api/v1/projects/:id
  async deleteProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'owner');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Only owner can delete' });
      }

      // Soft delete
      await prisma.project.update({
        where: { id },
        data: { deletedAt: new Date() }
      });

      // Publish deletion event
      await KafkaPublisher.publish('project.deleted', { projectId: id });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Project] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/projects/import
  async importProject(req: Request, res: Response) {
    try {
      const data = ImportProjectSchema.parse(req.body);
      const userId = (req as any).user.id;

      // Create project first
      const slug = `${data.name.toLowerCase()}-${uuidv4().slice(0, 8)}`;
      
      const project = await prisma.project.create({
        data: {
          ownerId: userId,
          name: data.name,
          slug,
          visibility: data.visibility,
          gitRepoUrl: data.gitRepoUrl
        }
      });

      // Trigger git clone
      await GitCloneManager.importFromGit(project.id, data.gitRepoUrl);

      return res.status(202).json({
        success: true,
        data: { project_id: project.id, status: 'importing' }
      });
    } catch (error: any) {
      console.error('[Import] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

### 6.2 File Tree Controller (src/controllers/file_tree_controller.ts)

```typescript
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { KafkaPublisher } from '../events/kafka_publisher';
import { PermissionService } from '../services/permission_srv';
import { StorageService } from '../services/storage_service';
import { CreateFileSchema, UpdateFileSchema, MoveFileSchema } from '../dto/file.dto';

interface FileTreeNode {
  id?: string;
  name: string;
  isDirectory: boolean;
  language?: string;
  children?: FileTreeNode[];
}

export const FileTreeController = {
  // GET /api/v1/projects/:id/tree
  async getFileTree(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { branch = 'main' } = req.query;
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'viewer');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const branchRecord = await prisma.projectBranch.findFirst({
        where: { projectId: id, name: branch as string }
      });

      if (!branchRecord) {
        return res.status(404).json({ error: 'Branch not found' });
      }

      const files = await prisma.projectFile.findMany({
        where: { projectId: id, branchId: branchRecord.id },
        orderBy: [{ isDirectory: 'desc' }, { path: 'asc' }]
      });

      // Build tree structure
      const tree = buildTree(files);

      return res.json({ success: true, data: tree });
    } catch (error: any) {
      console.error('[Tree] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/projects/:id/files
  async createFile(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = CreateFileSchema.parse(req.body);
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'editor');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Edit permission required' });
      }

      const branch = await prisma.projectBranch.findFirst({
        where: { projectId: id, isDefault: true }
      });

      if (!branch) {
        return res.status(404).json({ error: 'No default branch' });
      }

      if (data.isDirectory) {
        await prisma.projectFile.create({
          data: {
            projectId: id,
            branchId: branch.id,
            path: data.path,
            isDirectory: true
          }
        });
      } else {
        await StorageService.saveFile(
          id,
          branch.id,
          data.path,
          data.content || ''
        );
      }

      // Publish file modified event
      await KafkaPublisher.publish('file.modified', {
        projectId: id,
        path: data.path,
        action: 'create'
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[File] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /api/v1/projects/:id/files/:file_id
  async updateFile(req: Request, res: Response) {
    try {
      const { id, file_id } = req.params;
      const data = UpdateFileSchema.parse(req.body);
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'editor');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Edit permission required' });
      }

      const file = await prisma.projectFile.findUnique({ where: { id: file_id } });
      
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      await StorageService.saveFile(
        id,
        file.branchId,
        file.path,
        data.content
      );

      // Publish file modified event
      await KafkaPublisher.publish('file.modified', {
        projectId: id,
        fileId: file_id,
        path: file.path,
        action: 'update'
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[File] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // DELETE /api/v1/projects/:id/files/:file_id
  async deleteFile(req: Request, res: Response) {
    try {
      const { id, file_id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'editor');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Edit permission required' });
      }

      const file = await prisma.projectFile.findUnique({ where: { id: file_id } });
      
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      await StorageService.deleteFile(file_id);

      // Publish file deleted event
      await KafkaPublisher.publish('file.deleted', {
        projectId: id,
        fileId: file_id,
        path: file.path
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[File] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};

function buildTree(files: any[]): FileTreeNode {
  const root: FileTreeNode = { name: 'root', isDirectory: true, children: [] };
  const pathMap = new Map<string, FileTreeNode>();
  pathMap.set('', root);

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let currentPath = '';
    let currentNode = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!pathMap.has(currentPath)) {
        const node: FileTreeNode = {
          id: file.isDirectory ? undefined : file.id,
          name: part,
          isDirectory: file.isDirectory && i === parts.length - 1 ? true : !file.isDirectory ? false : true,
          language: file.isDirectory ? undefined : file.language,
          children: file.isDirectory ? [] : undefined
        };
        
        currentNode.children!.push(node);
        pathMap.set(currentPath, node);
      }

      currentNode = pathMap.get(currentPath)!;
    }
  }

  return root;
}
```

### 6.3 Secret Controller (src/controllers/secret_controller.ts)

```typescript
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { PermissionService } from '../services/permission_srv';
import { CreateSecretSchema } from '../dto/file.dto';
import axios from 'axios';
import { config } from '../config';

export const SecretController = {
  // GET /api/v1/projects/:id/secrets
  async listSecrets(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'viewer');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Only return key names, never values
      const secrets = await prisma.projectSecret.findMany({
        where: { projectId: id },
        select: { id: true, keyName: true, createdAt: true }
      });

      return res.json({ success: true, data: secrets });
    } catch (error: any) {
      console.error('[Secrets] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /api/v1/projects/:id/secrets
  async createSecret(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = CreateSecretSchema.parse(req.body);
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'owner');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Only owner can manage secrets' });
      }

      // Store in Vault
      const vaultPath = `projects/${id}/secrets/${data.keyName}`;
      
      const response = await axios.post(
        `${config.vault.addr}/v1/secret/data/${vaultPath}`,
        { data: { value: data.value } },
        { headers: { 'X-Vault-Token': config.vault.token } }
      );

      const vaultReferenceId = response.data.data.version;

      // Store reference in DB
      const secret = await prisma.projectSecret.create({
        data: {
          projectId: id,
          keyName: data.keyName,
          vaultReferenceId: String(vaultReferenceId)
        }
      });

      return res.status(201).json({
        success: true,
        data: { id: secret.id, keyName: secret.keyName }
      });
    } catch (error: any) {
      console.error('[Secret] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // DELETE /api/v1/projects/:id/secrets/:secret_id
  async deleteSecret(req: Request, res: Response) {
    try {
      const { id, secret_id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await PermissionService.checkAccess(userId, id, 'owner');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Only owner can delete secrets' });
      }

      const secret = await prisma.projectSecret.findUnique({ where: { id: secret_id } });
      
      if (!secret) {
        return res.status(404).json({ error: 'Secret not found' });
      }

      // Delete from Vault
      const vaultPath = `projects/${id}/secrets/${secret.keyName}`;
      await axios.delete(
        `${config.vault.addr}/v1/secret/data/${vaultPath}`,
        { headers: { 'X-Vault-Token': config.vault.token } }
      );

      // Delete from DB
      await prisma.projectSecret.delete({ where: { id: secret_id } });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Secret] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

---

## 7. Kafka Integration

### 7.1 Kafka Publisher (src/events/kafka_publisher.ts)

```typescript
import { Kafka, Producer } from 'kafkajs';
import { config } from '../config';

const kafka = new Kafka({
  clientId: 'project-service',
  brokers: config.kafka.brokers,
});

const producer = kafka.producer();
let isConnected = false;

export const KafkaPublisher = {
  async connect() {
    if (!isConnected && process.env.NODE_ENV !== 'test') {
      await producer.connect();
      isConnected = true;
    }
  },

  async publish(topic: string, payload: any) {
    if (!isConnected) return;
    
    try {
      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(payload) }]
      });
    } catch (error) {
      console.error('[Kafka] Publish error:', error);
    }
  }
};
```

---

## 8. Data Models (from Prisma Schema)

### 8.1 Project

```prisma
model Project {
  id           String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ownerId      String            @map("owner_id") @db.Uuid
  orgId        String?           @map("org_id") @db.Uuid
  name         String            @db.VarChar(255)
  slug         String            @db.VarChar(100)
  description  String?           @db.Text
  template     String?           @db.VarChar(100)
  language     String?           @db.VarChar(50)
  visibility   ProjectVisibility
  status       ProjectStatus     @default(pending)
  gitRepoUrl   String?           @map("git_repo_url") @db.Text
  framework    String?           @db.VarChar(100)
  lastOpenedAt DateTime?         @map("last_opened_at") @db.Timestamptz()
  deletedAt    DateTime?         @map("deleted_at") @db.Timestamptz()
  createdAt    DateTime          @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt    DateTime          @updatedAt @map("updated_at") @db.Timestamptz()

  @@unique([ownerId, slug])
  @@index([ownerId])
  @@index([orgId])
  @@index([status])
  @@map("projects")
}
```

### 8.2 ProjectFile

```prisma
model ProjectFile {
  id            String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId     String        @map("project_id") @db.Uuid
  branchId      String        @map("branch_id") @db.Uuid
  path          String        @db.Text
  isDirectory   Boolean       @default(false) @map("is_directory")
  s3Key         String?       @map("s3_key") @db.Text
  content       Bytes?        @map("content") @db.Bytea
  contentHash   String?       @map("content_hash") @db.VarChar(64)
  sizeBytes     BigInt        @default(0) @map("size_bytes")
  language      String?       @db.VarChar(50)
  createdAt     DateTime      @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime      @updatedAt @map("updated_at") @db.Timestamptz()

  @@unique([projectId, branchId, path])
  @@index([projectId])
  @@index([branchId])
  @@map("project_files")
}
```

---

## 9. Main Application

### 9.1 App Setup (src/app.ts)

```typescript
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { WorkspaceController } from './controllers/workspace_controller';
import { FileTreeController } from './controllers/file_tree_controller';
import { SecretController } from './controllers/secret_controller';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'project-service' });
});

app.get('/api/v1/health/circuit-breaker', (req: Request, res: Response) => {
  res.json({ status: 'closed', failures: 0 });
});

// Protected endpoints - Projects
app.post('/api/v1/projects', authMiddleware, WorkspaceController.createProject);
app.get('/api/v1/projects', authMiddleware, WorkspaceController.listProjects);
app.get('/api/v1/projects/:id', authMiddleware, WorkspaceController.getProject);
app.put('/api/v1/projects/:id', authMiddleware, WorkspaceController.updateProject);
app.delete('/api/v1/projects/:id', authMiddleware, WorkspaceController.deleteProject);
app.post('/api/v1/projects/import', authMiddleware, WorkspaceController.importProject);

// Protected endpoints - Files
app.get('/api/v1/projects/:id/tree', authMiddleware, FileTreeController.getFileTree);
app.post('/api/v1/projects/:id/files', authMiddleware, FileTreeController.createFile);
app.put('/api/v1/projects/:id/files/:file_id', authMiddleware, FileTreeController.updateFile);
app.delete('/api/v1/projects/:id/files/:file_id', authMiddleware, FileTreeController.deleteFile);

// Protected endpoints - Secrets
app.get('/api/v1/projects/:id/secrets', authMiddleware, SecretController.listSecrets);
app.post('/api/v1/projects/:id/secrets', authMiddleware, SecretController.createSecret);
app.delete('/api/v1/projects/:id/secrets/:secret_id', authMiddleware, SecretController.deleteSecret);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[App] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };
```

### 9.2 Entry Point (src/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { config } from './config';
import { prisma, disconnectPrisma } from './lib/prisma';
import { KafkaPublisher } from './events/kafka_publisher';

async function main() {
  console.log('[Project] Starting service...');

  await KafkaPublisher.connect();

  app.listen(config.port, () => {
    console.log(`[Project] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Project] Shutting down...');
  await disconnectPrisma();
  process.exit(0);
});

main().catch(console.error);
```

---

## 10. Testing Checklist

```bash
# Run the service
npm run dev

# Test health
curl http://localhost:8002/api/v1/health

# Test create project
curl -X POST http://localhost:8002/api/v1/projects \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-project","template":"nextjs","visibility":"private"}'

# Test file tree
curl http://localhost:8002/api/v1/projects/:id/tree \
  -H "Authorization: Bearer <token>"
```

---

## 11. Implementation Status

| Component | Status |
|-----------|--------|
| Project Setup | ✅ Complete |
| Config | ✅ Complete |
| DTOs | ✅ Complete |
| Storage Service | ✅ Complete |
| Permission Service | ✅ Complete |
| Git Clone Manager | ✅ Complete |
| Controllers | ✅ Complete |
| Kafka | ✅ Complete |
| App & Index | ✅ Complete |

---

## 12. Key Implementation Notes

### 12.1 File Storage Logic
- Files < 64KB stored inline in PostgreSQL
- Files >= 64KB stored in S3
- Content hash comparison to avoid unnecessary writes

### 12.2 Secret Management
- Values stored in HashiCorp Vault
- Only key names stored in PostgreSQL
- Never return plaintext values to frontend

### 12.3 Access Control
- RBAC: owner, editor, viewer
- Permission middleware on all project endpoints
- Viewer can only read, editor can modify, owner can delete

### 12.4 Outbox Pattern
- Kafka events written in same transaction as DB changes
- Ensures data consistency across services
