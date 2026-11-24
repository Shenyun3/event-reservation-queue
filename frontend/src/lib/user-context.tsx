/**
 * 当前模拟身份上下文（从 /api/users 加载常规账号并持久化当前 X-User-Id 至 localStorage）。
 */
import {
  UserListResponseSchema,
  type UserDto,
} from '@queue-reservation/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ACTIVE_USER_STORAGE_KEY,
  DEFAULT_USER_ID,
  apiRequest,
  getStoredUserId,
} from './api-client';

/** 身份上下文对外暴露值。 */
export interface UserContextValue {
  users: UserDto[];
  currentUserId: string;
  currentUser: UserDto | null;
  isAdmin: boolean;
  isLoadingUsers: boolean;
  usersError: Error | null;
  setCurrentUserId: (userId: string) => void;
  refetchUsers: () => Promise<unknown>;
}

const UserContext = createContext<UserContextValue | null>(null);

/**
 * 提供全应用模拟身份状态的 Provider 组件。
 *
 * @param props 包含子节点 `children`
 * @returns React 上下文提供者元素
 */
export function UserProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [currentUserId, setCurrentUserIdState] = useState<string>(() => getStoredUserId());

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const result = await apiRequest('/api/users', {
        skipAuth: true,
        schema: UserListResponseSchema,
      });
      return result.data;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const users = usersQuery.data ?? [];

  const saveStoredUserId = (id: string) => {
    try {
      window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, id);
    } catch {
      // 忽略受限存储模式下的写入失败
    }
  };

  useEffect(() => {
    if (users.length === 0) {
      return;
    }
    const exists = users.some((user) => user.id === currentUserId);
    if (!exists) {
      const fallback = users.find((user) => user.id === DEFAULT_USER_ID)?.id ?? users[0].id;
      saveStoredUserId(fallback);
      setCurrentUserIdState(fallback);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'users',
      });
    }
  }, [users, currentUserId, queryClient]);

  const setCurrentUserId = useCallback(
    (nextUserId: string) => {
      saveStoredUserId(nextUserId);
      setCurrentUserIdState(nextUserId);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'users',
      });
    },
    [queryClient],
  );

  const currentUser = useMemo(
    () => users.find((user) => user.id === currentUserId) ?? null,
    [users, currentUserId],
  );

  const value = useMemo<UserContextValue>(
    () => ({
      users,
      currentUserId,
      currentUser,
      isAdmin: currentUser?.role === 'ADMIN',
      isLoadingUsers: usersQuery.isLoading,
      usersError: usersQuery.error instanceof Error ? usersQuery.error : null,
      setCurrentUserId,
      refetchUsers: usersQuery.refetch,
    }),
    [
      users,
      currentUserId,
      currentUser,
      usersQuery.isLoading,
      usersQuery.error,
      setCurrentUserId,
      usersQuery.refetch,
    ],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

/**
 * 读取当前模拟身份上下文。
 *
 * @returns 当前用户与身份切换控制器
 * @throws {Error} 若未在 `UserProvider` 内部调用则抛出异常
 */
export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error('useUser 必须在 UserProvider 内部使用');
  }
  return ctx;
}
