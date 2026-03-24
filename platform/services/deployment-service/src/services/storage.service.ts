import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const S3_BUCKET = process.env.S3_FILE_BUCKET || 'ide-files';

export const storageService = {
  async downloadFile(s3Key: string): Promise<{ content: string }> {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });

    const response = await s3Client.send(command);
    const body = await response.Body?.transformToString('utf-8');
    
    return { content: body || '' };
  }
};
