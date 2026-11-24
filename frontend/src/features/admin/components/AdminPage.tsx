/**
 * 运营管理台页面（/admin，对齐 demo/admin.html，ADMIN 专属守卫 + 创建活动 + 活动汇总表）。
 */
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Flame,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdminOnlyGuard } from '@/components/layout/AdminOnlyGuard';
import { EmptyStateCard, ErrorStateCard } from '@/components/layout/QueryStateViews';
import {
  AvailabilityStatusBadge,
  OversellStatusBadge,
} from '@/components/layout/StatusBadges';
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
import { useAdminEventsQuery } from '@/features/events/hooks/use-events';
import { ApiError } from '@/lib/api-client';
import { useUser } from '@/lib/user-context';
import { formatDateTime } from '@/lib/utils';
import { CreateEventForm } from './CreateEventForm';

/**
 * 运营管理台主页面组件：提供平台实时总览、新建活动表单与全部活动汇总表。
 *
 * @returns 运营管理台视图元素
 */
export function AdminPage() {
  const { currentUserId, currentUser, isAdmin, isLoadingUsers } = useUser();

  const eventsQuery = useAdminEventsQuery(
    currentUserId,
    Boolean(currentUser) && isAdmin,
  );

  if (isLoadingUsers) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return <AdminOnlyGuard pageTitle="运营管理台" />;
  }

  const events = eventsQuery.data?.data ?? [];
  const lastWorkerRunAt = eventsQuery.data?.meta?.lastWorkerRunAt;

  const totalCapacity = events.reduce((acc, ev) => acc + ev.stats.capacity, 0);
  const totalConfirmed = events.reduce((acc, ev) => acc + ev.stats.confirmedCount, 0);
  const totalPending = events.reduce((acc, ev) => acc + ev.stats.pendingCount, 0);
  const totalWaitlisted = events.reduce((acc, ev) => acc + ev.stats.waitlistedCount, 0);
  const hasOversold = events.some((ev) => ev.stats.oversold);

  const errorMessage =
    eventsQuery.error instanceof ApiError
      ? eventsQuery.error.message
      : eventsQuery.error instanceof Error
        ? eventsQuery.error.message
        : '无法加载运营活动汇总，请稍后重试';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">运营管理台（Admin）</h1>
          <p className="text-sm text-muted-foreground">
            创建限量活动、配置单人限购与锁单超时，并全局监控各活动实时看板与防超卖一致性。
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            返回活动看板
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">平台实时总览</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>
                上次超时巡检：
                <span className="font-mono text-foreground">
                  {formatDateTime(lastWorkerRunAt)}
                </span>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {eventsQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">活动总数 / 总名额</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">
                  {events.length}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}
                    / {totalCapacity}
                  </span>
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">全局已确认</div>
                <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
                  {totalConfirmed}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">全局待确认锁单</div>
                <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
                  {totalPending}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">全局候补单数</div>
                <div className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">
                  {totalWaitlisted}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">一致性校验</div>
                <div className="mt-2">
                  {hasOversold ? (
                    <Badge variant="destructive" className="gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      超卖告警
                    </Badge>
                  ) : (
                    <Badge variant="success" className="gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      强一致无超卖
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateEventForm userId={currentUserId} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">全部活动运营汇总表</CardTitle>
          <CardDescription>
            每 3 秒自动同步各活动占用进度、候补单数与防超卖检测结果。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {eventsQuery.isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : eventsQuery.isError ? (
            <ErrorStateCard
              title="活动汇总加载失败"
              message={errorMessage}
              onRetry={() => {
                void eventsQuery.refetch();
              }}
              isRetrying={eventsQuery.isFetching}
            />
          ) : events.length === 0 ? (
            <EmptyStateCard
              title="暂无活动"
              description="请在上方表单中创建第一场限时预约活动。"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>活动名称与时间</TableHead>
                  <TableHead>规则（容量 / 限购 / 超时）</TableHead>
                  <TableHead>已确认</TableHead>
                  <TableHead>待确认</TableHead>
                  <TableHead>剩余可用</TableHead>
                  <TableHead>候补单数</TableHead>
                  <TableHead>状态与校验</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {ev.id}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{ev.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(ev.startTime)} ~ {formatDateTime(ev.endTime)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      容量 {ev.capacity} / 限购 {ev.maxPerUser} / 超时{' '}
                      {ev.confirmTimeoutSec}s
                    </TableCell>
                    <TableCell className="font-semibold text-emerald-700 tabular-nums">
                      {ev.stats.confirmedCount}
                    </TableCell>
                    <TableCell className="font-semibold text-amber-700 tabular-nums">
                      {ev.stats.pendingCount}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {ev.stats.remainingCapacity}
                    </TableCell>
                    <TableCell className="font-semibold text-blue-700 tabular-nums">
                      {ev.stats.waitlistedCount}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <AvailabilityStatusBadge status={ev.availabilityStatus} />
                        <OversellStatusBadge
                          oversold={ev.stats.oversold}
                          occupiedCount={ev.stats.occupiedCount}
                          capacity={ev.stats.capacity}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/events/${encodeURIComponent(ev.id)}`}>
                            详情与名册
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        <Button size="sm" variant="secondary" asChild>
                          <Link
                            to={`/stress-test?eventId=${encodeURIComponent(ev.id)}`}
                          >
                            <Flame className="h-3.5 w-3.5" />
                            并发压测
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
