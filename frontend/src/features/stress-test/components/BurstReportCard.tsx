/**
 * 并发压测战报汇总与逐笔明细表卡片组件（支持未执行空态引导、执行中加载态与逐笔审计抽屉联动）。
 */
import type { SimulateBurstResponse } from '@queue-reservation/shared';
import {
  Flame,
  History,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
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
import { formatDateTime } from '@/lib/utils';

/** 压测战报前端展示状态结构。 */
export interface BurstReportRecord {
  /** 压测对应的活动 ID。 */
  eventId: string;
  /** 压测对应的活动名称。 */
  eventName: string;
  /** 本次压测发起时间（ISO 字符串）。 */
  executedAt: string;
  /** 服务端返回的完整压测战报响应。 */
  response: SimulateBurstResponse;
}

/** 打开审计抽屉时的上下文目标。 */
export interface BurstAuditTarget {
  /** 目标预约单 ID。 */
  reservationId: string;
  /** 预约对应的模拟用户名称。 */
  userName: string;
  /** 所属活动名称。 */
  eventName: string;
}

/** 压测战报卡片属性。 */
export interface BurstReportCardProps {
  /** 当前活动的最近一次压测战报；未执行时为 null。 */
  report: BurstReportRecord | null;
  /** 当前是否正在执行并发压测请求。 */
  isRunning: boolean;
  /** 本次压测准备发送的并发路数（用于执行中提示文案）。 */
  runningConcurrency: number;
  /** 点击逐笔记录「查看审计」时的回调。 */
  onOpenAudit: (target: BurstAuditTarget) => void;
}

/**
 * 渲染压测战报汇总 KPI（含真实行数防超卖检验结果）与逐笔请求明细表。
 *
 * @param props 压测战报数据、执行中状态与审计抽屉回调
 * @returns 压测战报卡片元素
 */
export function BurstReportCard({
  report,
  isRunning,
  runningConcurrency,
  onOpenAudit,
}: BurstReportCardProps) {
  if (isRunning) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <CardTitle className="text-base">
              正在执行 {runningConcurrency} 路同毫秒并发抢购...
            </CardTitle>
          </div>
          <CardDescription>
            服务端正在通过 Promise.all 并发调用真实预约 Service，由 PostgreSQL 行锁串行仲裁名额与候补顺位。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">本次压测战报汇总与逐笔明细</CardTitle>
          <CardDescription>
            执行并发压测后，此处将展示汇总战报、真实行数防超卖检验结果与每一笔模拟请求的追踪明细。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 px-6 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Flame className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                尚未执行并发压测
              </p>
              <p className="max-w-lg text-sm text-muted-foreground">
                建议先点击「清空该活动预约」，再以 20 路并发发起压测，观察 5 席锁单 + 15 席有序候补 + 零超卖。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { summary, eventStatsAfter, results } = report.response;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              本次压测战报汇总与逐笔明细
            </CardTitle>
            <CardDescription>
              目标活动：{report.eventName} · 执行时间：
              <span className="font-mono">{formatDateTime(report.executedAt)}</span>
            </CardDescription>
          </div>
          <OversellStatusBadge
            oversold={summary.oversold}
            occupiedCount={eventStatsAfter.occupiedCount}
            capacity={eventStatsAfter.capacity}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">总请求数</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {summary.totalRequests}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">锁定待确认</div>
            <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
              {summary.pendingCount}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">有序候补</div>
            <div className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">
              {summary.waitlistedCount}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">失败数</div>
            <div
              className={
                summary.failedCount > 0
                  ? 'mt-1 text-2xl font-bold text-destructive tabular-nums'
                  : 'mt-1 text-2xl font-bold text-muted-foreground tabular-nums'
              }
            >
              {summary.failedCount}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">总耗时</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {summary.durationMs}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ms
              </span>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">真实行数防超卖校验</div>
            <div className="mt-2">
              {summary.oversold ? (
                <Badge variant="destructive" className="gap-1">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  检测到超卖
                </Badge>
              ) : (
                <Badge variant="success" className="gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  零超卖 · 通过
                </Badge>
              )}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              占用 {eventStatsAfter.occupiedCount} / 容量 {eventStatsAfter.capacity}
            </div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">序号</TableHead>
              <TableHead>模拟用户</TableHead>
              <TableHead>幂等键（Idempotency-Key）</TableHead>
              <TableHead>结果状态</TableHead>
              <TableHead className="w-24">候补顺位</TableHead>
              <TableHead className="w-28">单笔耗时</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((item) => {
              const rank =
                item.waitlistRank ?? item.reservation?.waitlistRank ?? null;
              const reservationId = item.reservation?.id;

              return (
                <TableRow key={`${item.index}-${item.idempotencyKey}`}>
                  <TableCell className="font-mono text-xs font-medium text-muted-foreground">
                    #{item.index}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {item.userName}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.userId}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-[200px] truncate font-mono text-xs text-muted-foreground"
                      title={item.idempotencyKey}
                    >
                      {item.idempotencyKey}
                    </span>
                  </TableCell>
                  <TableCell>
                    {item.ok && item.reservation ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <ReservationStatusBadge
                          status={item.reservation.status}
                          adminMode
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          {item.reservation.id}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="destructive">请求失败</Badge>
                        <span className="text-xs text-destructive">
                          {item.error ?? '未知错误'}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {rank ? (
                      <Badge variant="info" className="font-mono">
                        #{rank}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {item.latencyMs} ms
                  </TableCell>
                  <TableCell className="text-right">
                    {reservationId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onOpenAudit({
                            reservationId,
                            userName: item.userName,
                            eventName: report.eventName,
                          })
                        }
                      >
                        <History className="h-3.5 w-3.5" />
                        查看审计
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
