/**
 * 待确认锁单倒计时徽标：基于服务端时钟偏移每秒本地递减 MM:SS，归零时触发单次刷新回调。
 */
import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { getEstimatedServerNowMs } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/** 倒计时组件属性。 */
export interface CountdownBadgeProps {
  /** 锁单过期 ISO 时间字符串。 */
  expiresAt: string | null | undefined;
  /** 是否为管理员视角文案。 */
  adminMode?: boolean;
  /** 倒计时归零时触发的单次回调（用于主动刷新后端状态）。 */
  onExpired?: () => void;
  /** 可选自定义样式类名。 */
  className?: string;
}

function computeRemainingSeconds(expiresAt: string | null | undefined): number {
  if (!expiresAt) {
    return 0;
  }
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) {
    return 0;
  }
  const diffMs = expiresMs - getEstimatedServerNowMs();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / 1000);
}

function formatMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 展示待确认预约的实时剩余确认时间（MM:SS），低于 60 秒高亮警示。
 *
 * @param props 过期时间、展示模式与归零刷新回调
 * @returns 倒计时徽标元素
 */
export function CountdownBadge({
  expiresAt,
  adminMode = false,
  onExpired,
  className,
}: CountdownBadgeProps) {
  const [remainingSec, setRemainingSec] = useState<number>(() =>
    computeRemainingSeconds(expiresAt),
  );
  const firedForExpiresAtRef = useRef<string | null>(null);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    const initial = computeRemainingSeconds(expiresAt);
    setRemainingSec(initial);

    if (!expiresAt) {
      return;
    }

    if (initial === 0) {
      if (firedForExpiresAtRef.current !== expiresAt) {
        firedForExpiresAtRef.current = expiresAt;
        onExpiredRef.current?.();
      }
      return;
    }

    const timer = window.setInterval(() => {
      const next = computeRemainingSeconds(expiresAt);
      setRemainingSec(next);
      if (next === 0) {
        window.clearInterval(timer);
        if (firedForExpiresAtRef.current !== expiresAt) {
          firedForExpiresAtRef.current = expiresAt;
          onExpiredRef.current?.();
        }
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [expiresAt]);

  if (!expiresAt) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  if (remainingSec <= 0) {
    return (
      <Badge variant="destructive" className={cn('gap-1 font-mono', className)}>
        <Clock className="h-3 w-3" />
        {adminMode ? '已到期（待巡检回收）' : '已过期（待刷新）'}
      </Badge>
    );
  }

  const isUrgent = remainingSec < 60;

  return (
    <Badge
      variant={isUrgent ? 'destructive' : 'warning'}
      className={cn(
        'gap-1 font-mono tabular-nums',
        isUrgent && 'animate-pulse',
        className,
      )}
    >
      <Clock className="h-3 w-3" />
      <span>剩余 {formatMmSs(remainingSec)}</span>
    </Badge>
  );
}
