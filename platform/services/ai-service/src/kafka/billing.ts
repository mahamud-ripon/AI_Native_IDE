import { Kafka, Producer } from 'kafkajs';
import { config } from '../config.js';

let producer: Producer | null = null;

export interface BillingEvent {
  taskId: string;
  userId: string;
  projectId: string;
  tokenCount: number;
  duration: number;
  status: 'completed' | 'failed';
  error?: string;
}

async function getProducer(): Promise<Producer> {
  if (!producer) {
    const kafka = new Kafka({
      clientId: 'ai-service',
      brokers: config.kafkaBrokers.split(','),
    });
    producer = kafka.producer();
    await producer.connect();
  }
  return producer;
}

export async function emitBillingEvent(event: BillingEvent): Promise<void> {
  try {
    const kafkaProducer = await getProducer();
    
    await kafkaProducer.send({
      topic: 'ai.task.completed',
      messages: [
        {
          key: event.taskId,
          value: JSON.stringify({
            taskId: event.taskId,
            userId: event.userId,
            projectId: event.projectId,
            tokenCount: event.tokenCount,
            duration: event.duration,
            status: event.status,
            error: event.error,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    });
  } catch (error) {
    console.error('Failed to emit billing event:', error);
  }
}

export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}
