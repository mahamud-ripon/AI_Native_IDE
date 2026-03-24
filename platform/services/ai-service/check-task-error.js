const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const t = await prisma.executionTask.findUnique({ where: { id: 'ea6a2ecb-4fa8-4bdb-8fbc-2df80cfae3bd' }});
  console.log('Task:', t.id, t.error);
  const events = await prisma.executionTaskEvent.findMany({ where: { taskId: 'ea6a2ecb-4fa8-4bdb-8fbc-2df80cfae3bd' } });
  console.log('Events:', events.map(e => ({ type: e.eventType, stage: e.stage, message: e.message })));
}
main().finally(() => prisma.$disconnect());
