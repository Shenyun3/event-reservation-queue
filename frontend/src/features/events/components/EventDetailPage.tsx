/**
 * 活动详情页（/events/:eventId，对齐 demo/event-detail.html，完整支持 maxPerUser > 1 与 Admin 名册管控）。
 */
import type {
  AdminEventDetailResponse,
  AdminEventTab,
  UserEventDetailResponse,
} from '@queue-reservation/shared';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Flame,
  History,
  PlusCircle,
  Ticket,
  Users,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AuditDrawer } from '@/components/layout/AuditDrawer';
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
import {
  useCancelReservationMutation,
  useConfirmReservationMutation,
} from '@/features/reservations/hooks/use-reservations';
import { ApiError, getEstimatedServerNowMs } from '@/lib/api-client';
import { useUser } from '@/lib/user-context';
import { formatDateTime } from '@/lib/utils';
import {
  useCreateReservationMutation,
  useEventDetailQuery,
} from '../hooks/use-events';

const ADMIN_TABS: Array<{ value: AdminEventTab; label: string }> = [
  { value: 'OCCUPIED', label: '占座中（已确认 + 待确认）' },
  { value: 'WAITLISTED', label: '候补队列（FIFO 顺位）' },
  { value: 'CLOSED', label: '已结束（已取消 + 已超时）' },
  { value: 'ALL', label: '全部记录' },
];

function UserEventDetailSection({
  detail,
  currentUserId,
  currentUserName,
  onRefresh,
  onOpenAudit,
}: {
  detail: UserEventDetailResponse;
  currentUserId: string;
  currentUserName: string;
  onRefresh: () => void;
  onOpenAudit: (target: { id: string; eventName: string }) => void;
}) {
  const { event, myActiveReservations, myHistory } = detail;
  const createMutation = useCreateReservationMutation(currentUserId, event.id);
  const confirmMutation = useConfirmReservationMutation(currentUserId, false);
  const cancelMutation = useCancelReservationMutation(currentUserId, false);

  const serverNowMs = getEstimatedServerNowMs();
  const eventStarted = serverNowMs >= Date.parse(event.startTime);
  const remainingQuota = Math.max(0, event.maxPerUser - myActiveReservations.length);
  const canCreateMore =
    remainingQuota > 0 && event.availabilityStatus !== 'CLOSED';

  const createButtonLabel =
    myActiveReservations.length > 0
      ? event.availabilityStatus === 'WAITLIST_ONLY'
        ? `继续登记候补（还可预约 ${remainingQuota} 席）`
        : `继续预约（还可预约 ${remainingQuota} 席）`
      : event.availabilityStatus === 'WAITLIST_ONLY'
        ? '加入候补排队'
        : '立即预约';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
            <AvailabilityStatusBadge status={event.availabilityStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            活动时间：{formatDateTime(event.startTime)} ~ {formatDateTime(event.endTime)}{' '}
            ｜ 每人限预约 {event.maxPerUser} 份
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/my-reservations">
            查看我的全部预约
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">活动介绍</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="leading-relaxed text-foreground">
            {event.description || '限时开放预约活动，预约成功后凭预约单号扫码入场。'}
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDateTime(event.startTime)} ~ {formatDateTime(event.endTime)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Ticket className="h-3.5 w-3.5" />
              单人限购上限：{event.maxPerUser} 份（已取消或已过期释放额度）
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                我的预约操作（{currentUserName}）
              </CardTitle>
              <CardDescription>
                当前活跃预约：{myActiveReservations.length} / {event.maxPerUser} 席
              </CardDescription>
            </div>
            {canCreateMore ? (
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                <PlusCircle className="h-4 w-4" />
                {createMutation.isPending ? '提交中...' : createButtonLabel}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {myActiveReservations.length > 0 ? (
            <div className="space-y-3">
              {myActiveReservations.map((res) => {
                const isWaitlistMissed =
                  res.status === 'WAITLISTED' && eventStarted;
                const isConfirmingThis =
                  confirmMutation.isPending && confirmMutation.variables === res.id;
                const isCancellingThis =
                  cancelMutation.isPending && cancelMutation.variables === res.id;
                const isMutatingThis = isConfirmingThis || isCancellingThis;

                return (
                  <div
                    key={res.id}
                    className="flex flex-col justify-between gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          单号：{res.id}
                        </span>
                        <ReservationStatusBadge status={res.status} />
                      </div>

                      {res.status === 'PENDING_CONFIRM' ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <CountdownBadge
                            expiresAt={res.expiresAt}
                            onExpired={onRefresh}
                          />
                          <span>名额已暂留，请在倒计时结束前点击确认，超时将自动释放。</span>
                        </div>
                      ) : res.status === 'WAITLISTED' ? (
                        isWaitlistMissed ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="muted">活动已开始，候补未转正</Badge>
                            <span className="text-xs text-muted-foreground">
                              活动已开始，停止候补转正。
                            </span>
                          </div>
                        ) : (
                          <p className="text-sm text-blue-700">
                            您当前排在候补队列 <strong>第 #{res.waitlistRank ?? '-'} 位</strong>
                            ，有名额释放时将按 FIFO 顺序自动为您转正。
                          </p>
                        )
                      ) : (
                        <p className="text-sm text-emerald-700">
                          您已成功锁定本场活动席位，届时请凭预约单号入场。
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {res.status === 'PENDING_CONFIRM' ? (
                        <Button
                          size="sm"
                          disabled={isMutatingThis}
                          onClick={() => confirmMutation.mutate(res.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {isConfirmingThis ? '确认中...' : '确认预约'}
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isMutatingThis || isWaitlistMissed}
                        title={
                          isWaitlistMissed
                            ? '活动已开始，候补已无法转正'
                            : undefined
                        }
                        onClick={() => cancelMutation.mutate(res.id)}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {isCancellingThis
                          ? '取消中...'
                          : res.status === 'WAITLISTED'
                            ? '取消候补'
                            : '取消预约'}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onOpenAudit({ id: res.id, eventName: event.name })
                        }
                      >
                        <History className="h-3.5 w-3.5" />
                        查看进度
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {event.availabilityStatus === 'CLOSED' ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              本活动已开始或已截止，当前已停止接受新的预约或候补登记。
            </div>
          ) : canCreateMore ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              {event.availabilityStatus === 'AVAILABLE'
                ? '点击预约后系统将在事务行锁内为您暂留名额，请于确认倒计时内完成确认（已内置幂等防双击保护）。'
                : '当前正式名额已满，登记候补后若有人取消或超时未确认，系统将按严格 FIFO 顺序自动为您转正。'}
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
              您在本活动的活跃预约已达单人限购上限（{event.maxPerUser}{' '}
              份）；如需重新预约，可先取消现有预约单。
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">我在本活动的历史记录</CardTitle>
          <CardDescription>
            展示您在本场活动中的已取消、已超时等历史预约记录，点击可查看完整审计时间线。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {myHistory.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              暂无历史预约记录
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>预约单号</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>说明</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myHistory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.id}</TableCell>
                    <TableCell>
                      <ReservationStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.status === 'EXPIRED'
                        ? '超过确认时限，已自动释放名额'
                        : item.status === 'CANCELLED'
                          ? '预约已取消'
                          : item.status === 'CONFIRMED'
                            ? '已确认'
                            : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatDateTime(item.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onOpenAudit({ id: item.id, eventName: event.name })
                        }
                      >
                        <History className="h-3.5 w-3.5" />
                        查看审计
                      </Button>
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

function AdminEventDetailSection({
  detail,
  currentUserId,
  activeTab,
  onTabChange,
  onRefresh,
  onOpenAudit,
}: {
  detail: AdminEventDetailResponse;
  currentUserId: string;
  activeTab: AdminEventTab;
  onTabChange: (tab: AdminEventTab) => void;
  onRefresh: () => void;
  onOpenAudit: (target: { id: string; eventName: string; userName: string }) => void;
}) {
  const { event, reservations } = detail;
  const { stats } = event;
  const confirmMutation = useConfirmReservationMutation(currentUserId, true);
  const cancelMutation = useCancelReservationMutation(currentUserId, true);

  const serverNowMs = getEstimatedServerNowMs();
  const eventStarted = serverNowMs >= Date.parse(event.startTime);

  const confirmedPct =
    stats.capacity > 0 ? Math.min(100, (stats.confirmedCount / stats.capacity) * 100) : 0;
  const pendingPct =
    stats.capacity > 0
      ? Math.min(100 - confirmedPct, (stats.pendingCount / stats.capacity) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
            <AvailabilityStatusBadge status={event.availabilityStatus} />
            <OversellStatusBadge
              oversold={stats.oversold}
              occupiedCount={stats.occupiedCount}
              capacity={stats.capacity}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            活动 ID：<span className="font-mono">{event.id}</span> ｜ 时间：
            {formatDateTime(event.startTime)} ~ {formatDateTime(event.endTime)} ｜ 容量：
            {event.capacity} ｜ 单人限购：{event.maxPerUser} ｜ 确认超时：
            {event.confirmTimeoutSec} 秒
          </p>
        </div>

        <Button variant="outline" asChild>
          <Link to={`/stress-test?eventId=${encodeURIComponent(event.id)}`}>
            <Flame className="h-4 w-4" />
            用此活动做 20 人并发压测
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">管理员实时名额监控</CardTitle>
            <span className="text-xs text-muted-foreground">
              每 3 秒自动同步 · 后台每 10 秒巡检过期锁单
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">总容量</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{stats.capacity}</div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">已确认</div>
              <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
                {stats.confirmedCount}
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">待确认锁单</div>
              <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
                {stats.pendingCount}
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">剩余可用</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">
                {stats.remainingCapacity}
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">候补单数</div>
              <div className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">
                {stats.waitlistedCount}
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">限购 / 超时</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {event.maxPerUser} 份 /
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {event.confirmTimeoutSec}s
              </div>
            </div>
          </div>

          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${confirmedPct}%` }}
            />
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${pendingPct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">全量预约名册与候补队列（FIFO）</CardTitle>
              <CardDescription>
                点击任意行的「审计日志」打开右侧完整状态流转时间线抽屉。
              </CardDescription>
            </div>
          </div>
          <div className="pt-2">
            <Tabs
              value={activeTab}
              onValueChange={(value) => onTabChange(value as AdminEventTab)}
            >
              <TabsList className="flex h-auto flex-wrap justify-start gap-1">
                {ADMIN_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent>
          {reservations.length === 0 ? (
            <EmptyStateCard
              title="当前分类下暂无预约记录"
              description="可切换其他名册分组查看，或前往 20 人并发压测页生成测试流量。"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单号</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>顺位 / 锁单倒计时</TableHead>
                  <TableHead>最近更新</TableHead>
                  <TableHead className="text-right">运维操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((item) => {
                  const canAct =
                    item.status === 'CONFIRMED' ||
                    item.status === 'PENDING_CONFIRM' ||
                    item.status === 'WAITLISTED';
                  const isConfirmingThis =
                    confirmMutation.isPending && confirmMutation.variables === item.id;
                  const isCancellingThis =
                    cancelMutation.isPending && cancelMutation.variables === item.id;
                  const isMutatingThis = isConfirmingThis || isCancellingThis;

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {item.id}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {item.userName}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {item.userId} · {item.userEmail}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ReservationStatusBadge status={item.status} adminMode />
                      </TableCell>
                      <TableCell>
                        {item.status === 'PENDING_CONFIRM' ? (
                          <CountdownBadge
                            expiresAt={item.expiresAt}
                            adminMode
                            onExpired={onRefresh}
                          />
                        ) : item.status === 'WAITLISTED' ? (
                          eventStarted ? (
                            <Badge variant="muted">活动已开始，候补未转正</Badge>
                          ) : (
                            <Badge variant="info" className="font-mono">
                              候补顺位 #{item.waitlistRank ?? '-'}
                            </Badge>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDateTime(item.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onOpenAudit({
                                id: item.id,
                                eventName: event.name,
                                userName: item.userName,
                              })
                            }
                          >
                            <History className="h-3.5 w-3.5" />
                            审计日志
                          </Button>
                          {item.status === 'PENDING_CONFIRM' ? (
                            <Button
                              size="sm"
                              disabled={isMutatingThis}
                              onClick={() => confirmMutation.mutate(item.id)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {isConfirmingThis ? '处理中...' : '代确认'}
                            </Button>
                          ) : null}
                          {canAct ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isMutatingThis}
                              onClick={() => cancelMutation.mutate(item.id)}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {isCancellingThis ? '取消中...' : '强制取消'}
                            </Button>
                          ) : null}
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
    </div>
  );
}

/**
 * 活动详情路由页面组件：按服务端 `roleView` 渲染普通用户预约操作视图或管理员实时名册监控视图。
 *
 * @returns 活动详情页面元素
 */
export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { currentUserId, currentUser, isLoadingUsers } = useUser();
  const [adminTab, setAdminTab] = useState<AdminEventTab>('OCCUPIED');
  const [auditTarget, setAuditTarget] = useState<{
    id: string;
    eventName: string;
    userName?: string;
  } | null>(null);

  const detailQuery = useEventDetailQuery(
    currentUserId,
    eventId ?? '',
    adminTab,
    Boolean(currentUser && eventId),
  );

  const errorMessage =
    detailQuery.error instanceof ApiError
      ? detailQuery.error.message
      : detailQuery.error instanceof Error
        ? detailQuery.error.message
        : '无法加载活动详情，请稍后重试';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          返回活动大厅
        </Link>
        <span>/</span>
        <span className="truncate">
          {detailQuery.data?.data.event.name ?? eventId ?? '活动详情'}
        </span>
      </div>

      {!eventId ? (
        <EmptyStateCard
          title="缺少活动 ID"
          description="请从活动大厅选择一场活动进入详情页。"
          action={
            <Button asChild size="sm">
              <Link to="/">返回活动大厅</Link>
            </Button>
          }
        />
      ) : isLoadingUsers || detailQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-14 w-96" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : detailQuery.isError ? (
        <ErrorStateCard
          title="活动详情加载失败"
          message={errorMessage}
          onRetry={() => {
            void detailQuery.refetch();
          }}
          isRetrying={detailQuery.isFetching}
        />
      ) : !detailQuery.data ? (
        <EmptyStateCard
          title="未找到该活动"
          description="该活动可能已下线或已被重置。"
          action={
            <Button asChild size="sm">
              <Link to="/">返回活动大厅</Link>
            </Button>
          }
        />
      ) : detailQuery.data.data.roleView === 'ADMIN' ? (
        <AdminEventDetailSection
          detail={detailQuery.data.data}
          currentUserId={currentUserId}
          activeTab={adminTab}
          onTabChange={setAdminTab}
          onRefresh={() => {
            void detailQuery.refetch();
          }}
          onOpenAudit={(target) => setAuditTarget(target)}
        />
      ) : (
        <UserEventDetailSection
          detail={detailQuery.data.data}
          currentUserId={currentUserId}
          currentUserName={currentUser?.name ?? currentUserId}
          onRefresh={() => {
            void detailQuery.refetch();
          }}
          onOpenAudit={(target) => setAuditTarget(target)}
        />
      )}

      <AuditDrawer
        reservationId={auditTarget?.id ?? null}
        eventName={auditTarget?.eventName}
        userName={auditTarget?.userName}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
}
