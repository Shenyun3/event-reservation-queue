/**
 * 通用异步四态辅助视图（错误重试卡片、空状态卡片），复用 shadcn/ui Card 与 Button 原语。
 */
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** 错误态卡片属性。 */
export interface ErrorStateCardProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

/**
 * 统一的异步加载失败状态卡片，支持点击重试。
 *
 * @param props 错误标题、详情消息与重试回调
 * @returns 错误提示卡片元素
 */
export function ErrorStateCard({
  title = '数据加载失败',
  message,
  onRetry,
  isRetrying = false,
}: ErrorStateCardProps) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={isRetrying}
            className="shrink-0"
          >
            <RefreshCw className={isRetrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {isRetrying ? '重试中...' : '重新加载'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** 空状态卡片属性。 */
export interface EmptyStateCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * 统一的空数据状态卡片。
 *
 * @param props 空状态标题、补充说明与可选操作区
 * @returns 空态卡片元素
 */
export function EmptyStateCard({ title, description, action }: EmptyStateCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description ? (
            <p className="max-w-md text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="mt-1">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
