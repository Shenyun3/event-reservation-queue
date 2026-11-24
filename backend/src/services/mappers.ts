/**
 * 领域记录到共享 API DTO 的纯映射函数（集中落实 RBAC 字段裁剪与时间戳 ISO 序列化）。
 */
import type {
  AdminEventDto,
  AuditLogDto,
  AvailabilityStatus,
  PublicEventDto,
  ReservationDetailDto,
  ReservationSummaryDto,
  ReservationWithEventDto,
  ReservationWithUserDto,
  UserDto,
} from '@queue-reservation/shared';
import type {
  AuditLogWithActorRecord,
  EventRecord,
  ReservationRecord,
  ReservationWithEventRecord,
  ReservationWithUserRecord,
  UserRecord,
} from '../repositories/types.ts';

/**
 * 将用户领域记录映射为公开 `UserDto`。
 *
 * @param user 用户领域记录。
 * @returns 符合共享契约的 `UserDto`。
 */
export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isSimulated: user.isSimulated,
  };
}

/**
 * 计算 C 端与看板共享的活动可用态：
 * `now >= startTime` 为 `CLOSED`；否则仅当有余量且候补队列为空时为 `AVAILABLE`，其余为 `WAITLIST_ONLY`。
 *
 * @param event 活动领域记录。
 * @param waitlistedCount 当前候补单数。
 * @param now 当前服务端时钟时刻。
 * @returns 活动可用态枚举值。
 */
export function computeAvailabilityStatus(
  event: EventRecord,
  waitlistedCount: number,
  now: Date,
): AvailabilityStatus {
  if (now.getTime() >= event.startTime.getTime()) {
    return 'CLOSED';
  }
  const remaining = event.capacity - event.confirmedCount - event.pendingCount;
  if (remaining > 0 && waitlistedCount === 0) {
    return 'AVAILABLE';
  }
  return 'WAITLIST_ONLY';
}

/**
 * 将活动记录映射为严格裁剪后的 C 端 `PublicEventDto`。
 * 严禁包含 `capacity`、`confirmedCount`、`pendingCount`、`waitlistedCount`、`remainingCapacity`、`confirmTimeoutSec` 等运营字段。
 *
 * @param event 活动领域记录。
 * @param waitlistedCount 当前候补单数（仅用于推导 `availabilityStatus`，不对外透出）。
 * @param now 当前服务端时钟时刻。
 * @returns 裁剪后的公开活动 DTO。
 */
export function toPublicEventDto(
  event: EventRecord,
  waitlistedCount: number,
  now: Date,
): PublicEventDto {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    maxPerUser: event.maxPerUser,
    availabilityStatus: computeAvailabilityStatus(event, waitlistedCount, now),
    createdAt: event.createdAt.toISOString(),
  };
}

/**
 * 将活动记录与实时统计映射为运营管理员 `AdminEventDto`。
 * `stats.oversold` 强制按 `Reservation` 表真实占座行数计算，避免冗余计数偏低漂移漏检。
 *
 * @param event 活动领域记录。
 * @param waitlistedCount 当前候补单数。
 * @param actualOccupied 从 `reservations` 表聚合得到的真实占座行数。
 * @param now 当前服务端时钟时刻。
 * @returns 完整运营管理视角活动 DTO。
 */
export function toAdminEventDto(
  event: EventRecord,
  waitlistedCount: number,
  actualOccupied: { confirmed: number; pending: number },
  now: Date,
): AdminEventDto {
  const occupiedCount = event.confirmedCount + event.pendingCount;
  const remainingCapacity = event.capacity - occupiedCount;
  const oversold = actualOccupied.confirmed + actualOccupied.pending > event.capacity;

  return {
    ...toPublicEventDto(event, waitlistedCount, now),
    capacity: event.capacity,
    confirmTimeoutSec: event.confirmTimeoutSec,
    createdById: event.createdById,
    stats: {
      capacity: event.capacity,
      confirmedCount: event.confirmedCount,
      pendingCount: event.pendingCount,
      waitlistedCount,
      occupiedCount,
      remainingCapacity,
      oversold,
    },
  };
}

/**
 * 将预约单领域记录映射为基础摘要 DTO（非 `WAITLISTED` 状态 `waitlistRank` 恒为 `null`）。
 *
 * @param reservation 预约单领域记录。
 * @param waitlistRank 动态计算的 1-based 候补顺位（非候补时为 `null`）。
 * @returns `ReservationSummaryDto`。
 */
export function toReservationSummaryDto(
  reservation: ReservationRecord,
  waitlistRank: number | null,
): ReservationSummaryDto {
  return {
    id: reservation.id,
    eventId: reservation.eventId,
    userId: reservation.userId,
    status: reservation.status,
    expiresAt: reservation.expiresAt ? reservation.expiresAt.toISOString() : null,
    waitlistedAt: reservation.waitlistedAt
      ? reservation.waitlistedAt.toISOString()
      : null,
    waitlistRank: reservation.status === 'WAITLISTED' ? waitlistRank : null,
    confirmedAt: reservation.confirmedAt
      ? reservation.confirmedAt.toISOString()
      : null,
    cancelledAt: reservation.cancelledAt
      ? reservation.cancelledAt.toISOString()
      : null,
    expiredAt: reservation.expiredAt ? reservation.expiredAt.toISOString() : null,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

/**
 * 将预约单领域记录映射为详情 DTO（含 `idempotencyKey`，不含他人信息）。
 *
 * @param reservation 预约单领域记录。
 * @param waitlistRank 动态计算的候补顺位。
 * @returns `ReservationDetailDto`。
 */
export function toReservationDetailDto(
  reservation: ReservationRecord,
  waitlistRank: number | null,
): ReservationDetailDto {
  return {
    ...toReservationSummaryDto(reservation, waitlistRank),
    idempotencyKey: reservation.idempotencyKey,
  };
}

/**
 * 将携带用户信息的预约单映射为管理台名册与 ADMIN 转正响应 DTO。
 *
 * @param reservation 携带用户信息的预约单记录。
 * @param waitlistRank 动态计算的候补顺位。
 * @returns `ReservationWithUserDto`。
 */
export function toReservationWithUserDto(
  reservation: ReservationWithUserRecord,
  waitlistRank: number | null,
): ReservationWithUserDto {
  return {
    ...toReservationDetailDto(reservation, waitlistRank),
    userName: reservation.user.name,
    userEmail: reservation.user.email,
  };
}

/**
 * 将携带活动摘要的预约单映射为「我的预约」列表 DTO。
 *
 * @param reservation 携带活动摘要的预约单记录。
 * @param waitlistRank 动态计算的候补顺位。
 * @returns `ReservationWithEventDto`。
 */
export function toReservationWithEventDto(
  reservation: ReservationWithEventRecord,
  waitlistRank: number | null,
): ReservationWithEventDto {
  return {
    ...toReservationDetailDto(reservation, waitlistRank),
    event: {
      id: reservation.event.id,
      name: reservation.event.name,
      startTime: reservation.event.startTime.toISOString(),
      endTime: reservation.event.endTime.toISOString(),
      maxPerUser: reservation.event.maxPerUser,
    },
  };
}

/**
 * 将审计日志记录映射为 `AuditLogDto`。
 *
 * @param log 携带操作人名称的审计日志领域记录。
 * @returns `AuditLogDto`。
 */
export function toAuditLogDto(log: AuditLogWithActorRecord): AuditLogDto {
  return {
    id: log.id,
    reservationId: log.reservationId,
    eventId: log.eventId,
    fromStatus: log.fromStatus,
    toStatus: log.toStatus,
    trigger: log.trigger,
    actorId: log.actorId,
    actorName: log.actorName,
    note: log.note,
    createdAt: log.createdAt.toISOString(),
  };
}
