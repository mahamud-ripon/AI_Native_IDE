const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const tasks = await prisma.executionTask.findMany({ select: { id: true, status: true, currentStage: true, retryCount: true, createdAt: true } });
  console.log(tasks);
}
main().finally(() => prisma.$disconnect());
