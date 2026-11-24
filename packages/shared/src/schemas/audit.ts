/**
 * 预约状态变更审计日志（AuditLog）相关 Zod Schema 与 DTO 定义。
 */
import { z } from 'zod';
import { AuditTriggerSchema, ReservationStatusSchema } from '../enums.ts';
import { ReservationSummaryDtoSchema } from './reservation.ts';

/** 单条审计日志 DTO Schema。 */
export const AuditLogDtoSchema = z.object({
  id: z.string(),
  reservationId: z.string(),
  eventId: z.string(),
  fromStatus: ReservationStatusSchema.nullable(),
  toStatus: ReservationStatusSchema,
  trigger: AuditTriggerSchema,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  note: z.string(),
  createdAt: z.string().datetime(),
});
export type AuditLogDto = z.infer<typeof AuditLogDtoSchema>;

/** `GET /api/reservations/:id/audit-logs` 响应体 Schema。 */
export const ReservationAuditLogsResponseSchema = z.object({
  reservation: ReservationSummaryDtoSchema,
  logs: z.array(AuditLogDtoSchema),
});
export type ReservationAuditLogsResponse = z.infer<typeof ReservationAuditLogsResponseSchema>;
