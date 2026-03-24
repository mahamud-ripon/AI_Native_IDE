import { S3Service } from './s3.service';
import { PermissionService } from './permission.service';
import { config } from '../config/index';
import { logger } from '../lib/logger';

// Maximum file size (50MB)
const MAX_FILE_SIZE = config.storage.maxFileSize;

// Allowed content types for upload
const ALLOWED_CONTENT_TYPES = [
  // Text files
  'text/plain',
  'text/html',
  'text/css',
  'text/javascript',
  'text/markdown',
  'text/csv',
  'text/xml',
  // Application files
  'application/json',
  'application/javascript',
  'application/xml',
  'application/pdf',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  // Images
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
  // Fonts
  'font/woff',
  'font/woff2',
  'application/font-woff',
  'application/font-woff2',
  // Audio/Video (for assets)
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/webm',
];

// Blocked file extensions (executables and scripts that could be malicious)
const BLOCKED_EXTENSIONS = [
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.bash',
  '.msi',
  '.app',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.jar',
  '.war',
];

// MIME type mapping for common extensions
const EXTENSION_TO_MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.htm': 'text/html',
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

export interface PresignedUploadResult {
  url: string;
  key: string;
  expiresIn: number;
}

export interface PresignedDownloadResult {
  url: string;
  expiresIn: number;
}

export const PresignedUrlService = {
  /**
   * Validate content type against allowlist
   */
  isContentTypeAllowed(contentType: string): boolean {
    // Check exact match first
    if (ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return true;
    }
    // Allow specific application/* types that are in the allowlist (already checked above)
    // Do NOT allow wildcard text/* to prevent text/x-shellscript, text/x-php, etc.
    return false;
  },

  /**
   * Check if file extension is blocked
   */
  isExtensionBlocked(filename: string): boolean {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex === -1) return false; // No extension = not blocked
    const ext = filename.substring(dotIndex).toLowerCase();
    return BLOCKED_EXTENSIONS.includes(ext);
  },

  /**
   * Get MIME type from file extension
   */
  getMimeTypeFromExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex === -1) return 'application/octet-stream';
    const ext = filename.substring(dotIndex).toLowerCase();
    return EXTENSION_TO_MIME[ext] || 'application/octet-stream';
  },

  /**
   * Validate upload request
   */
  validateUploadRequest(
    key: string,
    contentType: string,
    sizeBytes: number
  ): { valid: boolean; error?: string } {
    // Validate file size
    if (sizeBytes > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds maximum of ${MAX_FILE_SIZE} bytes (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
      };
    }

    // Validate content type
    if (!this.isContentTypeAllowed(contentType)) {
      return {
        valid: false,
        error: `Content type '${contentType}' is not allowed`,
      };
    }

    // Validate file extension
    if (this.isExtensionBlocked(key)) {
      return {
        valid: false,
        error: 'File extension is not allowed for security reasons',
      };
    }

    return { valid: true };
  },

  /**
   * Generate a pre-signed URL for uploading a file
   */
  async generateUploadUrl(
    userId: string,
    bucketType: string,
    key: string,
    contentType: string,
    sizeBytes: number
  ): Promise<PresignedUploadResult> {
    // Validate the upload request
    const validation = this.validateUploadRequest(key, contentType, sizeBytes);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Extract project ID from key path (format: projects/{projectId}/files/{fileId})
    const pathParts = key.split('/');
    const projectId = pathParts[1]; // projects/[projectId]/files/...

    if (projectId) {
      // Validate projectId against path traversal
      if (projectId === '..' || projectId === '.' || projectId.includes('/') || projectId.includes('\\')) {
        throw new Error('Invalid project ID in key path');
      }

      // Verify user has editor access to the project
      const hasAccess = await PermissionService.checkAccess(userId, projectId, 'editor');
      if (!hasAccess) {
        throw new Error('Access denied: You do not have permission to upload to this project');
      }
    }

    // Get the bucket name
    const bucket = S3Service.getBucketName(bucketType);

    // Generate pre-signed URL
    const url = await S3Service.getSignedUploadUrl(bucket, key, contentType);

    logger.info({ userId, bucket, key, sizeBytes }, 'Generated upload pre-signed URL');

    return {
      url,
      key,
      expiresIn: config.storage.presignedUrlExpiry.upload,
    };
  },

  /**
   * Generate a pre-signed URL for downloading a file
   */
  async generateDownloadUrl(
    userId: string,
    bucketType: string,
    key: string
  ): Promise<PresignedDownloadResult> {
    // Extract project ID from key path
    const pathParts = key.split('/');
    const projectId = pathParts[1];

    if (projectId) {
      // Validate projectId against path traversal
      if (projectId === '..' || projectId === '.' || projectId.includes('/') || projectId.includes('\\')) {
        throw new Error('Invalid project ID in key path');
      }

      // Verify user has viewer access to the project
      const hasAccess = await PermissionService.checkAccess(userId, projectId, 'viewer');
      if (!hasAccess) {
        throw new Error('Access denied: You do not have permission to download from this project');
      }
    }

    // Get the bucket name
    const bucket = S3Service.getBucketName(bucketType);

    // Check if file exists
    const exists = await S3Service.exists(bucket, key);
    if (!exists) {
      throw new Error('File not found');
    }

    // Generate pre-signed URL
    const url = await S3Service.getSignedDownloadUrl(bucket, key);

    logger.info({ userId, bucket, key }, 'Generated download pre-signed URL');

    return {
      url,
      expiresIn: config.storage.presignedUrlExpiry.download,
    };
  },

  /**
   * Generate a pre-signed URL for avatar upload (public, no project access check)
   */
  async generateAvatarUploadUrl(
    userId: string,
    filename: string,
    contentType: string,
    sizeBytes: number
  ): Promise<PresignedUploadResult> {
    // Validate size (avatars max 5MB)
    const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
    if (sizeBytes > MAX_AVATAR_SIZE) {
      throw new Error('Avatar size exceeds maximum of 5MB');
    }

    // Validate content type (images only)
    const allowedImageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowedImageTypes.includes(contentType)) {
      throw new Error('Only image files are allowed for avatars');
    }

    // Generate key: avatars/{userId}/{uuid}.{ext}
    const ext = filename.substring(filename.lastIndexOf('.'));
    const key = `avatars/${userId}/${crypto.randomUUID()}${ext}`;

    const bucket = config.s3.buckets.avatars;
    const url = await S3Service.getSignedUploadUrl(bucket, key, contentType);

    return {
      url,
      key,
      expiresIn: config.storage.presignedUrlExpiry.upload,
    };
  },
};

export default PresignedUrlService;
