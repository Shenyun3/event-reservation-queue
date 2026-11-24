/**
 * 全局顶部导航栏：角色差异化导航、模拟身份切换器、管理员超时巡检与重置演示数据操作。
 */
import {
  ExpireWorkerResponseSchema,
  HealthResponseSchema,
  ResetSeedResponseSchema,
} from '@queue-reservation/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Ticket,
  UserCircle2,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiRequest } from '@/lib/api-client';
import { useUser } from '@/lib/user-context';
import { cn, formatDateTime } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
}

const USER_NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: '活动大厅',
    match: (pathname) => pathname === '/' || pathname.startsWith('/events/'),
  },
  {
    to: '/my-reservations',
    label: '我的预约',
    match: (pathname) => pathname.startsWith('/my-reservations'),
  },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: '活动看板',
    match: (pathname) => pathname === '/' || pathname.startsWith('/events/'),
  },
  {
    to: '/admin',
    label: '运营管理台',
    match: (pathname) => pathname.startsWith('/admin'),
  },
  {
    to: '/stress-test',
    label: '20人并发压测',
    match: (pathname) => pathname.startsWith('/stress-test'),
  },
];

/**
 * 全局顶部导航栏组件，承载角色导航、模拟身份切换与管理员运维快捷操作。
 *
 * @returns 顶部导航栏 header 元素
 */
export function Topbar() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const {
    users,
    currentUserId,
    currentUser,
    isAdmin,
    isLoadingUsers,
    usersError,
    setCurrentUserId,
    refetchUsers,
  } = useUser();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['health', currentUserId],
    enabled: isAdmin,
    refetchInterval: 10_000,
    queryFn: async () => {
      const res = await apiRequest('/api/health', {
        skipAuth: true,
        schema: HealthResponseSchema,
      });
      return res.data;
    },
  });

  const expireMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('/api/admin/worker/expire', {
        method: 'POST',
        userId: currentUserId,
        schema: ExpireWorkerResponseSchema,
      });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(
        `超时巡检完成：回收 ${data.expiredCount} 单，候补转正 ${data.promotedCount} 单`,
      );
      void queryClient.invalidateQueries();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : '触发超时巡检失败';
      toast.error(msg);
    },
  });

  const resetSeedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('/api/admin/reset-seed', {
        method: 'POST',
        userId: currentUserId,
        schema: ResetSeedResponseSchema,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setResetDialogOpen(false);
      toast.success(
        `已恢复初始演示数据（${data.eventsCount} 场活动，${data.usersCount} 个常规账号）`,
      );
      void queryClient.invalidateQueries();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : '重置演示数据失败';
      toast.error(msg);
    },
  });

  const navItems = isAdmin ? ADMIN_NAV_ITEMS : USER_NAV_ITEMS;
  const standardUsers = users.filter((u) => u.role === 'USER');
  const adminUsers = users.filter((u) => u.role === 'ADMIN');

  const handleUserChange = (nextUserId: string) => {
    setCurrentUserId(nextUserId);
    const nextUser = users.find((u) => u.id === nextUserId);
    if (nextUser?.role === 'ADMIN') {
      toast.success('已切换至管理员账号（解锁库存看板与运营后台）');
    } else if (nextUser) {
      toast.success(`已切换至普通用户：${nextUser.name}`);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <Link
              to="/"
              className="flex items-center gap-2 font-semibold tracking-tight text-foreground"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                {isAdmin ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <Ticket className="h-4 w-4" />
                )}
              </span>
              <span className="text-base">活动预约平台</span>
              {isAdmin ? (
                <Badge variant="default" className="text-[11px]">
                  ADMIN
                </Badge>
              ) : null}
            </Link>

            <nav className="flex items-center gap-1" aria-label="主导航">
              {navItems.map((item) => {
                const isActive = item.match(location.pathname);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? (
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="hidden items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground lg:flex"
                  title="后台每 10 秒自动巡检过期锁单"
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>最近巡检：</span>
                  <span className="font-mono text-foreground">
                    {formatDateTime(healthQuery.data?.lastWorkerRunAt)}
                  </span>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => expireMutation.mutate()}
                  disabled={expireMutation.isPending}
                  title="立即触发一次后台超时锁单回收与候补转正"
                >
                  <Zap
                    className={cn(
                      'h-3.5 w-3.5',
                      expireMutation.isPending && 'animate-pulse',
                    )}
                  />
                  {expireMutation.isPending ? '巡检中...' : '立即触发超时巡检'}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResetDialogOpen(true)}
                  disabled={resetSeedMutation.isPending}
                  title="恢复数据库至初始演示数据"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置演示数据
                </Button>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <UserCircle2 className="h-3.5 w-3.5" />
                模拟身份
              </span>
              {isLoadingUsers ? (
                <Skeleton className="h-9 w-44" />
              ) : usersError ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void refetchUsers();
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试加载账号
                </Button>
              ) : (
                <Select
                  value={currentUser?.id ?? currentUserId}
                  onValueChange={handleUserChange}
                >
                  <SelectTrigger className="w-[210px]" aria-label="切换模拟身份">
                    <SelectValue placeholder="选择模拟账号" />
                  </SelectTrigger>
                  <SelectContent>
                    {standardUsers.length > 0 ? (
                      <SelectGroup>
                        <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                          普通用户（USER）
                        </div>
                        {standardUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name} · USER
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    {adminUsers.length > 0 ? (
                      <SelectGroup>
                        <div className="mt-1 border-t px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                          运营管理员（ADMIN）
                        </div>
                        {adminUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name} · ADMIN
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>
      </header>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认重置演示数据？</DialogTitle>
            <DialogDescription>
              此操作将清空当前所有活动、预约记录、审计日志以及压测虚拟用户，并重新写入初始演示 Seed 数据（2 场预置活动与 6 个常规账号）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(false)}
              disabled={resetSeedMutation.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => resetSeedMutation.mutate()}
              disabled={resetSeedMutation.isPending}
            >
              {resetSeedMutation.isPending ? '正在重置...' : '确认重置数据'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
