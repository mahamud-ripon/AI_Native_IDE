import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { hashContent } from '../lib/crypto';
import { permissionService, storageService, kafkaService } from '../services';
import { CreateFileSchema, UpdateFileSchema, MoveFileSchema, GetFileTreeQuerySchema } from '../dto';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware';

const logger = createLogger('file-controller');

interface AuthenticatedRequest extends FastifyRequest {
  user: { sub: string; email: string; username: string; iat?: number; exp?: number };
}

interface FileTreeNode {
  id?: string;
  name: string;
  isDirectory: boolean;
  language?: string | null;
  children?: FileTreeNode[];
}

/**
 * Build nested tree from flat file list
 */
function buildFileTree(files: { id: string; path: string; isDirectory: boolean; language: string | null }[]): FileTreeNode {
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
        const isLastPart = i === parts.length - 1;
        const isDir = file.isDirectory && isLastPart;

        const node: FileTreeNode = {
          id: isLastPart && !isDir ? file.id : undefined,
          name: part,
          isDirectory: isDir || !isLastPart,
          language: isLastPart && !isDir ? (file.language ?? null) : null,
          children: isDir || !isLastPart ? [] : undefined,
        };

        currentNode.children!.push(node);
        pathMap.set(currentPath, node);
      }

      currentNode = pathMap.get(currentPath)!;
    }
  }

  return root;
}

/**
 * Detect language from file path
 */
function detectLanguage(path: string): string | null {
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
    css: 'css',
    yaml: 'yaml',
    yml: 'yaml',
    sql: 'sql',
    sh: 'shell',
  };
  return ext ? langMap[ext] || null : null;
}

/**
 * Get file tree
 * GET /api/v1/projects/:id/tree
 */
export async function getFileTree(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const traceId = request.id;

  try {
    const query = GetFileTreeQuerySchema.parse(request.query);
    const { branch } = query;

    const hasAccess = await permissionService.checkAccess(userId, id, 'viewer');
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to this project');
    }

    const branchRecord = await prisma.projectBranch.findFirst({
      where: { projectId: id, name: branch },
    });

    if (!branchRecord) {
      throw new NotFoundError('Branch');
    }

    const files = await prisma.projectFile.findMany({
      where: { projectId: id, branchId: branchRecord.id, deletedAt: null },
      select: { id: true, path: true, isDirectory: true, language: true },
      orderBy: [{ isDirectory: 'desc' }, { path: 'asc' }],
    });

    const tree = buildFileTree(files);

    logger.debug('File tree retrieved', { projectId: id, branch, fileCount: files.length, traceId });

    reply.send({
      success: true,
      data: tree,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to get file tree', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Get file content
 * GET /api/v1/projects/:id/files/:fileId
 */
export async function getFile(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id, fileId } = request.params as { id: string; fileId: string };
  const traceId = request.id;

  try {
    const hasAccess = await permissionService.checkAccess(userId, id, 'viewer');
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to this project');
    }

    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file || file.deletedAt) {
      throw new NotFoundError('File');
    }

    let content = '';
    if (file.s3Key) {
      const result = await storageService.downloadFile(file.s3Key);
      content = result.content;
    }

    reply.send({
      success: true,
      data: {
        id: file.id,
        path: file.path,
        content,
        language: file.language,
        isDirectory: file.isDirectory,
        sizeBytes: file.sizeBytes,
        lastEditedAt: file.lastEditedAt,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to get file', { error, projectId: id, fileId, userId, traceId });
    throw error;
  }
}

/**
 * Get file content by path (for IDE)
 * GET /api/v1/projects/:id/files/content?path=src/app.ts
 */
export async function getFileContent(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const { path } = request.query as { path?: string };
  const traceId = request.id;

  if (!path) {
    throw new ValidationError('path query parameter is required');
  }

  try {
    const hasAccess = await permissionService.checkAccess(userId, id, 'viewer');
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to this project');
    }

    // Get default branch
    const branch = await prisma.projectBranch.findFirst({
      where: { projectId: id, isDefault: true }
    });

    if (!branch) {
      throw new NotFoundError('Default branch not found');
    }

    // Find file by path
    const file = await prisma.projectFile.findFirst({
      where: { projectId: id, branchId: branch.id, path, deletedAt: null }
    });

    if (!file) {
      throw new NotFoundError('File not found');
    }

    let content = '';
    if (file.s3Key) {
      const result = await storageService.downloadFile(file.s3Key);
      content = result.content;
    }

    logger.debug('File content retrieved', { projectId: id, path, traceId });

    reply.send({
      success: true,
      data: {
        path: file.path,
        content,
        language: file.language,
        sizeBytes: file.sizeBytes,
        lastEditedAt: file.lastEditedAt,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to get file content', { error, projectId: id, path, userId, traceId });
    throw error;
  }
}

/**
 * Create file
 * POST /api/v1/projects/:id/files
 */
export async function createFile(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id } = request.params as { id: string };
  const traceId = request.id;

  try {
    const data = CreateFileSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(userId, id, 'editor');
    if (!hasAccess) {
      throw new ForbiddenError('Edit permission required');
    }

    const branch = await prisma.projectBranch.findFirst({
      where: { projectId: id, isDefault: true },
    });

    if (!branch) {
      throw new NotFoundError('Default branch');
    }

    // Check if file already exists
    const existingFile = await prisma.projectFile.findFirst({
      where: { projectId: id, branchId: branch.id, path: data.path, deletedAt: null },
    });

    if (existingFile) {
      throw new ValidationError('File already exists at this path');
    }

    let s3Key: string | null = null;
    let contentHash: string | null = null;
    let sizeBytes = 0;

    if (!data.isDirectory && data.content) {
      const uploadResult = await storageService.uploadFile(id, data.path, data.content);
      s3Key = uploadResult.s3Key;
      contentHash = uploadResult.contentHash;
      sizeBytes = uploadResult.sizeBytes;
    }

    const file = await prisma.projectFile.create({
      data: {
        projectId: id,
        branchId: branch.id,
        path: data.path,
        name: data.path.split('/').pop() || data.path,
        isDirectory: data.isDirectory,
        s3Key,
        contentHash,
        sizeBytes,
        language: data.isDirectory ? null : detectLanguage(data.path),
        createdBy: userId,
        lastEditedBy: userId,
        lastEditedAt: new Date(),
      },
    });

    // Publish file event
    await kafkaService.publish('file.created', {
      id: file.id,
      projectId: id,
      path: file.path,
      isDirectory: file.isDirectory,
      createdBy: userId,
    });

    logger.info('File created', { projectId: id, fileId: file.id, path: data.path, userId, traceId });

    reply.code(201).send({
      success: true,
      data: {
        id: file.id,
        path: file.path,
        isDirectory: file.isDirectory,
        language: file.language,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to create file', { error, projectId: id, userId, traceId });
    throw error;
  }
}

/**
 * Update file
 * PUT /api/v1/projects/:id/files/:fileId
 */
export async function updateFile(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id, fileId } = request.params as { id: string; fileId: string };
  const traceId = request.id;

  try {
    const data = UpdateFileSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(userId, id, 'editor');
    if (!hasAccess) {
      throw new ForbiddenError('Edit permission required');
    }

    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file || file.deletedAt) {
      throw new NotFoundError('File');
    }

    if (file.isDirectory) {
      throw new ValidationError('Cannot update directory content');
    }

    // Check if content changed
    const newContentHash = hashContent(data.content);
    if (file.contentHash === newContentHash) {
      reply.send({
        success: true,
        data: {
          id: file.id,
          contentHash: file.contentHash,
          unchanged: true,
        },
        traceId,
      });
      return;
    }

    // Upload new content to S3
    const uploadResult = await storageService.uploadFile(id, file.path, data.content);

    // Create file version
    await prisma.fileVersion.create({
      data: {
        fileId: file.id,
        savedById: userId,
        contentHash: file.contentHash ?? '',
        s3Key: file.s3Key,
      },
    });

    // Update file
    const updatedFile = await prisma.projectFile.update({
      where: { id: fileId },
      data: {
        s3Key: uploadResult.s3Key,
        contentHash: uploadResult.contentHash,
        sizeBytes: uploadResult.sizeBytes,
        lastEditedBy: userId,
        lastEditedAt: new Date(),
      },
    });

    // Delete old S3 object
    if (file.s3Key && file.s3Key !== uploadResult.s3Key) {
      try {
        await storageService.deleteFile(file.s3Key);
      } catch (e) {
        logger.warn('Failed to delete old S3 file', { s3Key: file.s3Key, error: e });
      }
    }

    // Publish file modified event
    await kafkaService.publish('file.modified', {
      id: file.id,
      projectId: id,
      path: file.path,
      contentHash: uploadResult.contentHash,
      updatedBy: userId,
    });

    logger.info('File updated', { projectId: id, fileId, userId, traceId });

    reply.send({
      success: true,
      data: {
        id: updatedFile.id,
        contentHash: updatedFile.contentHash,
        sizeBytes: updatedFile.sizeBytes,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to update file', { error, projectId: id, fileId, userId, traceId });
    throw error;
  }
}

/**
 * Delete file (soft delete)
 * DELETE /api/v1/projects/:id/files/:fileId
 */
export async function deleteFile(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id, fileId } = request.params as { id: string; fileId: string };
  const traceId = request.id;

  try {
    const hasAccess = await permissionService.checkAccess(userId, id, 'editor');
    if (!hasAccess) {
      throw new ForbiddenError('Edit permission required');
    }

    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file || file.deletedAt) {
      throw new NotFoundError('File');
    }

    // Soft delete
    await prisma.projectFile.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    // Publish file deleted event (for S3 cleanup)
    await kafkaService.publish('file.deleted', {
      id: file.id,
      projectId: id,
      path: file.path,
      s3Key: file.s3Key,
      deletedBy: userId,
    });

    logger.info('File deleted', { projectId: id, fileId, userId, traceId });

    reply.send({
      success: true,
      data: null,
      traceId,
    });
  } catch (error) {
    logger.error('Failed to delete file', { error, projectId: id, fileId, userId, traceId });
    throw error;
  }
}

/**
 * Move file
 * PUT /api/v1/projects/:id/files/:fileId/move
 */
export async function moveFile(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as AuthenticatedRequest).user.sub;
  const { id, fileId } = request.params as { id: string; fileId: string };
  const traceId = request.id;

  try {
    const data = MoveFileSchema.parse(request.body);

    const hasAccess = await permissionService.checkAccess(userId, id, 'editor');
    if (!hasAccess) {
      throw new ForbiddenError('Edit permission required');
    }

    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
    });

    if (!file || file.deletedAt) {
      throw new NotFoundError('File');
    }

    const updatedFile = await prisma.projectFile.update({
      where: { id: fileId },
      data: {
        path: data.newPath,
        name: data.newPath.split('/').pop() || data.newPath,
        lastEditedBy: userId,
        lastEditedAt: new Date(),
      },
    });

    // Publish file moved event
    await kafkaService.publish('file.modified', {
      id: file.id,
      projectId: id,
      oldPath: file.path,
      newPath: data.newPath,
      action: 'move',
      updatedBy: userId,
    });

    logger.info('File moved', { projectId: id, fileId, oldPath: file.path, newPath: data.newPath, userId, traceId });

    reply.send({
      success: true,
      data: {
        id: updatedFile.id,
        path: updatedFile.path,
      },
      traceId,
    });
  } catch (error) {
    logger.error('Failed to move file', { error, projectId: id, fileId, userId, traceId });
    throw error;
  }
}

/**
 * Sync multiple files at once (for AI agents)
 * POST /api/v1/projects/:id/files/sync
 */
export async function syncFiles(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params as { id: string };
  const userId = (request as AuthenticatedRequest).user.sub;
  const traceId = request.headers['x-trace-id'] as string || crypto.randomUUID();
  
  const data = request.body as {
    files: Array<{ path: string; content: string }>;
  };
  
  if (!data.files || !Array.isArray(data.files) || data.files.length === 0) {
    throw new ValidationError('files array is required');
  }
  
  try {
    // Verify project exists and user has access
    const project = await prisma.project.findUnique({
      where: { id },
      include: { collaborators: true }
    });
    
    if (!project) {
      throw new NotFoundError('Project not found');
    }
    
    const hasAccess = project.collaborators.some((c: { userId: string; }) => c.userId === userId) || project.ownerId === userId;
    if (!hasAccess) {
      throw new ForbiddenError('Access denied');
    }
    
    const results: Array<{ path: string; success: boolean; id?: string; error?: string }> = [];
    
    // Get default branch for project
    const branch = await prisma.projectBranch.findFirst({
      where: { projectId: id, isDefault: true }
    });
    
    if (!branch) {
      throw new NotFoundError('Default branch not found');
    }
    
    for (const file of data.files) {
      try {
        // Upload to S3 first
        const uploadResult = await storageService.uploadFile(id, file.path, file.content);
        
        // Check if file exists
        const existingFile = await prisma.projectFile.findFirst({
          where: { projectId: id, branchId: branch.id, path: file.path, deletedAt: null }
        });
        
        let fileRecord;
        
        if (existingFile) {
          // Update existing file
          fileRecord = await prisma.projectFile.update({
            where: { id: existingFile.id },
            data: {
              s3Key: uploadResult.s3Key,
              contentHash: uploadResult.contentHash,
              sizeBytes: uploadResult.sizeBytes,
              lastEditedBy: userId,
              lastEditedAt: new Date()
            }
          });
        } else {
          // Create new file
          fileRecord = await prisma.projectFile.create({
            data: {
              projectId: id,
              branchId: branch.id,
              path: file.path,
              name: file.path.split('/').pop() || file.path,
              isDirectory: false,
              s3Key: uploadResult.s3Key,
              contentHash: uploadResult.contentHash,
              sizeBytes: uploadResult.sizeBytes,
              language: detectLanguage(file.path),
              createdBy: userId,
              lastEditedBy: userId,
              lastEditedAt: new Date()
            }
          });
        }
        
        results.push({ path: file.path, success: true, id: fileRecord.id });
        
        // Publish file event to single topic
        await kafkaService.publish('project.files.events', {
          event: existingFile ? 'file.modified' : 'file.created',
          projectId: id,
          fileId: fileRecord.id,
          filePath: file.path,
          userId,
          traceId,
          timestamp: Date.now()
        });
        
        logger.info('File synced', { 
          projectId: id, 
          fileId: fileRecord.id, 
          path: file.path, 
          action: existingFile ? 'modified' : 'created',
          userId, 
          traceId 
        });
        
      } catch (fileError) {
        logger.error('Failed to sync file', { 
          error: fileError instanceof Error ? fileError.message : 'Unknown error',
          projectId: id, 
          path: file.path,
          traceId 
        });
        results.push({ 
          path: file.path, 
          success: false, 
          error: fileError instanceof Error ? fileError.message : 'Unknown error' 
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    logger.info('Files synced', { projectId: id, total: data.files.length, success: successCount, userId, traceId });
    
    reply.send({
      success: true,
      data: {
        total: data.files.length,
        succeeded: successCount,
        failed: data.files.length - successCount,
        results
      },
      traceId
    });
    
  } catch (error) {
    logger.error('Failed to sync files', { error, projectId: id, userId, traceId });
    throw error;
  }
}
