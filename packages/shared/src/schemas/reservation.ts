/**
 * 预约单（Reservation）相关 Zod Schema 与 DTO 定义（严格区分 USER 与 ADMIN 视角）。
 */
import { z } from 'zod';
import {
  MyReservationStatusFilterSchema,
  ReservationStatusSchema,
} from '../enums.ts';

/** 预约单基础摘要 Schema（审计抽屉标题与列表共用）。 */
export const ReservationSummaryDtoSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  status: ReservationStatusSchema,
  expiresAt: z.string().datetime().nullable(),
  waitlistedAt: z.string().datetime().nullable(),
  waitlistRank: z.number().int().positive().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  expiredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReservationSummaryDto = z.infer<typeof ReservationSummaryDtoSchema>;

/** C 端与单笔操作返回的预约单详情 DTO（不包含他人信息）。 */
export const ReservationDetailDtoSchema = ReservationSummaryDtoSchema.extend({
  idempotencyKey: z.string(),
});
export type ReservationDetailDto = z.infer<typeof ReservationDetailDtoSchema>;

/** 管理台名册与 ADMIN 转正响应携带用户信息的预约单 DTO。 */
export const ReservationWithUserDtoSchema = ReservationDetailDtoSchema.extend({
  userName: z.string(),
  userEmail: z.string().email(),
});
export type ReservationWithUserDto = z.infer<typeof ReservationWithUserDtoSchema>;

/** 「我的预约」列表使用的活动摘要 Schema（仅含公开字段）。 */
export const ReservationEventSummaryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  maxPerUser: z.number().int().positive(),
});
export type ReservationEventSummaryDto = z.infer<typeof ReservationEventSummaryDtoSchema>;

/** 「我的预约」列表单条记录 DTO。 */
export const ReservationWithEventDtoSchema = ReservationDetailDtoSchema.extend({
  event: ReservationEventSummaryDtoSchema,
});
export type ReservationWithEventDto = z.infer<typeof ReservationWithEventDtoSchema>;

/** `GET /api/reservations/me` 查询参数 Schema。 */
export const ListMyReservationsQuerySchema = z.object({
  status: MyReservationStatusFilterSchema.default('ALL'),
});
export type ListMyReservationsQuery = z.infer<typeof ListMyReservationsQuerySchema>;

/** `GET /api/reservations/me` 响应体 Schema。 */
export const MyReservationsResponseSchema = z.array(ReservationWithEventDtoSchema);
export type MyReservationsResponse = z.infer<typeof MyReservationsResponseSchema>;

/**
 * `POST /api/reservations/:id/cancel` 响应体 Schema。
 * USER 视角下 `promotedReservation` 恒为 `null`；ADMIN 视角下返回完整转正 DTO 或 `null`。
 */
export const CancelReservationResponseSchema = z.object({
  reservation: ReservationDetailDtoSchema,
  promotedReservation: ReservationWithUserDtoSchema.nullable(),
});
export type CancelReservationResponse = z.infer<typeof CancelReservationResponseSchema>;
