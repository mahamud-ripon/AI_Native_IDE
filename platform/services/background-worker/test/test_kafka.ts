import { Kafka, Producer } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'test-producer',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const producer: Producer = kafka.producer();

async function testKafkaEvents() {
  console.log('🧪 Testing Kafka Event Publishing...\n');

  await producer.connect();
  console.log('✅ Connected to Kafka\n');

  const events = [
    {
      topic: 'user.created',
      message: {
        userId: 'test-user-123',
        email: 'test@example.com',
        name: 'Test User',
      },
    },
    {
      topic: 'invitation.created',
      message: {
        invitationId: 'test-inv-123',
        email: 'invited@example.com',
        orgName: 'Test Org',
      },
    },
    {
      topic: 'deployment.completed',
      message: {
        userId: 'test-user-123',
        email: 'test@example.com',
        projectId: 'test-project-123',
        projectName: 'Test Project',
        deployUrl: 'https://test.example.com',
        status: 'success',
      },
    },
    {
      topic: 'usage.exceeded',
      message: {
        userId: 'test-user-123',
        email: 'test@example.com',
        usagePercent: 80,
        quotaType: 'AI Tokens',
      },
    },
    {
      topic: 'file.modified',
      message: {
        fileId: 'test-file-123',
        projectId: 'test-project-123',
        path: '/src/test.ts',
      },
    },
    {
      topic: 'file.deleted',
      message: {
        fileId: 'test-file-456',
        projectId: 'test-project-123',
      },
    },
  ];

  for (const event of events) {
    console.log(`📤 Publishing to ${event.topic}...`);
    await producer.send({
      topic: event.topic,
      messages: [
        {
          key: event.message.userId || event.message.fileId || 'test',
          value: JSON.stringify(event.message),
        },
      ],
    });
    console.log(`   ✅ Published: ${JSON.stringify(event.message)}\n`);
  }

  await producer.disconnect();
  console.log('✅ Kafka tests completed!');
  console.log('   Run the background-worker to consume these events.\n');

  process.exit(0);
}

testKafkaEvents().catch(console.error);
