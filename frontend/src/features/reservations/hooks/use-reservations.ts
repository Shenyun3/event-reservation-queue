/**
 * 预约查询与写操作（确认 / 取消）TanStack Query Hooks。
 */
import type { MyReservationStatusFilter } from '@queue-reservation/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import {
  cancelReservation,
  confirmReservation,
  fetchMyReservations,
} from '../api/reservations-api';

/**
 * 查询当前用户的预约记录列表（含 3 秒短轮询自动同步）。
 *
 * @param userId 当前用户 ID（纳入 queryKey 防跨角色缓存污染）
 * @param status 列表状态筛选条件
 * @param enabled 是否允许触发查询
 * @returns TanStack Query 查询结果
 */
export function useMyReservationsQuery(
  userId: string,
  status: MyReservationStatusFilter,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['my-reservations', userId, status],
    enabled: enabled && Boolean(userId),
    refetchInterval: 3_000,
    queryFn: async () => {
      const result = await fetchMyReservations(userId, status);
      return result.data;
    },
  });
}

/**
 * 确认预约 Mutation Hook（支持本人确认与管理员代确认，成功后全量刷新并弹出提示）。
 *
 * @param userId 当前操作用户 ID
 * @param isAdmin 当前是否为管理员视角
 * @returns TanStack Query Mutation 对象
 */
export function useConfirmReservationMutation(userId: string, isAdmin: boolean) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reservationId: string) => {
      const result = await confirmReservation(userId, reservationId);
      return result.data;
    },
    onSuccess: (reservation) => {
      toast.success(
        isAdmin ? `已代确认预约 ${reservation.id}` : '预约已确认成功！',
      );
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['my-reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
    onError: (err) => {
      // 409 RESERVATION_EXPIRED 时后端已落库过期与转正，立即刷新页面数据
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['my-reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      const msg = err instanceof ApiError ? err.message : '确认预约失败，请稍后重试';
      toast.error(msg);
    },
  });
}

/**
 * 取消预约 Mutation Hook（管理员取消触发候补转正时在 Toast 中汇报转正用户信息）。
 *
 * @param userId 当前操作用户 ID
 * @param isAdmin 当前是否为管理员视角
 * @returns TanStack Query Mutation 对象
 */
export function useCancelReservationMutation(userId: string, isAdmin: boolean) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reservationId: string) => {
      const result = await cancelReservation(userId, reservationId);
      return result.data;
    },
    onSuccess: ({ reservation, promotedReservation }) => {
      if (isAdmin && promotedReservation) {
        toast.success(
          `已强制取消 ${reservation.id}；候补队首 ${promotedReservation.userName} (${promotedReservation.id}) 已自动转正！`,
        );
      } else if (isAdmin) {
        toast.success(`已强制取消预约 ${reservation.id}`);
      } else {
        toast.success('已取消该预约');
      }
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['my-reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['event-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['my-reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      const msg = err instanceof ApiError ? err.message : '取消预约失败，请稍后重试';
      toast.error(msg);
    },
  });
}
