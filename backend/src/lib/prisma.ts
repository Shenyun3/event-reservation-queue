/**
 * Prisma 7 客户端工厂（使用 @prisma/adapter-pg + 显式配置连接池上限 DB_POOL_MAX）。
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.ts';

/** Prisma 运行时句柄（封装客户端与底层 pg 连接池以便优雅释放）。 */
export interface PrismaHandle {
  prisma: PrismaClient;
  pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * 创建绑定 PostgreSQL 连接池的 Prisma 7 客户端实例。
 *
 * @param connectionString PostgreSQL 连接串。
 * @param maxPool 连接池最大连接数（默认 `30`）。
 * @returns 包含 `prisma`、`pool` 与 `close()` 的句柄对象。
 */
export function createPrismaHandle(connectionString: string, maxPool = 30): PrismaHandle {
  const pool = new pg.Pool({
    connectionString,
    max: maxPool,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    pool,
    async close() {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}
