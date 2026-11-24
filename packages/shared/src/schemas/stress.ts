/**
 * P1 并发压测与清空活动预约接口 Zod Schema 与 DTO 定义。
 */
import { z } from 'zod';
import { EventStatsSchema } from './event.ts';
import { ReservationDetailDtoSchema } from './reservation.ts';

/** `DELETE /api/events/:eventId/reservations` 响应体 Schema。 */
export const ClearEventReservationsResponseSchema = z.object({
  deletedReservationsCount: z.number().int().nonnegative(),
});
export type ClearEventReservationsResponse = z.infer<typeof ClearEventReservationsResponseSchema>;

/** `POST /api/events/:eventId/simulate-burst` 请求体 Schema（服务端还会按 DB_POOL_MAX - 5 二次限流）。 */
export const SimulateBurstInputSchema = z.object({
  concurrency: z.coerce.number().int().min(1).max(25).default(20),
});
export type SimulateBurstInput = z.infer<typeof SimulateBurstInputSchema>;

/** 压测单笔请求结果明细 Schema。 */
export const BurstResultItemSchema = z.object({
  index: z.number().int().positive(),
  userId: z.string(),
  userName: z.string(),
  idempotencyKey: z.string(),
  ok: z.boolean(),
  reservation: ReservationDetailDtoSchema.optional(),
  waitlistRank: z.number().int().positive().nullable().optional(),
  error: z.string().optional(),
  latencyMs: z.number().nonnegative(),
});
export type BurstResultItem = z.infer<typeof BurstResultItemSchema>;

/** 压测汇总战报 Schema（oversold 基于真实 Reservation 行数计算）。 */
export const SimulateBurstSummarySchema = z.object({
  totalRequests: z.number().int().positive(),
  pendingCount: z.number().int().nonnegative(),
  waitlistedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  oversold: z.boolean(),
});
export type SimulateBurstSummary = z.infer<typeof SimulateBurstSummarySchema>;

/** `POST /api/events/:eventId/simulate-burst` 响应体 Schema。 */
export const SimulateBurstResponseSchema = z.object({
  eventStatsAfter: EventStatsSchema,
  summary: SimulateBurstSummarySchema,
  results: z.array(BurstResultItemSchema),
});
export type SimulateBurstResponse = z.infer<typeof SimulateBurstResponseSchema>;
