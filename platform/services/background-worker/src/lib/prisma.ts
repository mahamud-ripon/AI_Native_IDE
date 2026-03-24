import { prisma } from '@workspace/database';

export { prisma };

// Graceful shutdown
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  console.log('✅ Prisma disconnected');
}
