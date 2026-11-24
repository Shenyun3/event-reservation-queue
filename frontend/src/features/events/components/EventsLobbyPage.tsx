/**
 * 活动大厅 / 运营实时看板页（/，严格对齐 demo/index.html 与角色视野隔离）。
 */
import type { AdminEventListItem, UserEventListItem } from '@queue-reservation/shared';
import {
  ArrowRight,
  CalendarClock,
  Clock,
  Flame,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CountdownBadge } from '@/components/layout/CountdownBadge';
import { EmptyStateCard, ErrorStateCard } from '@/components/layout/QueryStateViews';
import {
  AvailabilityStatusBadge,
  OversellStatusBadge,
  ReservationStatusBadge,
} from '@/components/layout/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, getEstimatedServerNowMs } from '@/lib/api-client';
import { useUser } from '@/lib/user-context';
import { formatDateTime } from '@/lib/utils';
import { useAdminEventsQuery, useUserEventsQuery } from '../hooks/use-events';

function EventsGridSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function UserEventCard({
  event,
  onExpired,
}: {
  event: UserEventListItem;
  onExpired: () => void;
}) {
  const serverNowMs = getEstimatedServerNowMs();
  const eventStarted = serverNowMs >= Date.parse(event.startTime);

  const ctaLabel =
    event.myActiveReservations.length > 0
      ? event.myActiveReservations.length < event.maxPerUser &&
        event.availabilityStatus !== 'CLOSED'
        ? '查看预约 / 继续预约'
        : '查看我的预约详情'
      : event.availabilityStatus === 'AVAILABLE'
        ? '查看详情并预约'
        : event.availabilityStatus === 'WAITLIST_ONLY'
          ? '查看详情 / 加入候补'
          : '查看活动详情';

  return (
    <Card className="flex flex-col justify-between transition-shadow hover:shadow-sm">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-lg leading-snug">{event.name}</CardTitle>
          <AvailabilityStatusBadge
            status={event.availabilityStatus}
            className="shrink-0"
          />
        </div>
        <CardDescription className="line-clamp-2">
          {event.description || '限时开放预约活动，请查看详情了解预约规则。'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 shrink-0" />
            <span>
              {formatDateTime(event.startTime)} ~ {formatDateTime(event.endTime)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Ticket className="h-4 w-4 shrink-0" />
            <span>每人限预约 {event.maxPerUser} 份</span>
          </div>
        </div>

        {event.myActiveReservations.length > 0 ? (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>
                我的活跃预约（{event.myActiveReservations.length} / {event.maxPerUser}）
              </span>
            </div>
            <div className="space-y-2">
              {event.myActiveReservations.map((res) => (
                <div
                  key={res.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">{res.id}</span>
                    <ReservationStatusBadge status={res.status} />
                  </div>
                  <div>
                    {res.status === 'PENDING_CONFIRM' ? (
                      <CountdownBadge
                        expiresAt={res.expiresAt}
                        onExpired={onExpired}
                      />
                    ) : res.status === 'WAITLISTED' ? (
                      eventStarted ? (
                        <Badge variant="muted">活动已开始，候补未转正</Badge>
                      ) : (
                        <span className="font-medium text-blue-700">
                          候补第 #{res.waitlistRank ?? '-'} 位
                        </span>
                      )
                    ) : (
                      <span className="font-medium text-emerald-700">已锁定席位</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="border-t pt-4">
        <Button asChild className="w-full">
          <Link to={`/events/${encodeURIComponent(event.id)}`}>
            {ctaLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function AdminEventCard({ event }: { event: AdminEventListItem }) {
  const { stats } = event;
  const confirmedPct =
    stats.capacity > 0 ? Math.min(100, (stats.confirmedCount / stats.capacity) * 100) : 0;
  const pendingPct =
    stats.capacity > 0
      ? Math.min(100 - confirmedPct, (stats.pendingCount / stats.capacity) * 100)
      : 0;

  return (
    <Card className="flex flex-col justify-between transition-shadow hover:shadow-sm">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg leading-snug">{event.name}</CardTitle>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              ID: {event.id}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <AvailabilityStatusBadge status={event.availabilityStatus} />
            <OversellStatusBadge
              oversold={stats.oversold}
              occupiedCount={stats.occupiedCount}
              capacity={stats.capacity}
            />
          </div>
        </div>
        <CardDescription className="line-clamp-2">
          {event.description || '限时开放预约活动'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" />
            {formatDateTime(event.startTime)} ~ {formatDateTime(event.endTime)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            限购 {event.maxPerUser} 份
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            锁单超时 {event.confirmTimeoutSec}s
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border bg-muted/30 p-2.5">
            <div className="text-[11px] text-muted-foreground">已确认</div>
            <div className="mt-0.5 text-xl font-bold text-emerald-700 tabular-nums">
              {stats.confirmedCount}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2.5">
            <div className="text-[11px] text-muted-foreground">待确认锁单</div>
            <div className="mt-0.5 text-xl font-bold text-amber-700 tabular-nums">
              {stats.pendingCount}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2.5">
            <div className="text-[11px] text-muted-foreground">剩余可用</div>
            <div className="mt-0.5 text-xl font-bold text-foreground tabular-nums">
              {stats.remainingCapacity}
              <span className="text-xs font-normal text-muted-foreground">
                {' '}
                / {stats.capacity}
              </span>
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2.5">
            <div className="text-[11px] text-muted-foreground">候补单数</div>
            <div className="mt-0.5 text-xl font-bold text-blue-700 tabular-nums">
              {stats.waitlistedCount}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
            title="绿色=已确认，琥珀色=待确认锁单，灰色=剩余名额"
          >
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${confirmedPct}%` }}
            />
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${pendingPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              已占用 {stats.occupiedCount} / {stats.capacity}
            </span>
            <span>绿=已确认 · 黄=待确认锁单</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
        <Button asChild className="flex-1">
          <Link to={`/events/${encodeURIComponent(event.id)}`}>
            查看名册 / 管理
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to={`/stress-test?eventId=${encodeURIComponent(event.id)}`}>
            <Flame className="h-4 w-4" />
            前往并发压测
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * 活动大厅（USER）与实时看板（ADMIN）主页面组件。
 *
 * @returns 首页视图元素
 */
export function EventsLobbyPage() {
  const { currentUserId, currentUser, isAdmin, isLoadingUsers } = useUser();

  const userEventsQuery = useUserEventsQuery(
    currentUserId,
    Boolean(currentUser) && !isAdmin,
  );
  const adminEventsQuery = useAdminEventsQuery(
    currentUserId,
    Boolean(currentUser) && isAdmin,
  );

  if (isLoadingUsers) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-80" />
        <EventsGridSkeleton />
      </div>
    );
  }

  if (isAdmin) {
    const events = adminEventsQuery.data?.data ?? [];
    const lastWorkerRunAt = adminEventsQuery.data?.meta?.lastWorkerRunAt;
    const totalCapacity = events.reduce((acc, ev) => acc + ev.stats.capacity, 0);
    const totalConfirmed = events.reduce((acc, ev) => acc + ev.stats.confirmedCount, 0);
    const totalPending = events.reduce((acc, ev) => acc + ev.stats.pendingCount, 0);
    const totalWaitlisted = events.reduce((acc, ev) => acc + ev.stats.waitlistedCount, 0);
    const hasOversold = events.some((ev) => ev.stats.oversold);

    const errorMessage =
      adminEventsQuery.error instanceof ApiError
        ? adminEventsQuery.error.message
        : adminEventsQuery.error instanceof Error
          ? adminEventsQuery.error.message
          : '无法加载运营看板，请稍后重试';

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              活动看板（运营实时监控）
            </h1>
            <p className="text-sm text-muted-foreground">
              实时监控各活动容量、已确认、待确认锁单、候补单数与防超卖强一致状态（每 3 秒自动同步
              {lastWorkerRunAt ? ` · 最近巡检 ${formatDateTime(lastWorkerRunAt)}` : ''}）。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/stress-test">
                <Flame className="h-4 w-4" />
                20人并发压测
              </Link>
            </Button>
            <Button asChild>
              <Link to="/admin">
                <Plus className="h-4 w-4" />
                新建活动
              </Link>
            </Button>
          </div>
        </div>

        {adminEventsQuery.isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
            <EventsGridSkeleton />
          </div>
        ) : adminEventsQuery.isError ? (
          <ErrorStateCard
            title="活动看板加载失败"
            message={errorMessage}
            onRetry={() => {
              void adminEventsQuery.refetch();
            }}
            isRetrying={adminEventsQuery.isFetching}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">活动总数 / 总容量</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {events.length}
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}
                      / {totalCapacity} 席
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">全局已确认</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
                    {totalConfirmed}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">全局待确认锁单</div>
                  <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
                    {totalPending}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">全局候补单数</div>
                  <div className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">
                    {totalWaitlisted}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">防超卖一致性校验</div>
                  <div className="mt-2 flex items-center gap-1.5">
                    {hasOversold ? (
                      <Badge variant="destructive" className="gap-1">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        检测到超卖异常
                      </Badge>
                    ) : (
                      <Badge variant="success" className="gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        全量强一致无超卖
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {events.length === 0 ? (
              <EmptyStateCard
                title="暂无活动"
                description="当前系统尚未配置任何可监控活动，请前往运营管理台创建新活动或重置演示数据。"
                action={
                  <Button asChild size="sm">
                    <Link to="/admin">
                      <Plus className="h-4 w-4" />
                      前往创建活动
                    </Link>
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {events.map((ev) => (
                  <AdminEventCard key={ev.id} event={ev} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const userEvents = userEventsQuery.data?.data ?? [];
  const userErrorMessage =
    userEventsQuery.error instanceof ApiError
      ? userEventsQuery.error.message
      : userEventsQuery.error instanceof Error
        ? userEventsQuery.error.message
        : '无法加载活动大厅，请稍后重试';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">近期开放活动</h1>
          <p className="text-sm text-muted-foreground">
            选择您感兴趣的线下活动进行预约；若当前名额已满，可登记候补排队等待自动转正。
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/my-reservations">
            查看我的预约
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {userEventsQuery.isLoading ? (
        <EventsGridSkeleton />
      ) : userEventsQuery.isError ? (
        <ErrorStateCard
          title="活动大厅加载失败"
          message={userErrorMessage}
          onRetry={() => {
            void userEventsQuery.refetch();
          }}
          isRetrying={userEventsQuery.isFetching}
        />
      ) : userEvents.length === 0 ? (
        <EmptyStateCard
          title="暂无开放预约的活动"
          description="目前没有正在开放的活动，请稍后再来看看。"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {userEvents.map((ev) => (
            <UserEventCard
              key={ev.id}
              event={ev}
              onExpired={() => {
                void userEventsQuery.refetch();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
