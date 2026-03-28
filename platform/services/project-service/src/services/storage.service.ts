import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { hashContent } from '../lib/crypto';
import { prisma } from '../lib/prisma';

const logger = createLogger('storage-service');

// Storage Service - Always uses S3 per DEVELOPMENT_LOGIC.md Priority 1.1
// No inline BYTEA storage - all files go to S3

export interface FileUploadResult {
  s3Key: string;
  contentHash: string;
  sizeBytes: number;
}

export interface FileDownloadResult {
  content: string;
  sizeBytes: number;
  lastModified?: Date;
}

class StorageService {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = config.s3.bucket;
    
    const endpoint = config.s3.endpoint;
    const region = config.s3.region || 'us-east-1';
    
    logger.info('Storage service initializing', { 
      bucket: this.bucket, 
      endpoint: endpoint || 'AWS default',
      region,
      hasAccessKey: !!config.s3.accessKeyId,
      hasSecretKey: !!config.s3.secretAccessKey,
    });
    
    this.s3Client = new S3Client({
      region: region,
      credentials: config.s3.accessKeyId && config.s3.secretAccessKey ? {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      } : undefined,
      endpoint: endpoint,
      forcePathStyle: !!endpoint, // Required for MinIO/LocalStack
      tls: endpoint?.startsWith('https'),
      // Fix MinIO checksum mismatch errors during download
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    
    // Log initialization
    logger.info('Storage service initialized', { bucket: this.bucket });
  }

  /**
   * Initialize storage - create bucket if it doesn't exist
   */
  async initialize(): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      logger.info('Storage bucket exists', { bucket: this.bucket });
      return true;
    } catch (error) {
      // Bucket doesn't exist, try to create it
      logger.warn('Storage bucket does not exist, attempting to create', { bucket: this.bucket });
      try {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        logger.info('Storage bucket created', { bucket: this.bucket });
        return true;
      } catch (createError) {
        logger.error('Failed to create storage bucket', { 
          bucket: this.bucket, 
          error: createError 
        });
        return false;
      }
    }
  }

  /**
   * Health check for storage service
   */
  async healthCheck(): Promise<{ healthy: boolean; bucket: string; error?: string }> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { healthy: true, bucket: this.bucket };
    } catch (error) {
      return { 
        healthy: false, 
        bucket: this.bucket,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload file content to S3
   * Always uses S3 - no inline storage per architecture guidelines
   */
  async uploadFile(
    projectId: string,
    path: string,
    content: string
  ): Promise<FileUploadResult> {
    const contentHash = hashContent(content);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    
    // Generate S3 key with file path for easy restoration and git sync
    // Format: projects/{projectId}/workspace/{filePath}
    // Example: projects/abc123/workspace/src/app.ts
    const normalizedPath = path.replace(/^[/\\]/, '').replace(/\\/g, '/');
    const s3Key = `projects/${projectId}/workspace/${normalizedPath}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: Buffer.from(content, 'utf8'),
          ContentType: this.getContentType(path),
          Metadata: {
            'project-id': projectId,
            'original-path': path,
            'content-hash': contentHash,
          },
        })
      );

      logger.info('File uploaded to S3', {
        projectId,
        path,
        s3Key,
        sizeBytes,
        contentHash: contentHash.substring(0, 8) + '...',
      });

      return { s3Key, contentHash, sizeBytes };
    } catch (error) {
      logger.error('Failed to upload file to S3', { projectId, path, error });
      throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download file content from S3
   */
  async downloadFile(s3Key: string): Promise<FileDownloadResult> {
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        })
      );

      const body = await response.Body?.transformToByteArray();
      const content = body ? Buffer.from(body).toString('utf8') : '';
      const sizeBytes = body?.byteLength || 0;

      logger.debug('File downloaded from S3', {
        s3Key,
        sizeBytes,
      });

      return {
        content,
        sizeBytes,
        lastModified: response.LastModified,
      };
    } catch (error) {
      logger.error('Failed to download file from S3', { s3Key, error });
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete file from S3
   */
  async deleteFile(s3Key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        })
      );

      logger.info('File deleted from S3', { s3Key });
    } catch (error) {
      logger.error('Failed to delete file from S3', { s3Key, error });
      throw new Error(`Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if file exists in S3
   */
  async fileExists(s3Key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a signed URL for direct upload (for large files)
   */
  async getSignedUploadUrl(
    projectId: string,
    path: string,
    expiresIn = 3600
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    const s3Key = `projects/${projectId}/files/${uuidv4()}`;

    const uploadUrl = await getSignedUrl(
      this.s3Client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        ContentType: this.getContentType(path),
        Metadata: {
          'project-id': projectId,
          'path': path,
        },
      }),
      { expiresIn }
    );

    return { uploadUrl, s3Key };
  }

  /**
   * Generate a signed URL for direct download
   */
  async getSignedDownloadUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      }),
      { expiresIn }
    );
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const contentTypes: Record<string, string> = {
      ts: 'text/typescript',
      tsx: 'text/typescript',
      js: 'text/javascript',
      jsx: 'text/javascript',
      json: 'application/json',
      html: 'text/html',
      css: 'text/css',
      md: 'text/markdown',
      py: 'text/x-python',
      go: 'text/x-go',
      rs: 'text/x-rust',
      java: 'text/x-java',
      yaml: 'text/yaml',
      yml: 'text/yaml',
      xml: 'text/xml',
      txt: 'text/plain',
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
      zip: 'application/zip',
    };
    return contentTypes[ext] || 'application/octet-stream';
  }
}

export const storageService = new StorageService();
export default storageService;
