import { PushService, NotificationPayload } from './push_service.js';

const BATCH_WINDOW_MS = 3000;

interface PendingNotification {
  userId: string;
  type: string;
  title: string;
  body?: string;
  key: string;
}

const pendingNotifications: Map<string, PendingNotification[]> = new Map();
const batchTimers: Map<string, NodeJS.Timeout> = new Map();

export const NotificationBatcher = {
  queue(notification: PendingNotification): void {
    const key = notification.key;

    if (!pendingNotifications.has(key)) {
      pendingNotifications.set(key, []);

      const timer = setTimeout(async () => {
        await this.flush(key);
      }, BATCH_WINDOW_MS);

      batchTimers.set(key, timer);
    }

    pendingNotifications.get(key)!.push(notification);
  },

  async flush(key: string): Promise<void> {
    const notifications = pendingNotifications.get(key);
    if (!notifications || notifications.length === 0) return;

    pendingNotifications.delete(key);

    const timer = batchTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      batchTimers.delete(key);
    }

    const byUser = new Map<string, PendingNotification[]>();
    for (const n of notifications) {
      if (!byUser.has(n.userId)) {
        byUser.set(n.userId, []);
      }
      byUser.get(n.userId)!.push(n);
    }

    for (const [userId, userNotifications] of byUser) {
      if (userNotifications.length === 1) {
        await PushService.push(userId, {
          id: `notif-${Date.now()}`,
          type: userNotifications[0].type,
          title: userNotifications[0].title,
          body: userNotifications[0].body,
          createdAt: new Date().toISOString()
        });
      } else {
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

  async flushAll(): Promise<void> {
    const keys = Array.from(pendingNotifications.keys());
    for (const key of keys) {
      await this.flush(key);
    }
  }
};
