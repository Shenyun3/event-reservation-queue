/**
 * P1 并发压测实验室 API 封装（活动列表、清空活动预约、发起服务端并发压测）。
 */
import {
  AdminEventListResponseSchema,
  ClearEventReservationsResponseSchema,
  SimulateBurstInputSchema,
  SimulateBurstResponseSchema,
  type AdminEventListResponse,
  type ClearEventReservationsResponse,
  type SimulateBurstInput,
  type SimulateBurstResponse,
} from '@queue-reservation/shared';
import { apiRequest, type ApiRequestResult } from '@/lib/api-client';

/**
 * 以管理员视角拉取可用于并发压测的活动列表及实时统计。
 *
 * @param userId 当前管理员用户 ID
 * @returns 经过 AdminEventListResponseSchema 校验的活动列表与响应元信息
 */
export async function fetchStressEvents(
  userId: string,
): Promise<ApiRequestResult<AdminEventListResponse>> {
  return apiRequest('/api/events', {
    userId,
    schema: AdminEventListResponseSchema,
  });
}

/**
 * 清空指定活动的全部预约记录与审计日志，并归零活动占用计数（便于从 0 开始压测）。
 *
 * @param userId 当前管理员用户 ID
 * @param eventId 目标活动 ID
 * @returns 删除预约条数统计与响应元信息
 */
export async function clearEventReservations(
  userId: string,
  eventId: string,
): Promise<ApiRequestResult<ClearEventReservationsResponse>> {
  return apiRequest(`/api/events/${encodeURIComponent(eventId)}/reservations`, {
    method: 'DELETE',
    userId,
    schema: ClearEventReservationsResponseSchema,
  });
}

/**
 * 触发指定活动的服务端同毫秒并发抢购压测（Promise.all 调用真实预约 Service）。
 *
 * @param userId 当前管理员用户 ID
 * @param eventId 目标活动 ID
 * @param input 并发人数配置（1 ~ 25，发送前先按 SimulateBurstInputSchema 校验）
 * @returns 压测汇总战报、压测后真实统计与逐笔请求明细
 */
export async function simulateBurst(
  userId: string,
  eventId: string,
  input: SimulateBurstInput,
): Promise<ApiRequestResult<SimulateBurstResponse>> {
  const payload = SimulateBurstInputSchema.parse(input);
  return apiRequest(`/api/events/${encodeURIComponent(eventId)}/simulate-burst`, {
    method: 'POST',
    userId,
    body: payload,
    schema: SimulateBurstResponseSchema,
  });
}
