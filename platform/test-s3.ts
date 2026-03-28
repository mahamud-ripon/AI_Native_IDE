import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
config({ path: 'platform/.env' });

async function test() {
  console.log('Endpoint:', process.env.S3_ENDPOINT);
  const client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_KEY || ''
    },
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: !!process.env.S3_ENDPOINT
  });

  try {
    // You can replace the Key with whatever was uploaded
    // Let's just list objects to see if we can read
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const res = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET || 'project-files' }));
    console.log('Objects:', res.Contents?.slice(0, 2).map(c => c.Key));
    
    if (res.Contents && res.Contents.length > 0) {
      const key = res.Contents[0].Key;
      console.log('Downloading:', key);
      const getRes = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET || 'project-files', Key: key }));
      const body = await getRes.Body?.transformToString();
      console.log('Downloaded length:', body?.length);
    }
  } catch (e) {
    console.error('S3 Error:', e);
  }
}
test();
