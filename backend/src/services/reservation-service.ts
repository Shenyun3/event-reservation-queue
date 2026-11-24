/**
 * 预约核心业务用例服务：防超卖抢座/候补、严格幂等、确认/取消状态机、惰性超时与后台巡检。
 * 严格遵循 Clean Architecture：不导入 Hono 或 PrismaClient，写事务内不因业务拒绝抛异常（防止回滚过期回收）。
 */
import {
  ERROR_CODES,
  type CancelReservationResponse,
  type ExpireWorkerResponse,
  type MyReservationStatusFilter,
  type MyReservationsResponse,
  type ReservationAuditLogsResponse,
  type ReservationDetailDto,
  type ReservationStatus,
} from '@queue-reservation/shared';
import type { Clock } from '../lib/clock.ts';
import {
  AppError,
  isIdempotencyUniqueViolation,
  isPrismaErrorCode,
} from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type {
  Repositories,
  ReservationRecord,
  ReservationWithUserRecord,
  TransactionManager,
  UserRecord,
} from '../repositories/types.ts';
import {
  toAuditLogDto,
  toReservationDetailDto,
  toReservationSummaryDto,
  toReservationWithEventDto,
  toReservationWithUserDto,
} from './mappers.ts';
import {
  applyTransition,
  canTransition,
  computeClampedExpiresAt,
  isWithinConfirmWindow,
  promoteNextWaitlistedInLock,
  releaseExpiredInLock,
} from './transition.ts';

/** `ReservationService` 构造依赖。 */
export interface ReservationServiceDeps {
  repos: Repositories;
  txManager: TransactionManager;
  clock: Clock;
  logger: Logger;
  /** 超时巡检完成后的时间戳回调，用于更新运行态 `lastWorkerRunAt`。 */
  onWorkerRun?: (runAt: Date) => void;
}

/** 发起预约接口返回值（区分首次创建与幂等重放）。 */
export interface CreateReservationResult {
  reservation: ReservationDetailDto;
  idempotentReplay: boolean;
}

type CreateTxOutcome =
  | {
      kind: 'CREATED';
      reservation: ReservationRecord;
      waitlistRank: number | null;
    }
  | {
      kind: 'REPLAY';
      reservation: ReservationRecord;
      waitlistRank: number | null;
    }
  | { kind: 'EVENT_ENDED' }
  | { kind: 'MAX_PER_USER_EXCEEDED'; maxPerUser: number };

type ConfirmTxOutcome =
  | { kind: 'CONFIRMED'; reservation: ReservationRecord }
  | { kind: 'NOT_FOUND' }
  | { kind: 'FORBIDDEN' }
  | { kind: 'LAZILY_EXPIRED' }
  | { kind: 'INVALID_TRANSITION'; currentStatus: ReservationStatus };

type CancelTxOutcome =
  | {
      kind: 'CANCELLED';
      reservation: ReservationRecord;
      promotedWithUser: ReservationWithUserRecord | null;
    }
  | { kind: 'NOT_FOUND' }
  | { kind: 'FORBIDDEN' }
  | { kind: 'LAZILY_EXPIRED' }
  | { kind: 'INVALID_TRANSITION'; currentStatus: ReservationStatus };

/** 预约生命周期与超时回收核心服务。 */
export class ReservationService {
  private readonly repos: Repositories;
  private readonly txManager: TransactionManager;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly onWorkerRun?: (runAt: Date) => void;

  /**
   * 创建 `ReservationService` 实例。
   *
   * @param deps 仓储、事务管理器、时钟、日志与巡检回调依赖。
   */
  constructor(deps: ReservationServiceDeps) {
    this.repos = deps.repos;
    this.txManager = deps.txManager;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.onWorkerRun = deps.onWorkerRun;
  }

  /**
   * 发起预约（强一致防超卖 + 严格幂等 + 锁内过期回收防插队）。
   * 仅限 `USER` 角色调用；`ADMIN` 返回 `403 FORBIDDEN`。
   *
   * @param actor 当前请求操作人。
   * @param eventId 目标活动 ID。
   * @param rawIdempotencyKey 请求头 `Idempotency-Key`。
   * @returns 预约单详情与 `idempotentReplay` 标志。
   * @throws {AppError} 权限不足（403）、参数非法（400）、活动已截止（409）或超出个人限购（409）。
   */
  async createReservation(
    actor: UserRecord,
    eventId: string,
    rawIdempotencyKey: string,
  ): Promise<CreateReservationResult> {
    if (actor.role !== 'USER') {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        403,
        '管理员账号不可作为普通用户发起预约',
      );
    }

    const idempotencyKey = rawIdempotencyKey.trim();
    if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        '请求头 Idempotency-Key 必须为 1~128 字符的非空字符串',
      );
    }

    let outcome: CreateTxOutcome;
    try {
      outcome = await this.txManager.run(async (repos) => {
        // Step 1: 事务首行锁定 Event 行（不存在则由 Prisma 抛出 P2025 -> 404 EVENT_NOT_FOUND）
        const lockedEvent = await repos.events.lockForUpdate(eventId);
        // Step 2: 锁后获取统一时间戳
        const now = this.clock.now();
        // Step 3: 统一过期回收与条件转正，消除过期占坑与新单插队
        const { event: freshEvent } = await releaseExpiredInLock(
          repos,
          lockedEvent,
          now,
        );

        // Step 4: 严格幂等查找（必须在 EVENT_ENDED 与 maxPerUser 之前执行，返回最新当前状态）
        const existing = await repos.reservations.findByIdempotencyKey(
          eventId,
          actor.id,
          idempotencyKey,
        );
        if (existing) {
          const waitlistRank =
            existing.status === 'WAITLISTED' && existing.waitlistSeq !== null
              ? await repos.reservations.countWaitlistRank(
                  eventId,
                  existing.waitlistSeq,
                )
              : null;
          return {
            kind: 'REPLAY' as const,
            reservation: existing,
            waitlistRank,
          };
        }

        // Step 5: 活动截止校验（now >= startTime 停止接受新预约；返回判别联合避免回滚 Step 3）
        if (now.getTime() >= freshEvent.startTime.getTime()) {
          return { kind: 'EVENT_ENDED' as const };
        }

        // Step 6: 单人限购校验（统计 CONFIRMED | PENDING_CONFIRM | WAITLISTED）
        const activeCount = await repos.reservations.countActiveByEventAndUser(
          eventId,
          actor.id,
        );
        if (activeCount >= freshEvent.maxPerUser) {
          return {
            kind: 'MAX_PER_USER_EXCEEDED' as const,
            maxPerUser: freshEvent.maxPerUser,
          };
        }

        // Step 7: 名额判定（防插队不变量：仅当 remaining > 0 且 waitlistedCount === 0 时直接锁座）
        const remaining =
          freshEvent.capacity -
          freshEvent.confirmedCount -
          freshEvent.pendingCount;
        const waitlistedCount =
          await repos.reservations.countWaitlistedByEvent(eventId);

        if (remaining > 0 && waitlistedCount === 0) {
          const expiresAt = computeClampedExpiresAt(
            now,
            freshEvent.confirmTimeoutSec,
            freshEvent.startTime,
          );
          const delta = applyTransition(null, 'PENDING_CONFIRM');
          const created = await repos.reservations.create({
            eventId,
            userId: actor.id,
            status: 'PENDING_CONFIRM',
            idempotencyKey,
            expiresAt,
            waitlistedAt: null,
            waitlistSeq: null,
            now,
          });
          await repos.events.adjustCounts(eventId, delta);
          await repos.auditLogs.create({
            reservationId: created.id,
            eventId,
            fromStatus: null,
            toStatus: 'PENDING_CONFIRM',
            trigger: 'USER_ACTION',
            actorId: actor.id,
            note: '提交预约申请，名额已暂留，等待确认',
            createdAt: now,
          });
          return {
            kind: 'CREATED' as const,
            reservation: created,
            waitlistRank: null,
          };
        }

        // 满额或仍有候补队列：按锁后严格单调的 lockVersion 分配 waitlistSeq 进入候补
        const waitlistSeq = lockedEvent.lockVersion;
        applyTransition(null, 'WAITLISTED');
        const created = await repos.reservations.create({
          eventId,
          userId: actor.id,
          status: 'WAITLISTED',
          idempotencyKey,
          expiresAt: null,
          waitlistedAt: now,
          waitlistSeq,
          now,
        });
        await repos.auditLogs.create({
          reservationId: created.id,
          eventId,
          fromStatus: null,
          toStatus: 'WAITLISTED',
          trigger: 'USER_ACTION',
          actorId: actor.id,
          note: '当前名额已满，已加入候补队列',
          createdAt: now,
        });
        const waitlistRank = await repos.reservations.countWaitlistRank(
          eventId,
          waitlistSeq,
        );
        return {
          kind: 'CREATED' as const,
          reservation: created,
          waitlistRank,
        };
      });
    } catch (err) {
      // Re-review P2-1：在 txManager.run 外部精准捕获幂等唯一键 P2002，其余 P2002（如 waitlist_seq）原样抛出
      if (isIdempotencyUniqueViolation(err)) {
        const existing = await this.repos.reservations.findByIdempotencyKey(
          eventId,
          actor.id,
          idempotencyKey,
        );
        if (existing) {
          const waitlistRank =
            existing.status === 'WAITLISTED' && existing.waitlistSeq !== null
              ? await this.repos.reservations.countWaitlistRank(
                  eventId,
                  existing.waitlistSeq,
                )
              : null;
          return {
            reservation: toReservationDetailDto(existing, waitlistRank),
            idempotentReplay: true,
          };
        }
      }
      throw err;
    }

    if (outcome.kind === 'EVENT_ENDED') {
      throw new AppError(
        ERROR_CODES.EVENT_ENDED,
        409,
        '活动已开始或已截止，停止接受新预约',
      );
    }
    if (outcome.kind === 'MAX_PER_USER_EXCEEDED') {
      throw new AppError(
        ERROR_CODES.MAX_PER_USER_EXCEEDED,
        409,
        `您在该活动的活跃预约数量已达上限（每人限 ${outcome.maxPerUser} 份）`,
      );
    }

    return {
      reservation: toReservationDetailDto(
        outcome.reservation,
        outcome.waitlistRank,
      ),
      idempotentReplay: outcome.kind === 'REPLAY',
    };
  }

  /**
   * 确认预约单（支持本人确认或管理员代确认；惰性超时提交落库后映射 `409 RESERVATION_EXPIRED`）。
   *
   * @param actor 当前请求操作人。
   * @param reservationId 目标预约单 ID。
   * @returns 确认后的 `ReservationDetailDto`。
   * @throws {AppError} 404 不存在、403 无权操作、409 惰性过期或非法状态流转。
   */
  async confirmReservation(
    actor: UserRecord,
    reservationId: string,
  ): Promise<ReservationDetailDto> {
    // 锁前读取仅用于提取 eventId（严禁复用此快照做状态决策，杜绝 TOCTOU）
    const lookup = await this.repos.reservations.findById(reservationId);
    if (!lookup) {
      throw new AppError(ERROR_CODES.RESERVATION_NOT_FOUND, 404, '预约单不存在');
    }

    const outcome: ConfirmTxOutcome = await this.txManager.run(async (repos) => {
      const lockedEvent = await repos.events.lockForUpdate(lookup.eventId);
      const now = this.clock.now();
      const { event: freshEvent, expiredIds } = await releaseExpiredInLock(
        repos,
        lockedEvent,
        now,
      );

      // 锁内重新读取目标预约单（防 TOCTOU）
      const current = await repos.reservations.findById(reservationId);
      if (!current) {
        return { kind: 'NOT_FOUND' as const };
      }
      if (actor.role !== 'ADMIN' && current.userId !== actor.id) {
        return { kind: 'FORBIDDEN' as const };
      }
      if (expiredIds.includes(current.id)) {
        return { kind: 'LAZILY_EXPIRED' as const };
      }

      // 显式检查状态跃迁合法性，不合法时返回判别联合避免回滚前序过期回收
      if (!canTransition(current.status, 'CONFIRMED')) {
        return {
          kind: 'INVALID_TRANSITION' as const,
          currentStatus: current.status,
        };
      }
      // 统一半开区间确认窗口校验（now < expiresAt）
      if (!isWithinConfirmWindow(current.expiresAt, now)) {
        return { kind: 'LAZILY_EXPIRED' as const };
      }

      const delta = applyTransition(current.status, 'CONFIRMED');
      const updated = await repos.reservations.markConfirmed(current.id, now);
      await repos.events.adjustCounts(freshEvent.id, delta);

      const note =
        actor.role === 'ADMIN' && current.userId !== actor.id
          ? '管理员代确认预约'
          : '在有效期内完成预约确认';
      await repos.auditLogs.create({
        reservationId: current.id,
        eventId: freshEvent.id,
        fromStatus: current.status,
        toStatus: 'CONFIRMED',
        trigger: 'USER_ACTION',
        actorId: actor.id,
        note,
        createdAt: now,
      });

      return { kind: 'CONFIRMED' as const, reservation: updated };
    });

    if (outcome.kind === 'NOT_FOUND') {
      throw new AppError(ERROR_CODES.RESERVATION_NOT_FOUND, 404, '预约单不存在');
    }
    if (outcome.kind === 'FORBIDDEN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, '无权操作他人的预约单');
    }
    if (outcome.kind === 'LAZILY_EXPIRED') {
      throw new AppError(
        ERROR_CODES.RESERVATION_EXPIRED,
        409,
        '该预约已超过确认时限，名额已自动释放',
      );
    }
    if (outcome.kind === 'INVALID_TRANSITION') {
      throw new AppError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        409,
        `当前预约状态（${outcome.currentStatus}）不允许执行确认操作`,
      );
    }

    return toReservationDetailDto(outcome.reservation, null);
  }

  /**
   * 取消预约单（释放占座且活动未开始时同事务触发 FIFO 候补转正）。
   * RBAC 防泄露：`USER` 视角恒返回 `promotedReservation: null`；`ADMIN` 视角返回完整转正 DTO 或 `null`。
   * 若目标锁单已过期，先落库 `EXPIRED` 与条件转正，事务提交后返回 `409 RESERVATION_EXPIRED`。
   *
   * @param actor 当前请求操作人。
   * @param reservationId 目标预约单 ID。
   * @returns 按角色裁剪后的取消响应体。
   * @throws {AppError} 404 不存在、403 无权操作、409 惰性过期或非法状态流转。
   */
  async cancelReservation(
    actor: UserRecord,
    reservationId: string,
  ): Promise<CancelReservationResponse> {
    // 锁前读取仅用于提取 eventId（严禁复用此快照做状态决策，杜绝 TOCTOU）
    const lookup = await this.repos.reservations.findById(reservationId);
    if (!lookup) {
      throw new AppError(ERROR_CODES.RESERVATION_NOT_FOUND, 404, '预约单不存在');
    }

    const outcome: CancelTxOutcome = await this.txManager.run(async (repos) => {
      const lockedEvent = await repos.events.lockForUpdate(lookup.eventId);
      const now = this.clock.now();
      const { event: freshEvent, expiredIds } = await releaseExpiredInLock(
        repos,
        lockedEvent,
        now,
      );

      // 锁内重新读取目标预约单（防 TOCTOU）
      const current = await repos.reservations.findById(reservationId);
      if (!current) {
        return { kind: 'NOT_FOUND' as const };
      }
      if (actor.role !== 'ADMIN' && current.userId !== actor.id) {
        return { kind: 'FORBIDDEN' as const };
      }
      if (expiredIds.includes(current.id)) {
        return { kind: 'LAZILY_EXPIRED' as const };
      }

      if (!canTransition(current.status, 'CANCELLED')) {
        return {
          kind: 'INVALID_TRANSITION' as const,
          currentStatus: current.status,
        };
      }
      if (
        current.status === 'PENDING_CONFIRM' &&
        !isWithinConfirmWindow(current.expiresAt, now)
      ) {
        return { kind: 'LAZILY_EXPIRED' as const };
      }

      const previousStatus = current.status;
      const delta = applyTransition(previousStatus, 'CANCELLED');
      const cancelled = await repos.reservations.markCancelled(current.id, now);

      let currentEvent = freshEvent;
      if (delta.confirmedDelta !== 0 || delta.pendingDelta !== 0) {
        currentEvent = await repos.events.adjustCounts(currentEvent.id, delta);
      }

      let note: string;
      if (actor.role === 'ADMIN' && current.userId !== actor.id) {
        note = '管理员强制取消预约';
      } else if (previousStatus === 'WAITLISTED') {
        note = '用户主动退出候补队列';
      } else {
        note = '用户主动取消预约';
      }

      await repos.auditLogs.create({
        reservationId: current.id,
        eventId: currentEvent.id,
        fromStatus: previousStatus,
        toStatus: 'CANCELLED',
        trigger: 'USER_ACTION',
        actorId: actor.id,
        note,
        createdAt: now,
      });

      // 释放正式占座（CONFIRMED / PENDING_CONFIRM）且活动未开始时，同事务触发 FIFO 队首转正
      let promotedWithUser: ReservationWithUserRecord | null = null;
      const releasedOccupiedSeat =
        delta.confirmedDelta < 0 || delta.pendingDelta < 0;
      if (
        releasedOccupiedSeat &&
        now.getTime() < currentEvent.startTime.getTime()
      ) {
        const next = await promoteNextWaitlistedInLock(repos, currentEvent, now);
        if (next && actor.role === 'ADMIN') {
          promotedWithUser = await repos.reservations.findByIdWithUser(
            next.promoted.id,
          );
        }
      }

      return {
        kind: 'CANCELLED' as const,
        reservation: cancelled,
        promotedWithUser,
      };
    });

    if (outcome.kind === 'NOT_FOUND') {
      throw new AppError(ERROR_CODES.RESERVATION_NOT_FOUND, 404, '预约单不存在');
    }
    if (outcome.kind === 'FORBIDDEN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, '无权操作他人的预约单');
    }
    if (outcome.kind === 'LAZILY_EXPIRED') {
      throw new AppError(
        ERROR_CODES.RESERVATION_EXPIRED,
        409,
        '该预约已超过确认时限，名额已自动释放',
      );
    }
    if (outcome.kind === 'INVALID_TRANSITION') {
      throw new AppError(
        ERROR_CODES.INVALID_STATE_TRANSITION,
        409,
        `当前预约状态（${outcome.currentStatus}）不允许执行取消操作`,
      );
    }

    return {
      reservation: toReservationDetailDto(outcome.reservation, null),
      promotedReservation:
        actor.role === 'ADMIN' && outcome.promotedWithUser
          ? toReservationWithUserDto(outcome.promotedWithUser, null)
          : null,
    };
  }

  /**
   * 查询「我的预约」列表（仅限 `USER` 角色，批量计算实时 `waitlistRank` 零 N+1）。
   *
   * @param actor 当前请求操作人。
   * @param statusFilter 状态过滤项（`ALL | PENDING_CONFIRM | CONFIRMED | WAITLISTED | CLOSED`）。
   * @returns 携带活动公开摘要的预约单列表。
   * @throws {AppError} `ADMIN` 调用时抛出 `403 FORBIDDEN`。
   */
  async listMyReservations(
    actor: UserRecord,
    statusFilter: MyReservationStatusFilter,
  ): Promise<MyReservationsResponse> {
    if (actor.role !== 'USER') {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        403,
        '该接口仅限普通用户查询个人预约',
      );
    }

    const rows = await this.repos.reservations.findByUserWithEvent(
      actor.id,
      statusFilter,
    );
    const waitlistedEventIds = rows
      .filter((r) => r.status === 'WAITLISTED')
      .map((r) => r.eventId);
    const rankMap =
      waitlistedEventIds.length > 0
        ? await this.repos.reservations.buildWaitlistRankMap(waitlistedEventIds)
        : new Map<string, number>();

    return rows.map((row) =>
      toReservationWithEventDto(row, rankMap.get(row.id) ?? null),
    );
  }

  /**
   * 查询单笔预约的完整审计时间线（仅限预约本人或 `ADMIN`）。
   *
   * @param actor 当前请求操作人。
   * @param reservationId 目标预约单 ID。
   * @returns 预约单摘要与按 `(createdAt ASC, id ASC)` 排序的审计日志列表。
   * @throws {AppError} 不存在返回 `404 RESERVATION_NOT_FOUND`，越权返回 `403 FORBIDDEN`。
   */
  async getAuditLogs(
    actor: UserRecord,
    reservationId: string,
  ): Promise<ReservationAuditLogsResponse> {
    const reservation = await this.repos.reservations.findById(reservationId);
    if (!reservation) {
      throw new AppError(ERROR_CODES.RESERVATION_NOT_FOUND, 404, '预约单不存在');
    }
    if (actor.role !== 'ADMIN' && reservation.userId !== actor.id) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        403,
        '无权查看他人的预约审计日志',
      );
    }

    const [logs, waitlistRank] = await Promise.all([
      this.repos.auditLogs.findByReservationId(reservationId),
      reservation.status === 'WAITLISTED' && reservation.waitlistSeq !== null
        ? this.repos.reservations.countWaitlistRank(
            reservation.eventId,
            reservation.waitlistSeq,
          )
        : Promise.resolve(null),
    ]);

    return {
      reservation: toReservationSummaryDto(reservation, waitlistRank),
      logs: logs.map(toAuditLogDto),
    };
  }

  /**
   * 执行一次全局超时锁单巡检回收（供 10 秒后台 Worker 与管理员手动触发接口共享）。
   * 先无锁 `groupBy` 扫描含过期单的活动，再按 `eventId ASC` 逐活动开启独立行锁事务复用 `releaseExpiredInLock`。
   *
   * @returns 本轮过期释放数、候补转正数与巡检完成时间戳。
   */
  async expireOverdueReservations(): Promise<ExpireWorkerResponse> {
    const scanNow = this.clock.now();
    const eventIds = await this.repos.reservations.findOverdueEventIds(scanNow);

    let expiredCount = 0;
    let promotedCount = 0;

    for (const eventId of eventIds) {
      try {
        const result = await this.txManager.run(async (repos) => {
          const lockedEvent = await repos.events.lockForUpdate(eventId);
          const now = this.clock.now();
          return releaseExpiredInLock(repos, lockedEvent, now);
        });
        expiredCount += result.expiredIds.length;
        promotedCount += result.promoted.length;
      } catch (err) {
        // 并发 reset-seed 删除旧活动行时跳过该活动，确保巡检继续处理其余活动
        if (isPrismaErrorCode(err, 'P2025')) {
          this.logger.warn('expiration_worker_skip_missing_event', { eventId });
          continue;
        }
        throw err;
      }
    }

    const runAt = this.clock.now();
    this.onWorkerRun?.(runAt);
    this.logger.info('expiration_worker_run', {
      scannedEvents: eventIds.length,
      expiredCount,
      promotedCount,
      lastWorkerRunAt: runAt.toISOString(),
    });

    return {
      expiredCount,
      promotedCount,
      lastWorkerRunAt: runAt.toISOString(),
    };
  }
}
