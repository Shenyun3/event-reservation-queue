/**
 * 「我的预约」页面（/my-reservations，对齐 demo/my-reservations.html，USER 专属）。
 */
import type { MyReservationStatusFilter } from '@queue-reservation/shared';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  History,
  LayoutDashboard,
  ShieldAlert,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AuditDrawer } from '@/components/layout/AuditDrawer';
import { CountdownBadge } from '@/components/layout/CountdownBadge';
import { EmptyStateCard, ErrorStateCard } from '@/components/layout/QueryStateViews';
import { ReservationStatusBadge } from '@/components/layout/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, getEstimatedServerNowMs } from '@/lib/api-client';
import { useUser } from '@/lib/user-context';
import { formatDateTime } from '@/lib/utils';
import {
  useCancelReservationMutation,
  useConfirmReservationMutation,
  useMyReservationsQuery,
} from '../hooks/use-reservations';

const STATUS_TABS: Array<{ value: MyReservationStatusFilter; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'PENDING_CONFIRM', label: '待确认' },
  { value: 'CONFIRMED', label: '预约成功' },
  { value: 'WAITLISTED', label: '候补中' },
  { value: 'CLOSED', label: '已取消 / 已过期' },
];

/**
 * 普通用户个人预约列表页，支持按状态筛选、行内确认/取消、倒计时与审计抽屉查看。
 *
 * @returns 我的预约页面元素
 */
export function MyReservationsPage() {
  const {
    users,
    currentUserId,
    currentUser,
    isAdmin,
    isLoadingUsers,
    setCurrentUserId,
  } = useUser();
  const [statusFilter, setStatusFilter] = useState<MyReservationStatusFilter>('ALL');
  const [auditTarget, setAuditTarget] = useState<{
    id: string;
    eventName: string;
  } | null>(null);

  const reservationsQuery = useMyReservationsQuery(
    currentUserId,
    statusFilter,
    Boolean(currentUser) && !isAdmin,
  );
  const confirmMutation = useConfirmReservationMutation(currentUserId, false);
  const cancelMutation = useCancelReservationMutation(currentUserId, false);

  const handleSwitchToUser = () => {
    const firstStandardUser = users.find((u) => u.role === 'USER');
    const targetId = firstStandardUser?.id ?? 'u1';
    setCurrentUserId(targetId);
    toast.success(`已切换至普通用户：${firstStandardUser?.name ?? 'Alice'}`);
  };

  if (isLoadingUsers) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">我的预约</h1>
            <p className="text-sm text-muted-foreground">
              当前账号为管理员身份，本页面面向 C 端普通用户展示个人预约进度。
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              返回活动看板
            </Link>
          </Button>
        </div>

        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle>当前为管理员账号（ADMIN）</CardTitle>
            </div>
            <CardDescription>
              管理员账号不作为普通 C 端用户发起预约。如需管理全部活动的预约名册与候补队列，请前往运营管理台或活动看板；如需体验普通用户个人预约页，可一键切换到普通用户视角。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/admin">
                <LayoutDashboard className="h-4 w-4" />
                前往运营管理台
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/">返回活动看板</Link>
            </Button>
            <Button variant="secondary" onClick={handleSwitchToUser}>
              <UserCheck className="h-4 w-4" />
              切换到 Alice 查看用户视角
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const errorMessage =
    reservationsQuery.error instanceof ApiError
      ? reservationsQuery.error.message
      : reservationsQuery.error instanceof Error
        ? reservationsQuery.error.message
        : '无法获取预约记录，请稍后重试';

  const reservations = reservationsQuery.data ?? [];
  const serverNowMs = getEstimatedServerNowMs();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的预约</h1>
          <p className="text-sm text-muted-foreground">
            当前账号：<strong className="text-foreground">{currentUser?.name ?? currentUserId}</strong>
            ，仅展示您的个人活动预约与实时候补进度（每 3 秒自动同步）。
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            去活动大厅看看
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <Tabs
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as MyReservationStatusFilter)
            }
          >
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent>
          {reservationsQuery.isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : reservationsQuery.isError ? (
            <ErrorStateCard
              title="加载我的预约失败"
              message={errorMessage}
              onRetry={() => {
                void reservationsQuery.refetch();
              }}
              isRetrying={reservationsQuery.isFetching}
            />
          ) : reservations.length === 0 ? (
            <EmptyStateCard
              title="暂无匹配的预约记录"
              description="当前筛选状态下没有预约单，您可以切换其他标签或前往活动大厅挑选感兴趣的活动。"
              action={
                <Button asChild size="sm">
                  <Link to="/">前往活动大厅</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>预约单号</TableHead>
                  <TableHead>活动信息</TableHead>
                  <TableHead>当前状态</TableHead>
                  <TableHead>提示 / 进度</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((item) => {
                  const eventStarted = serverNowMs >= Date.parse(item.event.startTime);
                  const isWaitlistMissed =
                    item.status === 'WAITLISTED' && eventStarted;
                  const canCancel =
                    item.status === 'CONFIRMED' ||
                    item.status === 'PENDING_CONFIRM' ||
                    item.status === 'WAITLISTED';
                  const isConfirmingThis =
                    confirmMutation.isPending &&
                    confirmMutation.variables === item.id;
                  const isCancellingThis =
                    cancelMutation.isPending &&
                    cancelMutation.variables === item.id;
                  const isMutatingThis = isConfirmingThis || isCancellingThis;

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {item.id}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <Link
                            to={`/events/${encodeURIComponent(item.eventId)}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {item.event.name}
                          </Link>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarClock className="h-3.5 w-3.5" />
                            <span>
                              {formatDateTime(item.event.startTime)} ~{' '}
                              {formatDateTime(item.event.endTime)}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ReservationStatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>
                        {item.status === 'PENDING_CONFIRM' ? (
                          <div className="flex flex-col items-start gap-1">
                            <CountdownBadge
                              expiresAt={item.expiresAt}
                              onExpired={() => {
                                void reservationsQuery.refetch();
                              }}
                            />
                            <span className="text-xs text-muted-foreground">
                              超时将自动释放名额
                            </span>
                          </div>
                        ) : item.status === 'WAITLISTED' ? (
                          isWaitlistMissed ? (
                            <Badge variant="muted">活动已开始，候补未转正</Badge>
                          ) : (
                            <span className="text-sm font-medium text-blue-700">
                              候补队列第 #{item.waitlistRank ?? '-'} 位
                            </span>
                          )
                        ) : item.status === 'CONFIRMED' ? (
                          <span className="text-xs text-emerald-700">
                            预约已生效，可凭单号入场
                          </span>
                        ) : item.status === 'EXPIRED' ? (
                          <span className="text-xs text-muted-foreground">
                            超过确认时限，已自动失效
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            已取消
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {item.status === 'PENDING_CONFIRM' ? (
                            <Button
                              size="sm"
                              disabled={isMutatingThis}
                              onClick={() => confirmMutation.mutate(item.id)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {isConfirmingThis ? '确认中...' : '确认预约'}
                            </Button>
                          ) : null}

                          {canCancel ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isMutatingThis || isWaitlistMissed}
                              title={
                                isWaitlistMissed
                                  ? '活动已开始，候补已无法转正'
                                  : undefined
                              }
                              onClick={() => cancelMutation.mutate(item.id)}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {isCancellingThis
                                ? '取消中...'
                                : item.status === 'WAITLISTED'
                                  ? '取消候补'
                                  : '取消预约'}
                            </Button>
                          ) : null}

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setAuditTarget({
                                id: item.id,
                                eventName: item.event.name,
                              })
                            }
                          >
                            <History className="h-3.5 w-3.5" />
                            查看进度
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AuditDrawer
        reservationId={auditTarget?.id ?? null}
        eventName={auditTarget?.eventName}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
}
