/**
 * P1「20 人并发压测实验室」主页面（/stress-test，严格对齐 demo/stress-test.html）。
 * 提供管理员专属守卫、压测控制台、目标活动实时 KPI 看板、战报汇总明细与审计抽屉联动。
 */
import { SimulateBurstInputSchema } from '@queue-reservation/shared';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Flame,
  Loader2,
  Rocket,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminOnlyGuard } from '@/components/layout/AdminOnlyGuard';
import { AuditDrawer } from '@/components/layout/AuditDrawer';
import { EmptyStateCard, ErrorStateCard } from '@/components/layout/QueryStateViews';
import {
  AvailabilityStatusBadge,
  OversellStatusBadge,
} from '@/components/layout/StatusBadges';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { useUser } from '@/lib/user-context';
import { formatDateTime } from '@/lib/utils';
import {
  useClearEventReservationsMutation,
  useSimulateBurstMutation,
  useStressEventsQuery,
} from '../hooks/use-stress-test';
import {
  BurstReportCard,
  type BurstAuditTarget,
  type BurstReportRecord,
} from './BurstReportCard';

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 25;
const DEFAULT_CONCURRENCY = '20';

function parseConcurrencyInput(raw: string): {
  value: number | null;
  error: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, error: '请输入并发人数（1 ~ 25）' };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: '并发人数必须为正整数（1 ~ 25）' };
  }
  const parsed = SimulateBurstInputSchema.safeParse({ concurrency: Number(trimmed) });
  if (!parsed.success) {
    return {
      value: null,
      error: `并发人数需位于 ${MIN_CONCURRENCY} ~ ${MAX_CONCURRENCY} 之间（受 DB_POOL_MAX - 5 保护）`,
    };
  }
  return { value: parsed.data.concurrency, error: null };
}

/**
 * 20 人并发压测实验室页面组件（仅限运营管理员访问）。
 *
 * @returns 压测实验室完整页面视图或管理员权限守卫卡片
 */
export function StressTestPage() {
  const { currentUserId, currentUser, isAdmin, isLoadingUsers } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlEventId = searchParams.get('eventId') ?? '';
  const prevUrlEventIdRef = useRef<string>(urlEventId);

  const [selectedEventId, setSelectedEventId] = useState<string>(urlEventId);
  const [concurrencyInput, setConcurrencyInput] = useState<string>(DEFAULT_CONCURRENCY);
  const [clearDialogOpen, setClearDialogOpen] = useState<boolean>(false);
  const [lastReport, setLastReport] = useState<BurstReportRecord | null>(null);
  const [auditTarget, setAuditTarget] = useState<BurstAuditTarget | null>(null);

  const eventsQuery = useStressEventsQuery(
    currentUserId,
    Boolean(currentUser) && isAdmin,
  );
  const clearMutation = useClearEventReservationsMutation(currentUserId);
  const burstMutation = useSimulateBurstMutation(currentUserId);

  // 外部路由通过 ?eventId=... 切换目标活动时同步选中状态并清理旧战报
  useEffect(() => {
    if (urlEventId && urlEventId !== prevUrlEventIdRef.current) {
      setSelectedEventId(urlEventId);
      setLastReport(null);
      setAuditTarget(null);
    }
    prevUrlEventIdRef.current = urlEventId;
  }, [urlEventId]);

  if (isLoadingUsers) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return <AdminOnlyGuard pageTitle="20 人并发压测实验室" />;
  }

  const events = eventsQuery.data?.data ?? [];
  const lastWorkerRunAt = eventsQuery.data?.meta?.lastWorkerRunAt;

  const selectedEvent =
    events.find((ev) => ev.id === selectedEventId) ?? events[0] ?? null;
  const effectiveEventId = selectedEvent?.id ?? '';

  const { value: parsedConcurrency, error: concurrencyError } =
    parseConcurrencyInput(concurrencyInput);
  const isBusy = clearMutation.isPending || burstMutation.isPending;

  const visibleReport =
    lastReport && lastReport.eventId === effectiveEventId ? lastReport : null;

  const handleSelectEvent = (nextEventId: string) => {
    prevUrlEventIdRef.current = nextEventId;
    setSelectedEventId(nextEventId);
    setLastReport(null);
    setAuditTarget(null);
    setSearchParams({ eventId: nextEventId }, { replace: true });
  };

  const handleConfirmClear = () => {
    if (!selectedEvent || clearMutation.isPending) {
      return;
    }
    clearMutation.mutate(selectedEvent.id, {
      onSuccess: () => {
        setClearDialogOpen(false);
        setLastReport(null);
        setAuditTarget(null);
      },
    });
  };

  const handleRunBurst = () => {
    if (!selectedEvent || parsedConcurrency === null || isBusy) {
      return;
    }
    const targetId = selectedEvent.id;
    const targetName = selectedEvent.name;
    burstMutation.mutate(
      { eventId: targetId, concurrency: parsedConcurrency },
      {
        onSuccess: (response) => {
          setLastReport({
            eventId: targetId,
            eventName: targetName,
            executedAt: new Date().toISOString(),
            response,
          });
        },
      },
    );
  };

  const errorMessage =
    eventsQuery.error instanceof ApiError
      ? eventsQuery.error.message
      : eventsQuery.error instanceof Error
        ? eventsQuery.error.message
        : '无法加载活动列表，请稍后重试';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Flame className="h-6 w-6 text-amber-600" />
            <h1 className="text-2xl font-bold tracking-tight">
              20 人并发压测实验室（管理员工具）
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            在服务端以 Promise.all 同毫秒并发调用真实预约 Service，直观验证 PostgreSQL 行锁防超卖、有序候补顺位分配与不可变审计日志。
          </p>
        </div>
        {selectedEvent ? (
          <Button variant="outline" asChild>
            <Link to={`/events/${encodeURIComponent(selectedEvent.id)}`}>
              前往该活动详情页查看队列
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : null}
      </div>

      {eventsQuery.isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : eventsQuery.isError ? (
        <ErrorStateCard
          title="活动列表加载失败"
          message={errorMessage}
          onRetry={() => {
            void eventsQuery.refetch();
          }}
          isRetrying={eventsQuery.isFetching}
        />
      ) : !selectedEvent ? (
        <EmptyStateCard
          title="暂无可压测的活动"
          description="当前平台还没有任何活动，请先前往运营管理台创建活动后再来发起并发压测。"
          action={
            <Button asChild>
              <Link to="/admin">前往运营管理台创建活动</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">压测控制台</CardTitle>
                  <CardDescription>
                    选择目标活动与并发路数；推荐先清空活动预约，再一键触发同毫秒并发抢购。
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    最近超时巡检：
                    <span className="font-mono text-foreground">
                      {formatDateTime(lastWorkerRunAt)}
                    </span>
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
                <div className="space-y-2 lg:col-span-5">
                  <Label htmlFor="stress-event-select">目标活动</Label>
                  <Select
                    value={effectiveEventId}
                    onValueChange={handleSelectEvent}
                    disabled={isBusy}
                  >
                    <SelectTrigger
                      id="stress-event-select"
                      aria-label="选择压测目标活动"
                    >
                      <SelectValue placeholder="请选择目标活动" />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((ev) => (
                        <SelectItem key={ev.id} value={ev.id}>
                          {ev.name}（容量 {ev.capacity} · 剩余{' '}
                          {ev.stats.remainingCapacity}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    活动 ID：<span className="font-mono">{selectedEvent.id}</span> ·
                    单人限购 {selectedEvent.maxPerUser} · 锁单超时{' '}
                    {selectedEvent.confirmTimeoutSec}s
                  </p>
                </div>

                <div className="space-y-2 lg:col-span-3">
                  <Label htmlFor="stress-concurrency-input">
                    并发人数（1 ~ 25）
                  </Label>
                  <Input
                    id="stress-concurrency-input"
                    type="number"
                    min={MIN_CONCURRENCY}
                    max={MAX_CONCURRENCY}
                    step={1}
                    value={concurrencyInput}
                    onChange={(e) => setConcurrencyInput(e.target.value)}
                    disabled={isBusy}
                    aria-invalid={Boolean(concurrencyError)}
                  />
                  {concurrencyError ? (
                    <p className="text-xs font-medium text-destructive">
                      {concurrencyError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      受服务端 <span className="font-mono">DB_POOL_MAX - 5</span>{' '}
                      连接池上限保护，确保压测期间读请求与巡检 Worker 不被饿死。
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:col-span-4 lg:justify-end lg:pt-6">
                  <Button
                    variant="outline"
                    onClick={() => setClearDialogOpen(true)}
                    disabled={isBusy}
                  >
                    <Trash2 className="h-4 w-4" />
                    {clearMutation.isPending ? '清空中...' : '清空该活动预约'}
                  </Button>

                  <Button
                    onClick={handleRunBurst}
                    disabled={isBusy || parsedConcurrency === null}
                  >
                    {burstMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Rocket className="h-4 w-4" />
                    )}
                    {burstMutation.isPending
                      ? '并发压测中...'
                      : '发起并发抢购（Promise.all）'}
                  </Button>
                </div>
              </div>

              {selectedEvent.availabilityStatus === 'CLOSED' ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    该活动已到达或超过开始时间（状态为已截止），发起并发抢购将按业务规则返回{' '}
                    <span className="font-mono">EVENT_ENDED</span> 失败记录。
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">
                      目标活动实时名额状态
                    </CardTitle>
                    <AvailabilityStatusBadge
                      status={selectedEvent.availabilityStatus}
                    />
                  </div>
                  <CardDescription>
                    {selectedEvent.name} · 每 3 秒自动轮询服务端最新统计（基于真实预约行数校验防超卖）
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <OversellStatusBadge
                    oversold={selectedEvent.stats.oversold}
                    occupiedCount={selectedEvent.stats.occupiedCount}
                    capacity={selectedEvent.stats.capacity}
                  />
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      to={`/events/${encodeURIComponent(selectedEvent.id)}`}
                    >
                      查看活动详情
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">活动容量</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {selectedEvent.stats.capacity}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">已确认</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
                    {selectedEvent.stats.confirmedCount}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">待确认锁单</div>
                  <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
                    {selectedEvent.stats.pendingCount}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">候补单数</div>
                  <div className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">
                    {selectedEvent.stats.waitlistedCount}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">剩余可用名额</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {selectedEvent.stats.remainingCapacity}
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}
                      / {selectedEvent.stats.capacity}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <BurstReportCard
            report={visibleReport}
            isRunning={burstMutation.isPending}
            runningConcurrency={parsedConcurrency ?? 20}
            onOpenAudit={setAuditTarget}
          />
        </>
      )}

      <Dialog
        open={clearDialogOpen}
        onOpenChange={(open) => {
          if (!clearMutation.isPending) {
            setClearDialogOpen(open);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认清空该活动全部预约？</DialogTitle>
            <DialogDescription>
              即将清空活动「{selectedEvent?.name ?? '-'}」下的全部预约记录与对应审计日志，并将已确认与待确认计数归零。清空后上次压测战报也会同步重置，便于从 0 开始重新压测。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearDialogOpen(false)}
              disabled={clearMutation.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmClear}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending ? '正在清空...' : '确认清空预约'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuditDrawer
        reservationId={auditTarget?.reservationId ?? null}
        userName={auditTarget?.userName}
        eventName={auditTarget?.eventName}
        onClose={() => setAuditTarget(null)}
      />
    </div>
  );
}
