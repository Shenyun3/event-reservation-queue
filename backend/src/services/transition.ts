/**
 * 预约状态机核心领域原语：单一计数增量查表（applyTransition）、半开过期边界判定、
 * 锁内统一过期回收（releaseExpiredInLock）与 FIFO 候补转正（promoteNextWaitlistedInLock）。
 * 本模块严禁导入 Hono 或 PrismaClient，仅依赖仓储接口与共享领域类型。
 */
import { ERROR_CODES, type ReservationStatus } from '@queue-reservation/shared';
import { AppError } from '../lib/errors.ts';
import type {
  EventRecord,
  Repositories,
  ReservationRecord,
} from '../repositories/types.ts';

/** 活动占座计数增量（由 applyTransition 查表产生）。 */
export interface CountDelta {
  confirmedDelta: number;
  pendingDelta: number;
}

/** 锁内过期回收与联动转正的执行结果。 */
export interface ReleaseExpiredResult {
  event: EventRecord;
  expiredIds: string[];
  promoted: ReservationRecord[];
}

/** 锁内候补队首转正结果。 */
export interface PromoteWaitlistedResult {
  event: EventRecord;
  promoted: ReservationRecord;
}

/**
 * 与 docs/architecture.md §5.1 状态表 1:1 对应的合法状态跃迁及计数变更映射。
 * 所有涉及 confirmedCount / pendingCount 的状态变更必须经由本表驱动。
 */
const TRANSITION_TABLE: Readonly<Record<string, CountDelta>> = {
  'NULL->PENDING_CONFIRM': { confirmedDelta: 0, pendingDelta: +1 },
  'NULL->WAITLISTED': { confirmedDelta: 0, pendingDelta: 0 },
  'PENDING_CONFIRM->CONFIRMED': { confirmedDelta: +1, pendingDelta: -1 },
  'PENDING_CONFIRM->EXPIRED': { confirmedDelta: 0, pendingDelta: -1 },
  'PENDING_CONFIRM->CANCELLED': { confirmedDelta: 0, pendingDelta: -1 },
  'CONFIRMED->CANCELLED': { confirmedDelta: -1, pendingDelta: 0 },
  'WAITLISTED->CANCELLED': { confirmedDelta: 0, pendingDelta: 0 },
  'WAITLISTED->PENDING_CONFIRM': { confirmedDelta: 0, pendingDelta: +1 },
};

function buildTransitionKey(
  from: ReservationStatus | null,
  to: ReservationStatus,
): string {
  return `${from ?? 'NULL'}->${to}`;
}

/**
 * 判定从 `from` 到 `to` 的状态跃迁是否在 §5.1 状态机允许范围内。
 * 写事务中应先调用本函数显式校验，不合法时返回判别联合 `{ kind: 'INVALID_TRANSITION' }`
 * 而非在事务内抛异常，确保同事务前序 `releaseExpiredInLock` 的过期回收不回滚。
 *
 * @param from 变更前状态（新建预约时为 `null`）。
 * @param to 变更后目标状态。
 * @returns 跃迁合法返回 `true`，否则返回 `false`。
 */
export function canTransition(
  from: ReservationStatus | null,
  to: ReservationStatus,
): boolean {
  return Object.prototype.hasOwnProperty.call(
    TRANSITION_TABLE,
    buildTransitionKey(from, to),
  );
}

/**
 * 预约状态流转单一计数变更查表函数（与 docs/architecture.md §5.1 1:1 对应）。
 *
 * @param from 变更前状态（首次创建时为 `null`）。
 * @param to 变更后状态。
 * @returns 需要施加到 `Event` 表的 `confirmedDelta` 与 `pendingDelta`。
 * @throws {AppError} 仅作为程序员误调用非法状态跃迁时的内部不变量兜底断言；
 *   正常业务路径须先调用 `canTransition` 显式判定并在事务外映射 `409`。
 */
export function applyTransition(
  from: ReservationStatus | null,
  to: ReservationStatus,
): CountDelta {
  const key = buildTransitionKey(from, to);
  const delta = TRANSITION_TABLE[key];
  if (!delta) {
    // 内部不变量兜底断言：仅用于捕获程序员误调用非法跃迁；正常业务拒绝应先通过 canTransition 分支处理
    throw new AppError(
      ERROR_CODES.INVALID_STATE_TRANSITION,
      409,
      `非法预约状态流转：${key}`,
    );
  }
  return delta;
}

/**
 * 按统一半开区间口径判定锁单是否已过期：`expiresAt <= now` 即已过期。
 *
 * @param expiresAt 锁单截止时间。
 * @param now 事务锁后统一时间戳。
 * @returns 已过期返回 `true`。
 */
export function isExpiredAt(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/**
 * 按统一半开区间口径判定锁单是否仍在有效确认/取消窗口内：`now < expiresAt`。
 *
 * @param expiresAt 锁单截止时间。
 * @param now 事务锁后统一时间戳。
 * @returns 仍在有效窗口内返回 `true`。
 */
export function isWithinConfirmWindow(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() < expiresAt.getTime();
}

/**
 * 计算锁单确认截止时间，并钳制上限不超过活动开始时间 `eventStartTime`。
 *
 * @param now 事务锁后统一时间戳（调用方须确保 `now < eventStartTime`）。
 * @param confirmTimeoutSec 活动配置的锁单确认超时秒数。
 * @param eventStartTime 活动开始时间（预约与转正截止点）。
 * @returns `min(now + confirmTimeoutSec, eventStartTime)`。
 */
export function computeClampedExpiresAt(
  now: Date,
  confirmTimeoutSec: number,
  eventStartTime: Date,
): Date {
  const candidateMs = now.getTime() + confirmTimeoutSec * 1000;
  return new Date(Math.min(candidateMs, eventStartTime.getTime()));
}

/**
 * 在已持有 `Event` 行锁的事务内，按 `waitlistSeq ASC` 严格 FIFO 顺序转正队首候补。
 * 仅在活动未开始（`now < event.startTime`）且存在剩余可用名额时执行转正。
 *
 * @param repos 当前事务级仓储集合。
 * @param event 已锁定的最新活动记录。
 * @param now 事务锁后统一时间戳。
 * @returns 若成功转正则返回更新后的活动与被转正预约单，否则返回 `null`。
 */
export async function promoteNextWaitlistedInLock(
  repos: Repositories,
  event: EventRecord,
  now: Date,
): Promise<PromoteWaitlistedResult | null> {
  if (now.getTime() >= event.startTime.getTime()) {
    return null;
  }

  const remaining = event.capacity - event.confirmedCount - event.pendingCount;
  if (remaining <= 0) {
    return null;
  }

  const nextWaitlisted = await repos.reservations.findNextWaitlisted(event.id);
  if (!nextWaitlisted) {
    return null;
  }

  const expiresAt = computeClampedExpiresAt(
    now,
    event.confirmTimeoutSec,
    event.startTime,
  );
  const delta = applyTransition('WAITLISTED', 'PENDING_CONFIRM');
  const promoted = await repos.reservations.markPromoted(
    nextWaitlisted.id,
    expiresAt,
    now,
  );
  const updatedEvent = await repos.events.adjustCounts(event.id, delta);

  await repos.auditLogs.create({
    reservationId: promoted.id,
    eventId: updatedEvent.id,
    fromStatus: 'WAITLISTED',
    toStatus: 'PENDING_CONFIRM',
    trigger: 'WAITLIST_PROMOTED',
    actorId: null,
    note: '有空余名额释放，候补自动转正，请在规定时间内确认',
    createdAt: now,
  });

  return { event: updatedEvent, promoted };
}

/**
 * 在已持有 `Event` 行锁的事务内执行统一过期回收与条件 FIFO 候补转正。
 * Worker 巡检、发起预约、确认预约与取消预约均复用本原语，消除“过期占坑”与“新单插队”。
 *
 * @param repos 当前事务级仓储集合。
 * @param lockedEvent 事务首行已锁定的活动记录。
 * @param now 事务锁后统一时间戳。
 * @returns 回收后的最新活动记录、本轮过期的预约 ID 列表与本轮转正的预约列表。
 */
export async function releaseExpiredInLock(
  repos: Repositories,
  lockedEvent: EventRecord,
  now: Date,
): Promise<ReleaseExpiredResult> {
  const overdue = await repos.reservations.findOverduePendingByEvent(
    lockedEvent.id,
    now,
  );
  let currentEvent = lockedEvent;
  const expiredIds: string[] = [];
  const promoted: ReservationRecord[] = [];

  for (const item of overdue) {
    const delta = applyTransition('PENDING_CONFIRM', 'EXPIRED');
    await repos.reservations.markExpired(item.id, now);
    currentEvent = await repos.events.adjustCounts(currentEvent.id, delta);

    await repos.auditLogs.create({
      reservationId: item.id,
      eventId: currentEvent.id,
      fromStatus: 'PENDING_CONFIRM',
      toStatus: 'EXPIRED',
      trigger: 'SYSTEM_TIMEOUT',
      actorId: null,
      note: '未在规定时间内确认，系统已自动释放名额',
      createdAt: now,
    });

    expiredIds.push(item.id);

    // 仅当活动尚未开始（now < event.startTime）时尝试 FIFO 队首转正
    if (now.getTime() < currentEvent.startTime.getTime()) {
      const next = await promoteNextWaitlistedInLock(repos, currentEvent, now);
      if (next) {
        currentEvent = next.event;
        promoted.push(next.promoted);
      }
    }
  }

  return { event: currentEvent, expiredIds, promoted };
}
