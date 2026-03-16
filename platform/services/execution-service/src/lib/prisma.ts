import { prisma } from '@workspace/database';

export { prisma };

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
