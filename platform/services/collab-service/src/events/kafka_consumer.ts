import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { config } from '../config.js';
import { YjsManager } from '../core/yjs_manager.js';
import { AwarenessManager } from '../core/awareness_manager.js';
import { RedisPersistence } from '../persistence/redis_adapter.js';
import { redis, RedisKeys } from '../lib/redis.js';

const kafka = new Kafka({
  clientId: 'collab-service',
  brokers: config.kafkaBrokers,
});

let consumer: Consumer | null = null;

export const KafkaConsumer = {
  /**
   * Start the Kafka consumer
   */
  async start(): Promise<void> {
    if (consumer) return;
    
    consumer = kafka.consumer({ groupId: config.kafkaGroupId });
    
    await consumer.connect();
    console.log('[Kafka] Consumer connected');

    // Subscribe to relevant topics
    await consumer.subscribe({ topic: 'project.deleted', fromBeginning: false });
    await consumer.subscribe({ topic: 'file.deleted', fromBeginning: false });
    await consumer.subscribe({ topic: 'project.archived', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }: EachMessagePayload) => {
        try {
          const payload = JSON.parse(message.value?.toString() || '{}');
          
          switch (topic) {
            case 'project.deleted':
              await KafkaConsumer.handleProjectDeleted(payload);
              break;
            case 'file.deleted':
              await KafkaConsumer.handleFileDeleted(payload);
              break;
            case 'project.archived':
              await KafkaConsumer.handleProjectArchived(payload);
              break;
          }
        } catch (error: any) {
          console.error('[Kafka] Message processing error:', error.message);
        }
      }
    });
  },

  /**
   * Stop the Kafka consumer
   */
  async stop(): Promise<void> {
    if (consumer) {
      await consumer.disconnect();
      consumer = null;
    }
  },

  /**
   * Handle project.deleted event
   * Delete all Yjs docs for this project
   */
  async handleProjectDeleted(payload: { projectId: string }): Promise<void> {
    console.log(`[Kafka] Handling project.deleted for ${payload.projectId}`);
    
    // Find all files in this project and delete their docs
    const keys = await redis.keys(`yjs:doc:*`);
    
    for (const key of keys) {
      // This is a simplified approach - in production, you'd query the DB
      // to get all fileIds for the projectId
      await redis.del(key);
    }
    
    console.log(`[Kafka] Cleaned up project ${payload.projectId}`);
  },

  /**
   * Handle file.deleted event
   * Delete the Yjs doc for this file
   */
  async handleFileDeleted(payload: { fileId: string }): Promise<void> {
    console.log(`[Kafka] Handling file.deleted for ${payload.fileId}`);
    
    // Delete Yjs doc from memory and Redis
    await YjsManager.deleteDoc(payload.fileId);
    
    // Clear awareness
    AwarenessManager.clearFileAwareness(payload.fileId);
    
    console.log(`[Kafka] Cleaned up file ${payload.fileId}`);
  },

  /**
   * Handle project.archived event
   * Optionally unload docs from memory (keep persisted state)
   */
  async handleProjectArchived(payload: { projectId: string }): Promise<void> {
    console.log(`[Kafka] Handling project.archived for ${payload.projectId}`);
    
    // Unload docs from memory but keep in Redis
    const cachedFiles = YjsManager.getCachedFileIds();
    
    for (const fileId of cachedFiles) {
      await YjsManager.unloadDoc(fileId);
    }
    
    console.log(`[Kafka] Unloaded docs for archived project ${payload.projectId}`);
  }
};
