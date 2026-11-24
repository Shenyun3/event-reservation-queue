/**
 * 健康检查与运营管理维护接口（手动巡检、重置演示数据）Zod Schema。
 */
import { z } from 'zod';

/** `GET /api/health` 响应体 Schema。 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.enum(['up', 'down']),
  workerEnabled: z.boolean(),
  lastWorkerRunAt: z.string().datetime().nullable(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** `POST /api/admin/worker/expire` 响应体 Schema。 */
export const ExpireWorkerResponseSchema = z.object({
  expiredCount: z.number().int().nonnegative(),
  promotedCount: z.number().int().nonnegative(),
  lastWorkerRunAt: z.string().datetime(),
});
export type ExpireWorkerResponse = z.infer<typeof ExpireWorkerResponseSchema>;

/** `POST /api/admin/reset-seed` 响应体 Schema。 */
export const ResetSeedResponseSchema = z.object({
  reset: z.literal(true),
  eventsCount: z.number().int().nonnegative(),
  usersCount: z.number().int().nonnegative(),
});
export type ResetSeedResponse = z.infer<typeof ResetSeedResponseSchema>;
