import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8004', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL!
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'execution-service'
  },

  wsGatewayUrl: process.env.WS_GATEWAY_URL || 'ws://localhost:8012',

  firecracker: {
    binary: process.env.FIRECRACKER_BINARY || '/usr/local/bin/firecracker',
    jailer: process.env.JAILER_BINARY || '/usr/local/bin/jailer',
    vmImage: process.env.VM_IMAGE_PATH || '/var/lib/firecracker/vmlinux',
    rootfs: process.env.ROOTFS_PATH || '/var/lib/firecracker/rootfs.ext4'
  },

  network: {
    cidr: process.env.VM_NETWORK_CIDR || '10.0.0.0/24',
    rateLimitMbps: parseInt(process.env.VM_RATE_LIMIT_MBPS || '10', 10),
    iopsLimit: parseInt(process.env.VM_IOPS_LIMIT || '1000', 10)
  },

  s3: {
    bucket: process.env.S3_BUCKET || 'vm-snapshots',
    region: process.env.AWS_REGION || 'us-east-1'
  },

  vault: {
    addr: process.env.VAULT_ADDR || 'https://vault.platform.io'
  },

  internalApiKey: process.env.INTERNAL_API_KEY || (() => { throw new Error('INTERNAL_API_KEY env var is required'); })()
};
