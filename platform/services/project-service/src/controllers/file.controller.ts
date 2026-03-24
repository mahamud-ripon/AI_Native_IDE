import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { hashContent } from '../lib/crypto';
import { permissionService, storageService, kafkaService } from '../services';
import { CreateFileSchema, UpdateFileSchema, MoveFileSchema, GetFileTreeQuerySchema } from '../dto';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware';
import { config } from '../config';

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

    // Try to find by named branch first, then fall back to the default branch
    // This keeps getFileTree and getFileContent consistent (both end up on the same branch)
    let branchRecord = await prisma.projectBranch.findFirst({
      where: { projectId: id, name: branch },
    });

    if (!branchRecord) {
      branchRecord = await prisma.projectBranch.findFirst({
        where: { projectId: id, isDefault: true },
      });
    }

    if (!branchRecord) {
      throw new NotFoundError('Branch');
    }

    const files = await prisma.projectFile.findMany({
      where: { projectId: id, branchId: branchRecord.id, deletedAt: null },
      select: { id: true, path: true, isDirectory: true, language: true },
      orderBy: [{ isDirectory: 'desc' }, { path: 'asc' }],
    });

    const tree = buildFileTree(files);

    logger.debug('File tree retrieved', { projectId: id, branch: branchRecord.name, fileCount: files.length, traceId });

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
    if (file.inlineContent) {
      // Inline storage path - decode BYTEA buffer to UTF-8 string
      content = file.inlineContent.toString('utf-8');
    } else if (file.s3Key) {
      // S3 storage path - download from object storage
      const result = await storageService.downloadFile(file.s3Key);
      content = result.content;
    }
    // Files with neither field are directories - content stays ''

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
  const rawPath = (request.query as { path?: string }).path;
  const traceId = request.id;

  if (!rawPath) {
    throw new ValidationError('path query parameter is required');
  }

  // Normalize path: strip leading slash to match DB storage format (e.g. src/main.tsx not /src/main.tsx)
  const path = rawPath.replace(/^\/+/, '');

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

    // Find file by path (normalized)
    const file = await prisma.projectFile.findFirst({
      where: { projectId: id, branchId: branch.id, path, deletedAt: null }
    });

    if (!file) {
      logger.warn('File not found in DB', { projectId: id, path, branchId: branch.id, branchName: branch.name, traceId });
      throw new NotFoundError(`File not found: ${path}`);
    }

    let content = '';
    if (file.inlineContent) {
      // Inline storage path - decode BYTEA buffer to UTF-8 string
      content = file.inlineContent.toString('utf-8');
    } else if (file.s3Key) {
      // S3 storage path - download from object storage
      const result = await storageService.downloadFile(file.s3Key);
      content = result.content;
    }
    // Files with neither field are directories - content stays ''

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

    // Check if file already exists (normalize path)
    const normalizedPath = data.path.replace(/^\/+/, '');
    const existingFile = await prisma.projectFile.findFirst({
      where: { projectId: id, branchId: branch.id, path: normalizedPath, deletedAt: null },
    });

    if (existingFile) {
      throw new ValidationError('File already exists at this path');
    }

    const INLINE_THRESHOLD = 64 * 1024; // 64 KB
    let s3Key: string | null = null;
    let inlineContent: Buffer | null = null;
    let contentHash: string | null = null;
    let sizeBytes = 0;

    if (!data.isDirectory && data.content) {
      const contentBuffer = Buffer.from(data.content, 'utf-8');
      sizeBytes = contentBuffer.length;
      contentHash = hashContent(data.content);

      if (!config.storage.alwaysUseS3 && sizeBytes <= INLINE_THRESHOLD) {
        // Small file - store inline in PostgreSQL
        inlineContent = contentBuffer;
        s3Key = null;
      } else {
        // Large file - upload to S3
        const uploadResult = await storageService.uploadFile(id, data.path, data.content);
        s3Key = uploadResult.s3Key;
        contentHash = uploadResult.contentHash;
        sizeBytes = uploadResult.sizeBytes;
      }
    }

    const file = await prisma.projectFile.create({
      data: {
        projectId: id,
        branchId: branch.id,
        // Normalize path: strip leading slash
        path: data.path.replace(/^\/+/, ''),
        name: data.path.split('/').pop() || data.path,
        isDirectory: data.isDirectory,
        inlineContent: inlineContent ?? undefined,
        s3Key: s3Key ?? null,
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
        inlineContent: null,
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
  
  const body = request.body as {
    files: Array<{ path: string; content: string }>;
    userId?: string;
  };
  
  const userId = (request as any).user?.sub || body.userId;
  if (!userId) {
    throw new ValidationError('userId is required for internal sync');
  }
  
  const traceId = request.headers['x-trace-id'] as string || crypto.randomUUID();

  const data = request.body as {
    files: Array<{ path: string; content: string }>;
  };

  if (!data.files || !Array.isArray(data.files) || data.files.length === 0) {
    throw new ValidationError('files array is required');
  }

  try {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id },
      include: { collaborators: true }
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const isInternal = request.headers['x-internal-api-key'] !== undefined;
    
    // Fallback to project owner if userId is 'system' or not a UUID (to avoid Prisma UUID errors)
    let actualUserId = userId;
    if (actualUserId === 'system' || !actualUserId.includes('-')) {
      actualUserId = project.ownerId;
    }

    if (!isInternal) {
      const hasAccess = project.collaborators.some((c: { userId: string; }) => c.userId === actualUserId) || project.ownerId === actualUserId;
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }
    }

    const results: Array<{ path: string; success: boolean; id?: string; error?: string }> = [];

    // Get default branch for project
    const branch = await prisma.projectBranch.findFirst({
      where: { projectId: id, isDefault: true }
    });

    if (!branch) {
      throw new NotFoundError('Default branch not found');
    }

    const INLINE_THRESHOLD = 64 * 1024; // 64 KB

    for (const file of data.files) {
      try {
        // Apply 64KB threshold for dual-storage strategy
        const contentBuffer = Buffer.from(file.content, 'utf-8');
        const sizeBytes = contentBuffer.length;
        const contentHash = hashContent(file.content);
        let s3Key: string | null = null;
        let inlineContent: Buffer | null = null;

        if (!config.storage.alwaysUseS3 && sizeBytes <= INLINE_THRESHOLD) {
          // Small file - store inline in PostgreSQL
          inlineContent = contentBuffer;
          s3Key = null;
        } else {
          // Large file - upload to S3
          const uploadResult = await storageService.uploadFile(id, file.path, file.content);
          s3Key = uploadResult.s3Key;
        }

        // Check if file exists (normalize path)
        const normalizedFilePath = file.path.replace(/^\/+/, '');
        const existingFile = await prisma.projectFile.findFirst({
          where: { projectId: id, branchId: branch.id, path: normalizedFilePath, deletedAt: null }
        });

        let fileRecord;

        if (existingFile) {
          // Update existing file
          fileRecord = await prisma.projectFile.update({
            where: { id: existingFile.id },
            data: {
              inlineContent: inlineContent ?? undefined,
              s3Key: s3Key ?? null,
              contentHash,
              sizeBytes,
              lastEditedBy: actualUserId,
              lastEditedAt: new Date()
            }
          });
        } else {
          // Create new file
          fileRecord = await prisma.projectFile.create({
            data: {
              projectId: id,
              branchId: branch.id,
              path: normalizedFilePath,
              name: normalizedFilePath.split('/').pop() || normalizedFilePath,
              isDirectory: false,
              inlineContent: inlineContent ?? undefined,
              s3Key: s3Key ?? null,
              contentHash,
              sizeBytes,
              language: detectLanguage(file.path),
              createdBy: actualUserId,
              lastEditedBy: actualUserId,
              lastEditedAt: new Date()
            }
          });
        }

        results.push({ path: file.path, success: true, id: fileRecord.id });

        // Publish file event with canonical KafkaEventEnvelope
        const eventType = existingFile ? 'file.modified' : 'file.created';
        await kafkaService.publish(eventType, {
          event_id: crypto.randomUUID(),
          event_type: eventType,
          timestamp: new Date().toISOString(),
          source_service: 'project-service',
          trace_id: traceId,
          version: '1.0',
          payload: {
            project_id: id,
            file_id: fileRecord.id,
            file_path: file.path,
            user_id: userId,
          },
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
