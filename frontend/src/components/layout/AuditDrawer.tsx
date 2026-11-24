/**
 * 预约单状态变更审计详情抽屉（基于 shadcn/ui Sheet，完整处理四态与时间线展示）。
 */
import { ReservationAuditLogsResponseSchema } from '@queue-reservation/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, History, User } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiRequest } from '@/lib/api-client';
import { useUser } from '@/lib/user-context';
import { formatDateTime } from '@/lib/utils';
import { CountdownBadge } from './CountdownBadge';
import { EmptyStateCard, ErrorStateCard } from './QueryStateViews';
import { AuditTriggerBadge, ReservationStatusBadge } from './StatusBadges';

/** 审计详情抽屉属性。 */
export interface AuditDrawerProps {
  /** 待查看的预约单 ID；为 null 时关闭抽屉。 */
  reservationId: string | null;
  /** 关闭抽屉回调。 */
  onClose: () => void;
  /** 可选活动名称（便于摘要卡片展示）。 */
  eventName?: string;
  /** 可选预约人姓名（管理员视角摘要展示）。 */
  userName?: string;
}

/**
 * 展示单笔预约摘要与完整不可变状态变更审计时间线的右侧抽屉组件。
 *
 * @param props 预约单 ID、关闭回调与可选上下文摘要
 * @returns Sheet 抽屉元素
 */
export function AuditDrawer({
  reservationId,
  onClose,
  eventName,
  userName,
}: AuditDrawerProps) {
  const { currentUserId, isAdmin } = useUser();

  const auditQuery = useQuery({
    queryKey: ['audit-logs', currentUserId, reservationId],
    enabled: Boolean(reservationId),
    queryFn: async () => {
      if (!reservationId) {
        throw new Error('缺少预约单 ID');
      }
      const res = await apiRequest(
        `/api/reservations/${encodeURIComponent(reservationId)}/audit-logs`,
        {
          userId: currentUserId,
          schema: ReservationAuditLogsResponseSchema,
        },
      );
      return res.data;
    },
  });

  const errorMessage =
    auditQuery.error instanceof ApiError
      ? auditQuery.error.message
      : auditQuery.error instanceof Error
        ? auditQuery.error.message
        : '无法获取审计日志，请稍后重试';

  return (
    <Sheet
      open={Boolean(reservationId)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full max-w-lg overflow-hidden p-0">
        <div className="border-b px-6 py-4">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <SheetTitle>
                {isAdmin ? '状态变更审计日志（Audit Log）' : '预约状态进度记录'}
              </SheetTitle>
            </div>
            <SheetDescription className="font-mono text-xs">
              预约单号：{reservationId ?? '-'}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {auditQuery.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : auditQuery.isError ? (
            <ErrorStateCard
              title="审计日志加载失败"
              message={errorMessage}
              onRetry={() => {
                void auditQuery.refetch();
              }}
              isRetrying={auditQuery.isFetching}
            />
          ) : auditQuery.data ? (
            <>
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">预约单摘要</span>
                  <ReservationStatusBadge
                    status={auditQuery.data.reservation.status}
                    adminMode={isAdmin}
                  />
                </div>
                <dl className="space-y-1.5 text-xs text-muted-foreground">
                  {eventName ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt>所属活动</dt>
                      <dd className="font-medium text-foreground">{eventName}</dd>
                    </div>
                  ) : null}
                  {isAdmin ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt>预约用户</dt>
                      <dd className="font-mono text-foreground">
                        {userName
                          ? `${userName} (${auditQuery.data.reservation.userId})`
                          : auditQuery.data.reservation.userId}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <dt>创建时间</dt>
                    <dd className="font-mono text-foreground">
                      {formatDateTime(auditQuery.data.reservation.createdAt)}
                    </dd>
                  </div>
                  {auditQuery.data.reservation.status === 'PENDING_CONFIRM' &&
                  auditQuery.data.reservation.expiresAt ? (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <dt>确认倒计时</dt>
                      <dd>
                        <CountdownBadge
                          expiresAt={auditQuery.data.reservation.expiresAt}
                          adminMode={isAdmin}
                          onExpired={() => {
                            void auditQuery.refetch();
                          }}
                        />
                      </dd>
                    </div>
                  ) : null}
                  {auditQuery.data.reservation.status === 'WAITLISTED' ? (
                    <div className="flex items-center justify-between gap-2">
                      <dt>当前候补顺位</dt>
                      <dd className="font-semibold text-blue-700">
                        {auditQuery.data.reservation.waitlistRank
                          ? `第 #${auditQuery.data.reservation.waitlistRank} 位`
                          : '-'}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              {auditQuery.data.logs.length === 0 ? (
                <EmptyStateCard
                  title="暂无审计记录"
                  description="该预约单目前尚未产生状态变更时间线。"
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>状态流转时间线（按时间正序）</span>
                    <span>共 {auditQuery.data.logs.length} 条</span>
                  </div>
                  <ol className="relative space-y-4 border-l-2 border-border pl-4">
                    {auditQuery.data.logs.map((log) => (
                      <li key={log.id} className="relative">
                        <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                        <div className="space-y-2 rounded-lg border bg-card p-3 shadow-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <AuditTriggerBadge trigger={log.trigger} />
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatDateTime(log.createdAt)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {log.fromStatus ? (
                              <>
                                <ReservationStatusBadge
                                  status={log.fromStatus}
                                  adminMode={isAdmin}
                                />
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                              </>
                            ) : (
                              <span className="text-muted-foreground">初始创建 →</span>
                            )}
                            <ReservationStatusBadge
                              status={log.toStatus}
                              adminMode={isAdmin}
                            />
                          </div>

                          <p className="text-sm text-foreground">{log.note}</p>

                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <User className="h-3.5 w-3.5" />
                            <span>
                              操作人：
                              {log.actorName
                                ? log.actorName
                                : log.actorId
                                  ? log.actorId
                                  : '系统自动执行'}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
