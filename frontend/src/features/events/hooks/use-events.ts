/**
 * 活动大厅、活动详情与发起预约 TanStack Query Hooks（含 3 秒轮询与角色隔离 queryKey）。
 */
import type { AdminEventTab } from '@queue-reservation/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import {
  createEventReservation,
  fetchAdminEvents,
  fetchEventDetail,
  fetchUserEvents,
} from '../api/events-api';

/**
 * 查询普通用户视角的活动大厅列表（每 3 秒自动刷新）。
 *
 * @param userId 当前用户 ID（纳入 queryKey 防跨角色缓存污染）
 * @param enabled 是否允许触发查询
 * @returns TanStack Query 查询结果（含 data 与 meta）
 */
export function useUserEventsQuery(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['events', 'USER', userId],
    enabled: enabled && Boolean(userId),
    refetchInterval: 3_000,
    queryFn: () => fetchUserEvents(userId),
  });
}

/**
 * 查询管理员视角的活动实时看板列表（每 3 秒自动刷新）。
 *
 * @param userId 当前管理员 ID（纳入 queryKey 防跨角色缓存污染）
 * @param enabled 是否允许触发查询
 * @returns TanStack Query 查询结果（含 data 与 meta）
 */
export function useAdminEventsQuery(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['events', 'ADMIN', userId],
    enabled: enabled && Boolean(userId),
    refetchInterval: 3_000,
    queryFn: () => fetchAdminEvents(userId),
  });
}

/**
 * 查询活动详情数据（每 3 秒自动刷新，自动按角色解析联合响应）。
 *
 * @param userId 当前用户 ID
 * @param eventId 活动 ID
 * @param tab 管理员视角名册过滤 Tab
 * @param enabled 是否允许触发查询
 * @returns TanStack Query 查询结果（含 data 与 meta）
 */
export function useEventDetailQuery(
  userId: string,
  eventId: string,
  tab: AdminEventTab,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['event-detail', userId, eventId, tab],
    enabled: enabled && Boolean(userId && eventId),
    refetchInterval: 3_000,
    queryFn: () => fetchEventDetail(userId, eventId, tab),
  });
}

/**
 * 发起活动预约 / 登记候补 Mutation Hook（带幂等重放提示与全量缓存刷新）。
 *
 * @param userId 当前用户 ID
 * @param eventId 目标活动 ID
 * @returns TanStack Query Mutation 对象
 */
export function useCreateReservationMutation(userId: string, eventId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createEventReservation(userId, eventId),
    onSuccess: (result) => {
      if (result.meta?.idempotentReplay) {
        toast.info('检测到重复提交，已幂等返回您之前的预约结果');
      } else if (result.data.status === 'WAITLISTED') {
        toast.success(
          `当前名额已满，已加入候补队列第 #${result.data.waitlistRank ?? '?'} 位`,
        );
      } else {
        toast.success('名额已为您暂留，请在倒计时结束前点击「确认预约」');
      }
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['my-reservations'] });
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      const msg = err instanceof ApiError ? err.message : '发起预约失败，请稍后重试';
      toast.error(msg);
    },
  });
}
