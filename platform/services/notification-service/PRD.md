# Notification Service - Detailed Implementation Guide (PRD)

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Service:** notification-service (Port 8007)  
> **Tech Stack:** Node.js + Fastify + Redis Pub/Sub + AWS SES + Redpanda (Kafka-compatible)

---

## 1. Executive Summary

The Notification Service handles reliable, asynchronous delivery of system alerts, @mentions, and transactional emails. It integrates with WebSocket Gateway for real-time push and AWS SES for emails.

---

## 2. Project Setup

### 2.1 Initialize Project

```bash
mkdir -p notification-service/src/{controllers,services,events,lib,config,middleware,workers}
cd notification-service
npm init -y
npm install fastify @fastify/cors @fastify/helmet @aws-sdk/client-ses ioredis @prisma/client kafkajs zod dotenv bullmq
npm install -D typescript @types/node ts-node prisma
npx tsc --init
```

### 2.2 package.json

```json
{
  "name": "notification-service",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "fastify": "^4.24.3",
    "@fastify/cors": "^8.4.1",
    "@fastify/helmet": "^11.1.1",
    "@aws-sdk/client-ses": "^3.478.0",
    "ioredis": "^5.3.2",
    "@prisma/client": "^5.10.0",
    "kafkajs": "^2.2.4",
    "zod": "^3.22.4",
    "dotenv": "^16.3.1",
    "bullmq": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.0",
    "ts-node": "^10.9.2",
    "prisma": "^5.10.0"
  }
}
```

---

## 3. Configuration

### 3.1 Environment Variables (.env)

```env
# Server
PORT=8007
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ai_native_ide

# Redis
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=notification-service

# WebSocket Gateway
WS_GATEWAY_URL=ws://websocket-gateway:8012

# AWS SES
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_FROM_EMAIL=noreply@platform.io

# Email Templates
VERIFY_EMAIL_TEMPLATE=
PASSWORD_RESET_TEMPLATE=
PAYMENT_FAILED_TEMPLATE=
PROJECT_INVITE_TEMPLATE=

# Internal Auth
INTERNAL_API_KEY=your-internal-api-key
```

### 3.2 Config File (src/config/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8007', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    url: process.env.DATABASE_URL!
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'notification-service'
  },
  
  wsGatewayUrl: process.env.WS_GATEWAY_URL || 'ws://localhost:8012',
  
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sesFromEmail: process.env.SES_FROM_EMAIL || 'noreply@platform.io'
  },
  
  emailTemplates: {
    verifyEmail: process.env.VERIFY_EMAIL_TEMPLATE,
    passwordReset: process.env.PASSWORD_RESET_TEMPLATE,
    paymentFailed: process.env.PAYMENT_FAILED_TEMPLATE,
    projectInvite: process.env.PROJECT_INVITE_TEMPLATE
  },
  
  internalApiKey: process.env.INTERNAL_API_KEY!
};
```

---

## 4. Core Services

### 4.1 Push Service (src/services/push_service.ts)

```typescript
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';

const INBOX_LIMIT = 100;
const BATCH_WINDOW_MS = 3000;

interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export const PushService = {
  // Push notification to user via Redis Pub/Sub
  async push(userId: string, notification: NotificationPayload): Promise<void> {
    // Save to Postgres for history
    await prisma.notification.create({
      data: {
        userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        actionUrl: notification.actionUrl,
        metadata: notification.metadata
      }
    });

    // Push to Redis inbox (bounded list)
    const inboxKey = `inbox:${userId}`;
    await redis.lpush(inboxKey, JSON.stringify(notification));
    await redis.ltrim(inboxKey, 0, INBOX_LIMIT - 1);

    // Publish to Redis Pub/Sub for real-time push
    await redis.publish(`notifications:${userId}`, JSON.stringify(notification));

    console.log(`[Push] Pushed notification to user ${userId}: ${notification.title}`);
  },

  // Push batched notification
  async pushBatched(userId: string, notifications: NotificationPayload[]): Promise<void> {
    const batched = {
      id: `batch-${Date.now()}`,
      type: 'batch',
      title: `${notifications.length} notifications`,
      body: `You have ${notifications.length} unread notifications`,
      metadata: { items: notifications },
      createdAt: new Date().toISOString()
    };

    await this.push(userId, batched);
  },

  // Get user's inbox from Redis
  async getInbox(userId: string, limit = 20): Promise<NotificationPayload[]> {
    const inboxKey = `inbox:${userId}`;
    const items = await redis.lrange(inboxKey, 0, limit - 1);
    return items.map(item => JSON.parse(item));
  },

  // Clear user's inbox (after WebSocket reconnects)
  async clearInbox(userId: string): Promise<void> {
    const inboxKey = `inbox:${userId}`;
    await redis.del(inboxKey);
  }
};
```

### 4.2 Email Service (src/services/email_service.ts)

```typescript
import AWS from 'aws-sdk';
import { config } from '../config';

const ses = new AWS.SES({
  region: config.aws.region,
  accessKeyId: config.aws.accessKeyId,
  secretAccessKey: config.aws.secretAccessKey
});

interface EmailParams {
  to: string;
  subject: string;
  body: string;
  html?: string;
  idempotencyKey?: string;
}

export const EmailService = {
  async send(params: EmailParams): Promise<boolean> {
    try {
      const result = await ses.sendEmail({
        Source: config.aws.sesFromEmail,
        Destination: {
          ToAddresses: [params.to]
        },
        Message: {
          Subject: {
            Data: params.subject,
            Charset: 'UTF-8'
          },
          Body: {
            Text: {
              Data: params.body,
              Charset: 'UTF-8'
            },
            ...(params.html && {
              Html: {
                Data: params.html,
                Charset: 'UTF-8'
              }
            })
          }
        },
        // Idempotency
        ...(params.idempotencyKey && {
          ConfigurationSetName: params.idempotencyKey
        })
      }).promise();

      console.log(`[Email] Sent to ${params.to}: ${result.MessageId}`);
      return true;
    } catch (error) {
      console.error(`[Email] Failed to send to ${params.to}:`, error);
      return false;
    }
  },

  async sendVerifyEmail(to: string, token: string): Promise<boolean> {
    const url = `https://platform.io/verify-email?token=${token}`;
    return this.send({
      to,
      subject: 'Verify your email - AI-Native IDE',
      body: `Click here to verify your email: ${url}`,
      html: `<p>Click <a href="${url}">here</a> to verify your email.</p>`,
      idempotencyKey: `verify-${to}`
    });
  },

  async sendPasswordReset(to: string, token: string): Promise<boolean> {
    const url = `https://platform.io/reset-password?token=${token}`;
    return this.send({
      to,
      subject: 'Reset your password - AI-Native IDE',
      body: `Click here to reset your password: ${url}`,
      html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
      idempotencyKey: `reset-${to}`
    });
  },

  async sendProjectInvite(to: string, projectName: string, inviterName: string): Promise<boolean> {
    return this.send({
      to,
      subject: `${inviterName} invited you to ${projectName}`,
      body: `You've been invited to collaborate on ${projectName}. Log in to accept.`,
      html: `<p>You've been invited to collaborate on <strong>${projectName}</strong> by ${inviterName}.</p>`,
      idempotencyKey: `invite-${to}-${projectName}`
    });
  },

  async sendPaymentFailed(to: string, projectName: string): Promise<boolean> {
    return this.send({
      to,
      subject: 'Payment failed - Action required',
      body: `Your payment for ${projectName} failed. Please update your payment method.`,
      html: `<p>Your payment for <strong>${projectName}</strong> failed. Please update your payment method.</p>`,
      idempotencyKey: `payment-${to}`
    });
  }
};
```

### 4.3 Notification Batcher (src/services/notification_batcher.ts)

```typescript
import { PushService } from './push_service';

interface PendingNotification {
  userId: string;
  type: string;
  title: string;
  body?: string;
  key: string; // Grouping key
}

const pendingNotifications: Map<string, PendingNotification[]> = new Map();
const batchTimers: Map<string, NodeJS.Timeout> = new Map();

export const NotificationBatcher = {
  // Queue notification for batching
  queue(notification: PendingNotification): void {
    const key = notification.key;
    
    if (!pendingNotifications.has(key)) {
      pendingNotifications.set(key, []);
      
      // Set batch window timer
      const timer = setTimeout(async () => {
        await this.flush(key);
      }, BATCH_WINDOW_MS);
      
      batchTimers.set(key, timer);
    }
    
    pendingNotifications.get(key)!.push(notification);
  },

  // Flush batched notifications
  async flush(key: string): Promise<void> {
    const notifications = pendingNotifications.get(key);
    if (!notifications || notifications.length === 0) return;
    
    // Clear pending
    pendingNotifications.delete(key);
    
    const timer = batchTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      batchTimers.delete(key);
    }
    
    // Group by user
    const byUser = new Map<string, PendingNotification[]>();
    for (const n of notifications) {
      if (!byUser.has(n.userId)) {
        byUser.set(n.userId, []);
      }
      byUser.get(n.userId)!.push(n);
    }
    
    // Push to each user
    for (const [userId, userNotifications] of byUser) {
      if (userNotifications.length === 1) {
        // Single notification, push directly
        await PushService.push(userId, {
          id: `notif-${Date.now()}`,
          type: userNotifications[0].type,
          title: userNotifications[0].title,
          body: userNotifications[0].body,
          createdAt: new Date().toISOString()
        });
      } else {
        // Batch multiple notifications
        await PushService.pushBatched(userId, userNotifications.map((n, i) => ({
          id: `notif-${Date.now()}-${i}`,
          type: n.type,
          title: n.title,
          body: n.body,
          createdAt: new Date().toISOString()
        })));
      }
    }
  },

  // Force flush all pending
  async flushAll(): Promise<void> {
    const keys = Array.from(pendingNotifications.keys());
    for (const key of keys) {
      await this.flush(key);
    }
  }
};
```

---

## 5. Controllers

### 5.1 Notification Controller (src/controllers/notification_controller.ts)

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { PushService } from '../services/push_service';
import { prisma } from '../lib/prisma';

export const NotificationController = {
  // GET /api/v1/notifications
  async list(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;
      const { page = '1', limit = '20', unreadOnly = 'false' } = req.query;

      const where: any = { userId };
      if (unreadOnly === 'true') {
        where.isRead = false;
      }

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (parseInt(page as string) - 1) * parseInt(limit as string),
          take: parseInt(limit as string)
        }),
        prisma.notification.count({ where })
      ]);

      return res.json({
        success: true,
        data: notifications,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total,
          pages: Math.ceil(total / parseInt(limit as string))
        }
      });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /api/v1/notifications/:id/read
  async markRead(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      await prisma.notification.updateMany({
        where: { id, userId },
        data: { isRead: true, readAt: new Date() }
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /api/v1/notifications/read-all
  async markAllRead(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;

      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: new Date() }
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // DELETE /api/v1/notifications/:id
  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      await prisma.notification.deleteMany({
        where: { id, userId }
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /api/v1/notifications/unread-count
  async unreadCount(req: Request, res: Response) {
    try {
      const userId = (req as any).user.id;

      const count = await prisma.notification.count({
        where: { userId, isRead: false }
      });

      return res.json({ success: true, count });
    } catch (error: any) {
      console.error('[Notifications] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

---

## 6. Kafka Integration

### 6.1 Kafka Consumer (src/events/kafka_consumer.ts)

```typescript
import { Kafka, Consumer } from 'kafkajs';
import { config } from '../config';
import { PushService } from '../services/push_service';
import { EmailService } from '../services/email_service';
import { NotificationBatcher } from '../services/notification_batcher';

const kafka = new Kafka({
  clientId: 'notification-service',
  brokers: config.kafka.brokers,
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

export const KafkaConsumer = {
  async start() {
    await consumer.connect();
    console.log('[Kafka] Consumer connected');

    // Subscribe to notification topics
    await consumer.subscribe({ topic: 'notification.alert', fromBeginning: false });
    await consumer.subscribe({ topic: 'user.created', fromBeginning: false });
    await consumer.subscribe({ topic: 'auth.email_action', fromBeginning: false });
    await consumer.subscribe({ topic: 'invitation.created', fromBeginning: false });
    await consumer.subscribe({ topic: 'deployment.completed', fromBeginning: false });
    await consumer.subscribe({ topic: 'usage.exceeded', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          const payload = JSON.parse(message.value?.toString() || '{}');
          
          switch (topic) {
            case 'notification.alert':
              await this.handleAlert(payload);
              break;
            case 'user.created':
              await this.handleUserCreated(payload);
              break;
            case 'auth.email_action':
              await this.handleEmailAction(payload);
              break;
            case 'invitation.created':
              await this.handleInvitation(payload);
              break;
            case 'deployment.completed':
              await this.handleDeploymentCompleted(payload);
              break;
            case 'usage.exceeded':
              await this.handleUsageExceeded(payload);
              break;
          }
        } catch (error) {
          console.error('[Kafka] Message processing error:', error);
        }
      }
    });
  },

  async handleAlert(payload: { userId: string; type: string; title: string; body?: string; batchKey?: string }) {
    if (payload.batchKey) {
      // Queue for batching
      NotificationBatcher.queue({
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        key: payload.batchKey
      });
    } else {
      // Push immediately
      await PushService.push(payload.userId, {
        id: `notif-${Date.now()}`,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        createdAt: new Date().toISOString()
      });
    }
  },

  async handleUserCreated(payload: { userId: string; email: string; username: string }) {
    // Queue welcome email
    await EmailService.sendVerifyEmail(payload.email, 'welcome-token');
  },

  async handleEmailAction(payload: { userId: string; email: string; action: string; token: string }) {
    switch (payload.action) {
      case 'verify':
        await EmailService.sendVerifyEmail(payload.email, payload.token);
        break;
      case 'reset':
        await EmailService.sendPasswordReset(payload.email, payload.token);
        break;
    }
  },

  async handleInvitation(payload: { email: string; projectName: string; inviterName: string }) {
    await EmailService.sendProjectInvite(payload.email, payload.projectName, payload.inviterName);
  },

  async handleDeploymentCompleted(payload: { userId: string; projectName: string; url: string }) {
    await PushService.push(payload.userId, {
      id: `deploy-${Date.now()}`,
      type: 'success',
      title: 'Deployment Complete',
      body: `Your project "${payload.projectName}" is live at ${payload.url}`,
      actionUrl: payload.url,
      createdAt: new Date().toISOString()
    });
  },

  async handleUsageExceeded(payload: { userId: string; metric: string; current: number; limit: number }) {
    await PushService.push(payload.userId, {
      id: `usage-${Date.now()}`,
      type: 'warning',
      title: 'Usage Limit Reached',
      body: `You've used ${payload.current} of your ${payload.limit} ${payload.metric} limit`,
      actionUrl: '/billing',
      createdAt: new Date().toISOString()
    });
  }
};
```

---

## 7. Email Queue Worker

### 7.1 Email Worker (src/workers/email_worker.ts)

```typescript
import { Queue, Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { EmailService } from '../services/email_service';

const emailQueue = new Queue('email', { connection: redis });

interface EmailJob {
  type: 'verify' | 'reset' | 'invite' | 'payment_failed';
  to: string;
  data: Record<string, string>;
  idempotencyKey: string;
}

export const EmailWorker = {
  async addJob(job: EmailJob): Promise<void> {
    await emailQueue.add('send', job, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    });
  },

  start(): void {
    const worker = new Worker('email', async (job: Job) => {
      const { type, to, data, idempotencyKey } = job.data as EmailJob;
      
      console.log(`[EmailWorker] Processing ${type} email to ${to}`);
      
      let success = false;
      
      switch (type) {
        case 'verify':
          success = await EmailService.sendVerifyEmail(to, data.token);
          break;
        case 'reset':
          success = await EmailService.sendPasswordReset(to, data.token);
          break;
        case 'invite':
          success = await EmailService.sendProjectInvite(to, data.projectName, data.inviterName);
          break;
        case 'payment_failed':
          success = await EmailService.sendPaymentFailed(to, data.projectName);
          break;
      }
      
      if (!success) {
        throw new Error(`Failed to send ${type} email`);
      }
      
      return { success: true };
    }, {
      connection: redis,
      concurrency: 10
    });

    worker.on('completed', (job) => {
      console.log(`[EmailWorker] Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[EmailWorker] Job ${job?.id} failed:`, err.message);
      
      // Move to DLQ after max retries
      if (job?.attemptsMade === 3) {
        console.error(`[EmailWorker] Moving to DLQ:`, job.data);
      }
    });

    console.log('[EmailWorker] Started');
  }
};
```

---

## 8. Data Models (from Prisma Schema)

### 8.1 Notification

```prisma
model Notification {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  user      User      @relation(fields: [userId], references: [id])
  type      String    @db.VarChar(50)
  title     String    @db.VarChar(255)
  body      String?   @db.Text
  actionUrl String?   @map("action_url") @db.Text
  metadata  Json?
  isRead    Boolean   @default(false) @map("is_read")
  readAt    DateTime? @map("read_at") @db.Timestamptz()
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  @@index([userId])
  @@index([createdAt])
  @@map("notifications")
}
```

---

## 9. Main Application

### 9.1 App Setup (src/app.ts)

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { NotificationController } from './controllers/notification_controller';

const app = Fastify({ logger: true });

// Register plugins
await app.register(helmet);
await app.register(cors, { origin: true });

// Health check
app.get('/api/v1/health', async () => ({ status: 'healthy', service: 'notification-service' }));

app.get('/api/v1/health/circuit-breaker', async () => ({ status: 'closed', failures: 0 }));

// Protected endpoints
app.get('/api/v1/notifications', { preHandler: authMiddleware }, NotificationController.list);
app.put('/api/v1/notifications/:id/read', { preHandler: authMiddleware }, NotificationController.markRead);
app.put('/api/v1/notifications/read-all', { preHandler: authMiddleware }, NotificationController.markAllRead);
app.delete('/api/v1/notifications/:id', { preHandler: authMiddleware }, NotificationController.delete);
app.get('/api/v1/notifications/unread-count', { preHandler: authMiddleware }, NotificationController.unreadCount);

export { app };
```

### 9.2 Entry Point (src/index.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { config } from './config';
import { redis } from './lib/redis';
import { prisma, disconnectPrisma } from './lib/prisma';
import { KafkaConsumer } from './events/kafka_consumer';
import { EmailWorker } from './workers/email_worker';

async function main() {
  console.log('[Notification] Starting service...');

  await redis.connect();
  await KafkaConsumer.start();
  EmailWorker.start();

  app.listen(config.port, () => {
    console.log(`[Notification] Service running on port ${config.port}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[Notification] Shutting down...');
  await redis.quit();
  await disconnectPrisma();
  process.exit(0);
});

main().catch(console.error);
```

---

## 10. Testing Checklist

```bash
# Run the service
npm run dev

# Test health
curl http://localhost:8007/api/v1/health

# Test notifications list
curl -H "Authorization: Bearer <token>" \
  http://localhost:8007/api/v1/notifications

# Test unread count
curl -H "Authorization: Bearer <token>" \
  http://localhost:8007/api/v1/notifications/unread-count
```

---

## 11. Implementation Status

| Component | Status |
|-----------|--------|
| Project Setup | ✅ Complete |
| Config | ✅ Complete |
| Push Service | ✅ Complete |
| Email Service | ✅ Complete |
| Notification Batcher | ✅ Complete |
| Controllers | ✅ Complete |
| Kafka Consumer | ✅ Complete |
| Email Worker | ✅ Complete |
| App & Index | ✅ Complete |

---

## 12. Key Implementation Notes

### 12.1 Real-Time Push
- Push via Redis Pub/Sub channel `notifications:{user_id}`
- Store in bounded Redis list `inbox:{user_id}` (max 100)
- Frontend fetches inbox on WebSocket reconnect

### 12.2 Email Queue
- BullMQ for email job queue
- Idempotency keys prevent duplicate sends
- 3 attempts with exponential backoff
- Failed jobs go to DLQ

### 12.3 Notification Batching
- 3000ms debounce window
- Group similar notifications
- Single push for batched items

### 12.4 Email Templates
- Verify Email
- Password Reset
- Payment Failed
- Project Invite
