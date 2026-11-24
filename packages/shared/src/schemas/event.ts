/**
 * 活动与看板统计相关 Zod Schema（后端按角色裁剪 PublicEventDto vs AdminEventDto）。
 */
import { z } from 'zod';
import { AdminEventTabSchema, AvailabilityStatusSchema } from '../enums.ts';
import {
  ReservationDetailDtoSchema,
  ReservationWithUserDtoSchema,
} from './reservation.ts';

/** `POST /api/events` 创建活动请求体 Schema。 */
export const CreateEventInputSchema = z
  .object({
    name: z.string().trim().min(1, '活动名称不能为空').max(200),
    description: z.string().trim().max(2000).optional().default(''),
    startTime: z.string().datetime({ offset: true, message: '开始时间必须为合法 ISO 8601 时间' }),
    endTime: z.string().datetime({ offset: true, message: '结束时间必须为合法 ISO 8601 时间' }),
    capacity: z.coerce.number().int().positive('总名额上限必须大于 0').max(100_000),
    maxPerUser: z.coerce.number().int().positive('单人限购数必须大于 0').max(100).default(1),
    confirmTimeoutSec: z.coerce
      .number()
      .int()
      .min(10, '确认超时时间不能少于 10 秒')
      .max(86_400)
      .default(600),
  })
  .refine((data) => new Date(data.endTime).getTime() > new Date(data.startTime).getTime(), {
    message: '活动结束时间必须晚于开始时间',
    path: ['endTime'],
  });
export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;

/** 运营管理视角实时统计 Schema（oversold 必须按真实 Reservation 行数计算）。 */
export const EventStatsSchema = z.object({
  capacity: z.number().int().positive(),
  confirmedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  waitlistedCount: z.number().int().nonnegative(),
  occupiedCount: z.number().int().nonnegative(),
  remainingCapacity: z.number().int(),
  oversold: z.boolean(),
});
export type EventStats = z.infer<typeof EventStatsSchema>;

/** C 端公开活动 DTO（严禁包含 capacity / confirmedCount / pendingCount / waitlistedCount / confirmTimeoutSec）。 */
export const PublicEventDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  maxPerUser: z.number().int().positive(),
  availabilityStatus: AvailabilityStatusSchema,
  createdAt: z.string().datetime(),
});
export type PublicEventDto = z.infer<typeof PublicEventDtoSchema>;

/** 运营管理员活动 DTO（含完整配额规则与实时统计）。 */
export const AdminEventDtoSchema = PublicEventDtoSchema.extend({
  capacity: z.number().int().positive(),
  confirmTimeoutSec: z.number().int().min(10),
  createdById: z.string().nullable(),
  stats: EventStatsSchema,
});
export type AdminEventDto = z.infer<typeof AdminEventDtoSchema>;

/** C 端活动大厅单条活动项 DTO（携带本人活跃预约列表以支持 maxPerUser > 1）。 */
export const UserEventListItemSchema = PublicEventDtoSchema.extend({
  myActiveReservations: z.array(ReservationDetailDtoSchema),
});
export type UserEventListItem = z.infer<typeof UserEventListItemSchema>;

/** 管理台活动看板单条活动项 DTO。 */
export const AdminEventListItemSchema = AdminEventDtoSchema;
export type AdminEventListItem = z.infer<typeof AdminEventListItemSchema>;

/** `GET /api/events` C 端响应列表 Schema。 */
export const UserEventListResponseSchema = z.array(UserEventListItemSchema);
export type UserEventListResponse = z.infer<typeof UserEventListResponseSchema>;

/** `GET /api/events` 运营管理台响应列表 Schema。 */
export const AdminEventListResponseSchema = z.array(AdminEventListItemSchema);
export type AdminEventListResponse = z.infer<typeof AdminEventListResponseSchema>;

/** `GET /api/events/:eventId` 查询参数 Schema。 */
export const GetEventDetailQuerySchema = z.object({
  tab: AdminEventTabSchema.default('ALL'),
});
export type GetEventDetailQuery = z.infer<typeof GetEventDetailQuerySchema>;

/** C 端活动详情响应 DTO。 */
export const UserEventDetailResponseSchema = z.object({
  roleView: z.literal('USER'),
  event: PublicEventDtoSchema,
  myActiveReservations: z.array(ReservationDetailDtoSchema),
  myHistory: z.array(ReservationDetailDtoSchema),
});
export type UserEventDetailResponse = z.infer<typeof UserEventDetailResponseSchema>;

/** 运营管理台活动详情响应 DTO。 */
export const AdminEventDetailResponseSchema = z.object({
  roleView: z.literal('ADMIN'),
  event: AdminEventDtoSchema,
  reservations: z.array(ReservationWithUserDtoSchema),
});
export type AdminEventDetailResponse = z.infer<typeof AdminEventDetailResponseSchema>;

/** `GET /api/events/:eventId` 按角色区分的联合响应 DTO。 */
export const EventDetailResponseSchema = z.discriminatedUnion('roleView', [
  UserEventDetailResponseSchema,
  AdminEventDetailResponseSchema,
]);
export type EventDetailResponse = z.infer<typeof EventDetailResponseSchema>;
