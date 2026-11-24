/**
 * 容器/本地启动幂等 Seed 脚本：空库写入完整初始数据，非空库仅 upsert 6 个常规账号后跳过。
 */
import { loadEnv } from '../src/lib/env.ts';
import { createPrismaHandle } from '../src/lib/prisma.ts';
import { populateSeedData, SEED_USERS } from './seed-data.ts';

async function main(): Promise<void> {
  const env = loadEnv();
  const handle = createPrismaHandle(env.DATABASE_URL, 5);
  try {
    const now = new Date();
    const existingEventsCount = await handle.prisma.event.count();

    if (existingEventsCount > 0) {
      // 幂等重跑保护：已有业务数据时仅确保 6 个基础账号存在，不覆盖运行态演示数据
      for (const user of SEED_USERS) {
        await handle.prisma.user.upsert({
          where: { id: user.id },
          update: {
            name: user.name,
            email: user.email,
            role: user.role,
            isSimulated: false,
          },
          create: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            isSimulated: false,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      console.log(
        JSON.stringify({
          msg: 'seed skipped (events already exist); ensured base users',
          existingEventsCount,
        }),
      );
      return;
    }

    const summary = await handle.prisma.$transaction(async (tx) => {
      return populateSeedData(tx, now);
    });
    console.log(JSON.stringify({ msg: 'seed completed', ...summary }));
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
