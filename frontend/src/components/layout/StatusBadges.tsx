/**
 * 跨模块复用的状态徽标组件集合（预约状态、活动可用性、审计触发源与防超卖一致性）。
 */
import type {
  AuditTrigger,
  AvailabilityStatus,
  ReservationStatus,
} from '@queue-reservation/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';

const USER_RESERVATION_LABELS: Record<ReservationStatus, string> = {
  CONFIRMED: '预约成功',
  PENDING_CONFIRM: '待确认',
  WAITLISTED: '候补排队中',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
};

const ADMIN_RESERVATION_LABELS: Record<ReservationStatus, string> = {
  CONFIRMED: '已确认 CONFIRMED',
  PENDING_CONFIRM: '待确认锁单 PENDING_CONFIRM',
  WAITLISTED: '候补排队中 WAITLISTED',
  CANCELLED: '已取消 CANCELLED',
  EXPIRED: '已超时 EXPIRED',
};

const RESERVATION_VARIANTS: Record<ReservationStatus, BadgeProps['variant']> = {
  CONFIRMED: 'success',
  PENDING_CONFIRM: 'warning',
  WAITLISTED: 'info',
  CANCELLED: 'muted',
  EXPIRED: 'destructive',
};

/** 预约状态徽标属性。 */
export interface ReservationStatusBadgeProps {
  status: ReservationStatus;
  adminMode?: boolean;
  className?: string;
}

/**
 * 渲染预约单 5 种状态对应的语义徽标。
 *
 * @param props 预约状态与展示视角配置
 * @returns 状态徽标元素
 */
export function ReservationStatusBadge({
  status,
  adminMode = false,
  className,
}: ReservationStatusBadgeProps) {
  const label = adminMode
    ? ADMIN_RESERVATION_LABELS[status]
    : USER_RESERVATION_LABELS[status];

  return (
    <Badge variant={RESERVATION_VARIANTS[status]} className={className}>
      {label}
    </Badge>
  );
}

const AVAILABILITY_META: Record<
  AvailabilityStatus,
  { label: string; variant: BadgeProps['variant'] }
> = {
  AVAILABLE: { label: '可预约', variant: 'success' },
  WAITLIST_ONLY: { label: '名额已满 · 可候补', variant: 'info' },
  CLOSED: { label: '已截止', variant: 'muted' },
};

/** 活动可用性徽标属性。 */
export interface AvailabilityStatusBadgeProps {
  status: AvailabilityStatus;
  className?: string;
}

/**
 * 渲染活动公开可用态徽标（可预约 / 仅候补 / 已截止）。
 *
 * @param props 活动可用状态与可选样式类名
 * @returns 可用性徽标元素
 */
export function AvailabilityStatusBadge({
  status,
  className,
}: AvailabilityStatusBadgeProps) {
  const meta = AVAILABILITY_META[status];
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}

const AUDIT_TRIGGER_META: Record<
  AuditTrigger,
  { label: string; variant: BadgeProps['variant'] }
> = {
  USER_ACTION: { label: '用户操作 · USER_ACTION', variant: 'outline' },
  SYSTEM_TIMEOUT: { label: '系统超时释放 · SYSTEM_TIMEOUT', variant: 'destructive' },
  WAITLIST_PROMOTED: { label: '候补自动转正 · WAITLIST_PROMOTED', variant: 'info' },
};

/** 审计触发源徽标属性。 */
export interface AuditTriggerBadgeProps {
  trigger: AuditTrigger;
  className?: string;
}

/**
 * 渲染审计日志触发源语义徽标。
 *
 * @param props 审计触发源与可选样式类名
 * @returns 触发源徽标元素
 */
export function AuditTriggerBadge({ trigger, className }: AuditTriggerBadgeProps) {
  const meta = AUDIT_TRIGGER_META[trigger];
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}

/** 防超卖强一致检测徽标属性。 */
export interface OversellStatusBadgeProps {
  oversold: boolean;
  occupiedCount: number;
  capacity: number;
  className?: string;
}

/**
 * 渲染活动名额防超卖强一致状态徽标（基于服务端真实预约行数校验结果）。
 *
 * @param props 超卖标记与实时占用/容量统计
 * @returns 一致性状态徽标元素
 */
export function OversellStatusBadge({
  oversold,
  occupiedCount,
  capacity,
  className,
}: OversellStatusBadgeProps) {
  if (oversold) {
    return (
      <Badge variant="destructive" className={className}>
        异常超卖 {occupiedCount}/{capacity}
      </Badge>
    );
  }
  return (
    <Badge variant="success" className={className}>
      强一致无超卖 {occupiedCount}/{capacity}
    </Badge>
  );
}
