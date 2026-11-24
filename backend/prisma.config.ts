/**
 * Prisma 7 数据源与迁移配置（schema.prisma 严禁写 url = env(...)）。
 */
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// 优先加载仓库根目录 .env，同时支持容器环境变量直传
dotenv.config({ path: resolve(import.meta.dirname, '../.env') });
dotenv.config();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
