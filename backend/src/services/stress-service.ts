/**
 * P1 并发压测与清空活动预约用例服务：
 * - `clearEventReservations`：事务行锁内按外键安全顺序清空指定活动的审计日志、预约单并归零计数；
 * - `simulateBurst`：批量准备 `isSimulated = true` 虚拟用户并以 `Promise.all` 同毫秒并发调用真实 `ReservationService`。
 * 严格遵循 Clean Architecture：不导入 Hono 或 PrismaClient。
 */
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type BurstResultItem,
  type ClearEventReservationsResponse,
  type EventStats,
  type SimulateBurstResponse,
} from '@queue-reservation/shared';
import type { Clock } from '../lib/clock.ts';
import { AppError, isPrismaErrorCode } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type {
  Repositories,
  TransactionManager,
  UserRecord,
} from '../repositories/types.ts';
import type { ReservationService } from './reservation-service.ts';

/** `StressService` 构造依赖。 */
export interface StressServiceDeps {
  repos: Repositories;
  txManager: TransactionManager;
  reservationService: ReservationService;
  clock: Clock;
  logger: Logger;
  /** 数据库连接池上限（用于计算压测最大并发度 `min(25, max(1, dbPoolMax - 5))`）。 */
  dbPoolMax: number;
}

/** P1 并发压测与压测前活动清场服务（仅限 `ADMIN`）。 */
export class StressService {
  private readonly repos: Repositories;
  private readonly txManager: TransactionManager;
  private readonly reservationService: ReservationService;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly dbPoolMax: number;

  /**
   * 创建 `StressService` 实例。
   *
   * @param deps 仓储、事务管理器、预约服务、时钟、日志与连接池上限配置。
   */
  constructor(deps: StressServiceDeps) {
    this.repos = deps.repos;
    this.txManager = deps.txManager;
    this.reservationService = deps.reservationService;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.dbPoolMax = deps.dbPoolMax;
  }

  /**
   * 计算当前连接池配置下允许的最大压测并发数。
   * 预留至少 5 条连接供读查询与后台超时巡检 Worker 使用，且硬上限不超过 25。
   *
   * @returns 允许的最大并发请求数（范围 `1 ~ 25`）。
   */
  getMaxConcurrency(): number {
    return Math.min(25, Math.max(1, this.dbPoolMax - 5));
  }

  /**
   * 清空指定活动的全部历史预约与审计日志，并在行锁内归零占座计数（仅限 `ADMIN`）。
   * 事务内严格遵守 `events -> reservation_audit_logs -> reservations` 锁与外键安全删除顺序。
   *
   * @param actor 当前请求操作人。
   * @param eventId 目标活动 ID。
   * @returns 被删除的预约单数量。
   * @throws {AppError} 非管理员抛出 `403 FORBIDDEN`；活动不存在由 `lockForUpdate` 触发 `P2025 -> 404 EVENT_NOT_FOUND`。
   */
  async clearEventReservations(
    actor: UserRecord,
    eventId: string,
  ): Promise<ClearEventReservationsResponse> {
    if (actor.role !== 'ADMIN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, '仅管理员可清空活动预约');
    }

    const deletedReservationsCount = await this.txManager.run(async (repos) => {
      // 1. 事务首行锁定目标 Event 行（不存在时触发 P2025 -> 404 EVENT_NOT_FOUND）
      await repos.events.lockForUpdate(eventId);
      // 2. 按外键 RESTRICT 依赖安全顺序先删审计日志，再删预约单，最后归零计数
      await repos.auditLogs.deleteByEvent(eventId);
      const deletedCount = await repos.reservations.deleteByEvent(eventId);
      await repos.events.resetCounts(eventId);
      return deletedCount;
    });

    this.logger.info('stress_clear_event_reservations', {
      actorId: actor.id,
      eventId,
      deletedReservationsCount,
    });

    return { deletedReservationsCount };
  }

  /**
   * 在服务端以 `Promise.all` 同毫秒并发调用真实 `ReservationService.createReservation` 执行压测（仅限 `ADMIN`）。
   * 自动批量准备 `isSimulated = true` 虚拟用户（不污染 `GET /api/users`），并在压测结束后按
   * `Reservation` 表真实占座行数计算 `oversold` 与每条候补记录的最新 `waitlistRank`。
   *
   * @param actor 当前请求操作人。
   * @param eventId 目标活动 ID。
   * @param concurrency 并发请求数（范围 `1 ~ min(25, max(1, dbPoolMax - 5))`）。
   * @returns 压测后的活动统计、汇总战报与逐笔执行明细。
   * @throws {AppError} 非管理员返回 `403 FORBIDDEN`；并发数越界返回 `400 VALIDATION_ERROR`；活动不存在返回 `404 EVENT_NOT_FOUND`。
   */
  async simulateBurst(
    actor: UserRecord,
    eventId: string,
    concurrency: number,
  ): Promise<SimulateBurstResponse> {
    if (actor.role !== 'ADMIN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, '仅管理员可发起并发压测');
    }

    const maxConcurrency = this.getMaxConcurrency();
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > maxConcurrency
    ) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `并发数必须为 1 ~ ${maxConcurrency} 之间的整数（受数据库连接池上限限制）`,
        { maxConcurrency, dbPoolMax: this.dbPoolMax },
      );
    }

    const existingEvent = await this.repos.events.findById(eventId);
    if (!existingEvent) {
      throw new AppError(ERROR_CODES.EVENT_NOT_FOUND, 404, '目标活动不存在');
    }

    const batchId = randomUUID().slice(0, 8);
    const simUserInputs = Array.from({ length: concurrency }, (_, idx) => {
      const paddedIndex = String(idx + 1).padStart(2, '0');
      return {
        id: `sim-${batchId}-${paddedIndex}`,
        name: `并发用户 #${paddedIndex}`,
        email: `sim-${batchId}-${paddedIndex}@sim.local`,
        role: 'USER' as const,
        isSimulated: true,
      };
    });

    const simUsers = await this.repos.users.upsertMany(
      simUserInputs,
      this.clock.now(),
    );

    const startedAt = performance.now();
    const rawResults = await Promise.all(
      simUsers.map(async (simUser, idx): Promise<BurstResultItem> => {
        const index = idx + 1;
        const paddedIndex = String(index).padStart(2, '0');
        const idempotencyKey = `burst-${batchId}-${paddedIndex}`;
        const reqStart = performance.now();

        try {
          const created = await this.reservationService.createReservation(
            simUser,
            eventId,
            idempotencyKey,
          );
          const latencyMs = Math.max(
            0,
            Math.round((performance.now() - reqStart) * 100) / 100,
          );
          return {
            index,
            userId: simUser.id,
            userName: simUser.name,
            idempotencyKey,
            ok: true,
            reservation: created.reservation,
            waitlistRank: created.reservation.waitlistRank,
            latencyMs,
          };
        } catch (err) {
          const latencyMs = Math.max(
            0,
            Math.round((performance.now() - reqStart) * 100) / 100,
          );
          const errorMessage = this.formatBurstItemError(err, eventId, simUser.id);
          return {
            index,
            userId: simUser.id,
            userName: simUser.name,
            idempotencyKey,
            ok: false,
            error: errorMessage,
            latencyMs,
          };
        }
      }),
    );
    const durationMs = Math.max(
      0,
      Math.round((performance.now() - startedAt) * 100) / 100,
    );

    const [latestEvent, actualOccupied, waitlistedCount, rankMap] =
      await Promise.all([
        this.repos.events.findById(eventId),
        this.repos.reservations.countActualOccupiedByEvent(eventId),
        this.repos.reservations.countWaitlistedByEvent(eventId),
        this.repos.reservations.buildWaitlistRankMap([eventId]),
      ]);

    if (!latestEvent) {
      throw new AppError(ERROR_CODES.EVENT_NOT_FOUND, 404, '目标活动不存在');
    }

    const occupiedCount = latestEvent.confirmedCount + latestEvent.pendingCount;
    const remainingCapacity = latestEvent.capacity - occupiedCount;
    // 严格按 Reservation 表真实占座行数校验是否超卖，避免仅依赖冗余计数字段
    const oversold =
      actualOccupied.confirmed + actualOccupied.pending > latestEvent.capacity;

    const eventStatsAfter: EventStats = {
      capacity: latestEvent.capacity,
      confirmedCount: latestEvent.confirmedCount,
      pendingCount: latestEvent.pendingCount,
      waitlistedCount,
      occupiedCount,
      remainingCapacity,
      oversold,
    };

    const results: BurstResultItem[] = rawResults.map((item) => {
      if (item.ok && item.reservation && item.reservation.status === 'WAITLISTED') {
        const latestRank =
          rankMap.get(item.reservation.id) ?? item.reservation.waitlistRank ?? null;
        return {
          ...item,
          waitlistRank: latestRank,
          reservation: {
            ...item.reservation,
            waitlistRank: latestRank,
          },
        };
      }
      return item;
    });

    let pendingCount = 0;
    let waitlistedResultCount = 0;
    let failedCount = 0;
    for (const item of results) {
      if (!item.ok) {
        failedCount += 1;
      } else if (item.reservation?.status === 'PENDING_CONFIRM') {
        pendingCount += 1;
      } else if (item.reservation?.status === 'WAITLISTED') {
        waitlistedResultCount += 1;
      }
    }

    this.logger.info('stress_simulate_burst_completed', {
      actorId: actor.id,
      eventId,
      batchId,
      concurrency,
      pendingCount,
      waitlistedCount: waitlistedResultCount,
      failedCount,
      durationMs,
      oversold,
    });

    return {
      eventStatsAfter,
      summary: {
        totalRequests: results.length,
        pendingCount,
        waitlistedCount: waitlistedResultCount,
        failedCount,
        durationMs,
        oversold,
      },
      results,
    };
  }

  /** 将单笔并发请求捕获到的异常脱敏转换为可读错误文案，避免中断整批压测或泄露 DB 堆栈。 */
  private formatBurstItemError(
    err: unknown,
    eventId: string,
    simUserId: string,
  ): string {
    if (err instanceof AppError) {
      return err.message;
    }
    if (isPrismaErrorCode(err, 'P2025')) {
      return '目标活动不存在';
    }
    if (isPrismaErrorCode(err, 'P2028') || isPrismaErrorCode(err, 'P2034')) {
      return '系统当前并发繁忙，请稍后重试';
    }
    this.logger.warn('stress_burst_item_unexpected_error', {
      eventId,
      simUserId,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return '请求执行失败';
  }
}
