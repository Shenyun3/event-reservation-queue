/**
 * 预约单查询与状态流转 API 封装（全部经过 @queue-reservation/shared Zod Schema 校验）。
 */
import {
  CancelReservationResponseSchema,
  MyReservationsResponseSchema,
  ReservationDetailDtoSchema,
  type CancelReservationResponse,
  type MyReservationStatusFilter,
  type MyReservationsResponse,
  type ReservationDetailDto,
} from '@queue-reservation/shared';
import { apiRequest, type ApiRequestResult } from '@/lib/api-client';

/**
 * 查询当前用户的「我的预约」列表。
 *
 * @param userId 当前模拟用户 ID
 * @param status 状态筛选值（ALL / PENDING_CONFIRM / CONFIRMED / WAITLISTED / CLOSED）
 * @returns 校验后的预约列表及响应元信息
 */
export async function fetchMyReservations(
  userId: string,
  status: MyReservationStatusFilter,
): Promise<ApiRequestResult<MyReservationsResponse>> {
  const params = new URLSearchParams({ status });
  return apiRequest(`/api/reservations/me?${params.toString()}`, {
    userId,
    schema: MyReservationsResponseSchema,
  });
}

/**
 * 确认指定待确认预约单（支持普通用户本人确认及管理员代确认）。
 *
 * @param userId 当前操作用户 ID
 * @param reservationId 预约单 ID
 * @returns 更新后的预约单详情
 */
export async function confirmReservation(
  userId: string,
  reservationId: string,
): Promise<ApiRequestResult<ReservationDetailDto>> {
  return apiRequest(
    `/api/reservations/${encodeURIComponent(reservationId)}/confirm`,
    {
      method: 'POST',
      userId,
      schema: ReservationDetailDtoSchema,
    },
  );
}

/**
 * 取消指定活跃预约单（服务端在事务内按条件自动触发 FIFO 候补转正）。
 *
 * @param userId 当前操作用户 ID
 * @param reservationId 预约单 ID
 * @returns 取消后的预约单及（仅管理员可见的）转正候补单信息
 */
export async function cancelReservation(
  userId: string,
  reservationId: string,
): Promise<ApiRequestResult<CancelReservationResponse>> {
  return apiRequest(
    `/api/reservations/${encodeURIComponent(reservationId)}/cancel`,
    {
      method: 'POST',
      userId,
      schema: CancelReservationResponseSchema,
    },
  );
}
