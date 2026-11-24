/**
 * 运营管理运维用例服务：手动触发超时巡检与单事务原子重置演示数据（reset-seed）。
 */
import {
  ERROR_CODES,
  type ExpireWorkerResponse,
  type ResetSeedResponse,
} from '@queue-reservation/shared';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type { TransactionManager, UserRecord } from '../repositories/types.ts';
import type { ReservationService } from './reservation-service.ts';

/** `AdminService` 构造依赖。 */
export interface AdminServiceDeps {
  txManager: TransactionManager;
  reservationService: ReservationService;
  clock: Clock;
  logger: Logger;
}

/** 管理员专属运维操作服务。 */
export class AdminService {
  private readonly txManager: TransactionManager;
  private readonly reservationService: ReservationService;
  private readonly clock: Clock;
  private readonly logger: Logger;

  /**
   * 创建 `AdminService` 实例。
   *
   * @param deps 事务管理器、预约服务、时钟与日志依赖。
   */
  constructor(deps: AdminServiceDeps) {
    this.txManager = deps.txManager;
    this.reservationService = deps.reservationService;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  /**
   * 手动立即触发一次超时巡检与条件候补转正（仅限 `ADMIN`）。
   *
   * @param actor 当前请求操作人。
   * @returns 巡检释放数、转正数与最新巡检时间。
   * @throws {AppError} 非管理员返回 `403 FORBIDDEN`。
   */
  async triggerExpireWorker(actor: UserRecord): Promise<ExpireWorkerResponse> {
    if (actor.role !== 'ADMIN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, '仅管理员可手动触发超时巡检');
    }
    return this.reservationService.expireOverdueReservations();
  }

  /**
   * 在单一事务内重置演示数据库回初始 Seed 状态（仅限 `ADMIN`）。
   * 严格先按 `id ASC` 锁定全部现有 `Event` 行（维持全局加锁顺序防死锁），
   * 再按外键依赖顺序清空并重建初始数据。
   *
   * @param actor 当前请求操作人。
   * @returns 重置后的活动与用户数量摘要。
   * @throws {AppError} 非管理员返回 `403 FORBIDDEN`。
   */
  async resetSeed(actor: UserRecord): Promise<ResetSeedResponse> {
    if (actor.role !== 'ADMIN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, '仅管理员可重置演示数据');
    }

    const summary = await this.txManager.run(async (repos) => {
      // 1. 按 id ASC 锁定全部现有活动行，维持 events -> reservations -> audit_logs 全局锁序防死锁
      await repos.events.lockAllForUpdateAsc();
      // 2. 锁后取统一时间轴
      const now = this.clock.now();
      // 3. 按外键 RESTRICT 依赖逆序显式清空
      await repos.auditLogs.deleteAll();
      await repos.reservations.deleteAll();
      await repos.events.deleteAll();
      await repos.users.deleteSimulated();
      // 4. 在同一事务内灌入最新相对时间轴的初始 Seed 数据
      return repos.seedInitialData(now);
    });

    this.logger.info('admin_reset_seed_completed', {
      actorId: actor.id,
      eventsCount: summary.eventsCount,
      usersCount: summary.usersCount,
    });

    return {
      reset: true,
      eventsCount: summary.eventsCount,
      usersCount: summary.usersCount,
    };
  }
}
