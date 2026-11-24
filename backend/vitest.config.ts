/**
 * Vitest 配置：真实 PostgreSQL 集成测试串行执行，避免用例间数据污染。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ['tests/**/*.test.ts'],
  },
});
