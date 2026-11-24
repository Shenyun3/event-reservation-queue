/**
 * 后端环境变量解析与强类型配置模块。
 */
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
dotenv.config();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),
  DATABASE_URL_TEST: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(6).max(90).default(30),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ENABLE_EXPIRATION_WORKER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/** 后端运行态配置类型。 */
export type BackendEnv = z.infer<typeof EnvSchema>;

/**
 * 解析并返回当前进程的环境配置。
 *
 * @param source 可选自定义环境变量对象（默认 `process.env`）。
 * @returns 校验通过的强类型配置对象。
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): BackendEnv {
  return EnvSchema.parse(source);
}
