/**
 * 运营管理台 API 封装（创建活动，响应经 @queue-reservation/shared Zod Schema 校验）。
 */
import {
  AdminEventDtoSchema,
  type AdminEventDto,
  type CreateEventInput,
} from '@queue-reservation/shared';
import { apiRequest, type ApiRequestResult } from '@/lib/api-client';

/**
 * 以管理员身份创建新活动。
 *
 * @param userId 当前管理员用户 ID
 * @param input 通过 CreateEventInputSchema 校验的活动创建载荷
 * @returns 新建活动完整 DTO 与元信息
 */
export async function createAdminEvent(
  userId: string,
  input: CreateEventInput,
): Promise<ApiRequestResult<AdminEventDto>> {
  return apiRequest('/api/events', {
    method: 'POST',
    userId,
    body: input,
    schema: AdminEventDtoSchema,
  });
}
