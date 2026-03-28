import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

async function test() {
  const client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    },
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    // Trying just client config
    requestChecksumCalculation: "WHEN_REQUIRED", 
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  try {
    const key = 'projects/14923b8f-a5f3-4353-bebe-0124f1b5a3c5/workspace/index.html';
    const getRes = await client.send(new GetObjectCommand({ 
      Bucket: process.env.S3_BUCKET || 'project-files', 
      Key: key,
    }));
    const body = await getRes.Body?.transformToString();
    console.log('Downloaded length:', body?.length);
    console.log('Success with just client config!');
  } catch (e: any) {
    console.error('S3 Error:', e.message || e);
  }
}
test();
