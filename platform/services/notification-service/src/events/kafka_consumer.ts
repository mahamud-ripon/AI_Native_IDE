import { Consumer, EachMessagePayload } from 'kafkajs';
import { createKafkaClient } from '@workspace/config/kafka';
import { config } from '../config/index.js';
import { PushService } from '../services/push_service.js';
import { EmailService } from '../services/email_service.js';
import { NotificationBatcher } from '../services/notification_batcher.js';
import { EmailWorker } from '../workers/email_worker.js';

const kafka = createKafkaClient({ clientId: 'notification-service', groupId: config.kafka.groupId });

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

export const KafkaConsumer = {
  async start() {
    if (process.env.NODE_ENV === 'test') return;

    await consumer.connect();
    console.log('[Kafka] Consumer connected');

    await consumer.subscribe({ topic: 'notification.alert', fromBeginning: false });
    await consumer.subscribe({ topic: 'user.created', fromBeginning: false });
    await consumer.subscribe({ topic: 'auth.email_action', fromBeginning: false });
    await consumer.subscribe({ topic: 'invitation.created', fromBeginning: false });
    await consumer.subscribe({ topic: 'deployment.completed', fromBeginning: false });
    await consumer.subscribe({ topic: 'usage.exceeded', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }: EachMessagePayload) => {
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
      NotificationBatcher.queue({
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        key: payload.batchKey
      });
    } else {
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
    await EmailWorker.addJob({
      type: 'verify',
      to: payload.email,
      data: { token: 'welcome-token' },
      idempotencyKey: `verify-${payload.email}`
    });
  },

  async handleEmailAction(payload: { userId: string; email: string; action: string; token: string }) {
    switch (payload.action) {
      case 'verify':
        await EmailWorker.addJob({
          type: 'verify',
          to: payload.email,
          data: { token: payload.token },
          idempotencyKey: `verify-${payload.email}`
        });
        break;
      case 'reset':
        await EmailWorker.addJob({
          type: 'reset',
          to: payload.email,
          data: { token: payload.token },
          idempotencyKey: `reset-${payload.email}`
        });
        break;
    }
  },

  async handleInvitation(payload: { email: string; projectName: string; inviterName: string }) {
    await EmailWorker.addJob({
      type: 'invite',
      to: payload.email,
      data: { projectName: payload.projectName, inviterName: payload.inviterName },
      idempotencyKey: `invite-${payload.email}-${payload.projectName}`
    });
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
  },

  async disconnect() {
    await consumer.disconnect();
  }
};
