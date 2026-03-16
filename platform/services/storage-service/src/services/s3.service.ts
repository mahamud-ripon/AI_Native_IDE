import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  ObjectIdentifier,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/index';
import { logger } from '../lib/logger';

// Singleton S3 client
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      forcePathStyle: config.s3.forcePathStyle,
    });
  }
  return s3Client;
}

export const S3Service = {
  /**
   * Upload a file to S3
   */
  async upload(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const client = getS3Client();
    
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
      })
    );
    
    logger.debug({ bucket, key, contentType }, 'File uploaded to S3');
  },

  /**
   * Download a file from S3
   */
  async download(bucket: string, key: string): Promise<Buffer> {
    const client = getS3Client();
    
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error('Empty response body from S3');
    }

    const stream = response.Body as any;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  },

  /**
   * Delete a single object from S3
   */
  async delete(bucket: string, key: string): Promise<void> {
    const client = getS3Client();
    
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    
    logger.debug({ bucket, key }, 'File deleted from S3');
  },

  /**
   * Delete multiple objects from S3 (batch delete)
   */
  async deleteObjects(
    bucket: string,
    keys: string[]
  ): Promise<{ deleted: string[]; errors: string[] }> {
    if (keys.length === 0) {
      return { deleted: [], errors: [] };
    }

    if (keys.length > 1000) {
      throw new Error('Cannot delete more than 1000 objects at once');
    }

    const client = getS3Client();
    const objects: ObjectIdentifier[] = keys.map((key) => ({ Key: key }));

    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects },
      })
    );

    const deleted = response.Deleted?.map((d) => d.Key || '') || [];
    const errors =
      response.Errors?.map((e) => `${e.Key}: ${e.Message || 'Unknown error'}`) || [];

    logger.debug({ bucket, deletedCount: deleted.length, errorCount: errors.length }, 'Batch delete completed');

    return { deleted, errors };
  },

  /**
   * List all keys in a bucket with optional prefix
   */
  async listKeys(bucket: string, prefix: string = ''): Promise<string[]> {
    const client = getS3Client();
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      response.Contents?.forEach((obj) => {
        if (obj.Key) {
          keys.push(obj.Key);
        }
      });

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  },

  /**
   * Get object metadata without downloading the body
   */
  async getMetadata(
    bucket: string,
    key: string
  ): Promise<{ size: number; contentType: string; lastModified: Date; etag: string }> {
    const client = getS3Client();

    const response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    return {
      size: response.ContentLength || 0,
      contentType: response.ContentType || 'application/octet-stream',
      lastModified: response.LastModified || new Date(),
      etag: response.ETag || '',
    };
  },

  /**
   * Check if an object exists
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.getMetadata(bucket, key);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Copy an object within S3
   */
  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    const client = getS3Client();

    await client.send(
      new CopyObjectCommand({
        Bucket: destBucket,
        CopySource: `${sourceBucket}/${sourceKey}`,
        Key: destKey,
      })
    );

    logger.debug({ sourceBucket, sourceKey, destBucket, destKey }, 'Object copied');
  },

  /**
   * Generate a pre-signed URL for uploading (PUT)
   */
  async getSignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    expiresIn: number = config.storage.presignedUrlExpiry.upload
  ): Promise<string> {
    const client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(client, command, { expiresIn });
  },

  /**
   * Generate a pre-signed URL for downloading (GET)
   */
  async getSignedDownloadUrl(
    bucket: string,
    key: string,
    expiresIn: number = config.storage.presignedUrlExpiry.download
  ): Promise<string> {
    const client = getS3Client();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return getSignedUrl(client, command, { expiresIn });
  },

  /**
   * Get bucket name by type
   */
  getBucketName(bucketType: string): string {
    const bucketMap: Record<string, string> = {
      'user-files': config.s3.buckets.userFiles,
      snapshots: config.s3.buckets.snapshots,
      'build-logs': config.s3.buckets.buildLogs,
      artifacts: config.s3.buckets.artifacts,
      avatars: config.s3.buckets.avatars,
    };

    const bucket = bucketMap[bucketType];
    if (!bucket) {
      throw new Error(`Invalid bucket type: ${bucketType}`);
    }

    return bucket;
  },
};

export default S3Service;
