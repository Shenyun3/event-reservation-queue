/**
 * 活动列表、详情与发起预约 API 封装（全部经过 @queue-reservation/shared Zod Schema 校验）。
 */
import {
  AdminEventListResponseSchema,
  EventDetailResponseSchema,
  ReservationDetailDtoSchema,
  UserEventListResponseSchema,
  type AdminEventListResponse,
  type AdminEventTab,
  type EventDetailResponse,
  type ReservationDetailDto,
  type UserEventListResponse,
} from '@queue-reservation/shared';
import {
  apiRequest,
  apiRequestWithIdempotency,
  type ApiRequestResult,
} from '@/lib/api-client';

/**
 * 以 C 端普通用户视角获取活动大厅列表（仅含公开字段与本人活跃预约）。
 *
 * @param userId 当前普通用户 ID
 * @returns 校验后的公开活动列表与响应元信息
 */
export async function fetchUserEvents(
  userId: string,
): Promise<ApiRequestResult<UserEventListResponse>> {
  return apiRequest('/api/events', {
    userId,
    schema: UserEventListResponseSchema,
  });
}

/**
 * 以运营管理员视角获取活动实时看板列表（含完整规则与防超卖统计）。
 *
 * @param userId 当前管理员用户 ID
 * @returns 校验后的管理台活动列表与响应元信息
 */
export async function fetchAdminEvents(
  userId: string,
): Promise<ApiRequestResult<AdminEventListResponse>> {
  return apiRequest('/api/events', {
    userId,
    schema: AdminEventListResponseSchema,
  });
}

/**
 * 获取单个活动详情（按当前身份自动返回 USER 视角或 ADMIN 视角联合响应）。
 *
 * @param userId 当前模拟用户 ID
 * @param eventId 活动 ID
 * @param tab 管理员视角名册过滤 Tab（普通用户视角下后端自动忽略）
 * @returns 按角色区分的活动详情响应
 */
export async function fetchEventDetail(
  userId: string,
  eventId: string,
  tab: AdminEventTab,
): Promise<ApiRequestResult<EventDetailResponse>> {
  const params = new URLSearchParams({ tab });
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}?${params.toString()}`,
    {
      userId,
      schema: EventDetailResponseSchema,
    },
  );
}

/**
 * 发起活动预约或登记候补（强制维护 Idempotency-Key 生命周期，防止双击重复下单）。
 *
 * @param userId 当前普通用户 ID
 * @param eventId 目标活动 ID
 * @returns 创建或幂等重放返回的预约单详情与元信息
 */
export async function createEventReservation(
  userId: string,
  eventId: string,
): Promise<ApiRequestResult<ReservationDetailDto>> {
  const intentKey = `reserve:${eventId}:${userId}`;
  return apiRequestWithIdempotency(
    intentKey,
    `/api/events/${encodeURIComponent(eventId)}/reservations`,
    {
      method: 'POST',
      userId,
      schema: ReservationDetailDtoSchema,
    },
  );
}
