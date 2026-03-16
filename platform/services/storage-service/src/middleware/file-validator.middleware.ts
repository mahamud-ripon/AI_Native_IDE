import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index';
import { logger } from '../lib/logger';

// Maximum file size (50MB)
const MAX_FILE_SIZE = config.storage.maxFileSize;

// Allowed MIME types
const ALLOWED_MIME_TYPES = [
  // Text
  'text/plain',
  'text/html',
  'text/css',
  'text/javascript',
  'text/markdown',
  'text/csv',
  'text/xml',
  // Application
  'application/json',
  'application/javascript',
  'application/xml',
  'application/pdf',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  // Images
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
];

// Blocked extensions
const BLOCKED_EXTENSIONS = [
  '.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.bash',
  '.msi', '.app', '.dmg', '.pkg', '.deb', '.rpm',
];

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  contentType?: string;
  size?: number;
}

/**
 * Validate file upload request
 */
export function validateFileUpload(
  filename: string,
  contentType: string,
  size: number
): FileValidationResult {
  // Check file size
  if (size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(contentType) && !contentType.startsWith('text/')) {
    return {
      valid: false,
      error: `Content type '${contentType}' is not allowed`,
    };
  }

  // Check extension
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: 'File extension is not allowed for security reasons',
    };
  }

  return {
    valid: true,
    contentType,
    size,
  };
}

/**
 * Middleware to validate file upload headers
 */
export async function fileValidatorMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const contentType = request.headers['content-type'] as string | undefined;
  const contentLength = parseInt(request.headers['content-length'] || '0', 10);

  // Check content length
  if (contentLength > MAX_FILE_SIZE) {
    reply.status(413).send({
      success: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    });
    return;
  }

  // For multipart uploads, validation happens per-file in the handler
  // For direct uploads, validate here
  if (contentType && !contentType.includes('multipart/form-data')) {
    if (!ALLOWED_MIME_TYPES.includes(contentType) && !contentType.startsWith('text/')) {
      reply.status(415).send({
        success: false,
        error: `Content type '${contentType}' is not allowed`,
      });
      return;
    }
  }
}

/**
 * Sanitize filename for security
 */
export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts
  let sanitized = filename.replace(/\.\./g, '');
  
  // Remove leading slashes
  sanitized = sanitized.replace(/^[/\\]+/, '');
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // Keep only safe characters
  sanitized = sanitized.replace(/[^\w\-_.\/]/g, '_');
  
  return sanitized;
}

/**
 * Get MIME type from filename extension
 */
export function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  
  const mimeMap: Record<string, string> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.jsx': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
  };

  return mimeMap[ext] || 'application/octet-stream';
}

export default fileValidatorMiddleware;
