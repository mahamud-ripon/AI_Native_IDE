import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('[Seed] Checking system user...');

  const existing = await prisma.user.findUnique({
    where: { id: SYSTEM_USER_ID },
  });

  if (existing) {
    console.log('[Seed] System user already exists');
    return;
  }

  await prisma.user.create({
    data: {
      id: SYSTEM_USER_ID,
      email: 'system@ai-native-ide.internal',
      username: 'system',
      hashedPassword: '!',
      fullName: 'System',
      isVerified: true,
      isActive: true,
    },
  });

  console.log('[Seed] System user created');
}

main()
  .catch((e) => {
    console.error('[Seed] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
