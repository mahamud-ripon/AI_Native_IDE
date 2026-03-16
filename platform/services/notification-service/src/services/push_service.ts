import { redis, RedisKeys } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';

const INBOX_LIMIT = 100;

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export const PushService = {
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
    const inboxKey = RedisKeys.inbox(userId);
    await redis.lpush(inboxKey, JSON.stringify(notification));
    await redis.ltrim(inboxKey, 0, INBOX_LIMIT - 1);

    // Publish to Redis Pub/Sub for real-time push
    await redis.publish(RedisKeys.notificationChannel(userId), JSON.stringify(notification));

    console.log(`[Push] Pushed notification to user ${userId}: ${notification.title}`);
  },

  async pushBatched(userId: string, notifications: NotificationPayload[]): Promise<void> {
    const batched: NotificationPayload = {
      id: `batch-${Date.now()}`,
      type: 'batch',
      title: `${notifications.length} notifications`,
      body: `You have ${notifications.length} unread notifications`,
      metadata: { items: notifications },
      createdAt: new Date().toISOString()
    };

    await this.push(userId, batched);
  },

  async getInbox(userId: string, limit = 20): Promise<NotificationPayload[]> {
    const inboxKey = RedisKeys.inbox(userId);
    const items = await redis.lrange(inboxKey, 0, limit - 1);
    return items.map(item => JSON.parse(item));
  },

  async clearInbox(userId: string): Promise<void> {
    const inboxKey = RedisKeys.inbox(userId);
    await redis.del(inboxKey);
  }
};
