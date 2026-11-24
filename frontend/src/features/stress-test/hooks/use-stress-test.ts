/**
 * P1 并发压测实验室 TanStack Query Hooks（活动 3 秒轮询、清空预约与并发压测 Mutation）。
 */
import type {
  ClearEventReservationsResponse,
  SimulateBurstResponse,
} from '@queue-reservation/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import {
  clearEventReservations,
  fetchStressEvents,
  simulateBurst,
} from '../api/stress-api';

/** 发起并发压测 Mutation 参数。 */
export interface SimulateBurstVariables {
  /** 目标活动 ID。 */
  eventId: string;
  /** 并发请求人数（1 ~ 25）。 */
  concurrency: number;
}

/**
 * 查询压测实验室目标活动列表及实时统计（每 3 秒自动同步，queryKey 包含当前用户 ID）。
 *
 * @param userId 当前管理员用户 ID
 * @param enabled 是否允许触发查询（仅在确认管理员身份后启用）
 * @returns TanStack Query 活动列表查询结果
 */
export function useStressEventsQuery(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['events', 'ADMIN', 'stress-test', userId],
    enabled: enabled && Boolean(userId),
    refetchInterval: 3_000,
    queryFn: () => fetchStressEvents(userId),
  });
}

/**
 * 清空指定活动预约与审计记录的 Mutation Hook（成功后刷新关联缓存并弹出提示）。
 *
 * @param userId 当前管理员用户 ID
 * @returns TanStack Query Mutation 对象
 */
export function useClearEventReservationsMutation(userId: string) {
  const queryClient = useQueryClient();

  return useMutation<ClearEventReservationsResponse, Error, string>({
    mutationFn: async (eventId: string) => {
      const result = await clearEventReservations(userId, eventId);
      return result.data;
    },
    onSuccess: (data) => {
      toast.success(
        `已清空该活动 ${data.deletedReservationsCount} 条预约记录与审计日志，可从 0 开始压测`,
      );
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['my-reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError ? err.message : '清空活动预约失败，请稍后重试';
      toast.error(msg);
    },
  });
}

/**
 * 发起服务端同毫秒并发压测的 Mutation Hook（成功后汇报战报摘要并刷新活动看板缓存）。
 *
 * @param userId 当前管理员用户 ID
 * @returns TanStack Query Mutation 对象
 */
export function useSimulateBurstMutation(userId: string) {
  const queryClient = useQueryClient();

  return useMutation<SimulateBurstResponse, Error, SimulateBurstVariables>({
    mutationFn: async ({ eventId, concurrency }: SimulateBurstVariables) => {
      const result = await simulateBurst(userId, eventId, { concurrency });
      return result.data;
    },
    onSuccess: (data) => {
      const { pendingCount, waitlistedCount, failedCount, durationMs, oversold } =
        data.summary;
      const summaryText = `并发压测完成（耗时 ${durationMs}ms）：锁单待确认 ${pendingCount} ｜ 有序候补 ${waitlistedCount} ｜ 失败 ${failedCount}`;
      if (oversold) {
        toast.warning(`${summaryText}（警告：检测到超卖！）`);
      } else {
        toast.success(`${summaryText} · 零超卖`);
      }
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['my-reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      const msg =
        err instanceof ApiError ? err.message : '发起并发压测失败，请稍后重试';
      toast.error(msg);
    },
  });
}
