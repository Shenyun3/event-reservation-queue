/**
 * 运营管理台写操作 TanStack Query Hooks。
 */
import type { CreateEventInput } from '@queue-reservation/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { createAdminEvent } from '../api/admin-api';

/**
 * 创建新活动 Mutation Hook（提交成功后刷新活动看板与管理台列表）。
 *
 * @param userId 当前管理员用户 ID
 * @returns TanStack Query Mutation 对象
 */
export function useCreateEventMutation(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateEventInput) => {
      const result = await createAdminEvent(userId, input);
      return result.data;
    },
    onSuccess: (created) => {
      toast.success(`活动「${created.name}」已创建并发布（${created.id}）`);
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : '创建活动失败，请检查表单项';
      toast.error(msg);
    },
  });
}
