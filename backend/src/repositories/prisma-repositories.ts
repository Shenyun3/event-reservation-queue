/**
 * Prisma 7 仓储实现与 PrismaTransactionManager（回调式 Unit of Work）。
 * 运行时 100% ORM Only，严禁手写裸 SQL。
 */
import {
  ACTIVE_RESERVATION_STATUSES,
  CLOSED_RESERVATION_STATUSES,
  type AdminEventTab,
  type MyReservationStatusFilter,
} from '@queue-reservation/shared';
import type { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { populateSeedData } from '../../prisma/seed-data.ts';
import type {
  AuditLogRepository,
  EventRepository,
  Repositories,
  ReservationRepository,
  TransactionManager,
  UserRepository,
} from './types.ts';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

/**
 * 基于给定的 PrismaClient 或事务客户端构造完整仓储集合。
 *
 * @param db PrismaClient 或交互式事务客户端。
 * @returns 遵循 Clean Architecture 抽象的仓储集合。
 */
export function createPrismaRepositories(db: PrismaExecutor): Repositories {
  const users: UserRepository = {
    async findById(id) {
      return db.user.findUnique({ where: { id } });
    },
    async list({ includeSimulated }) {
      return db.user.findMany({
        where: includeSimulated ? undefined : { isSimulated: false },
        orderBy: [{ role: 'asc' }, { id: 'asc' }],
      });
    },
    async upsertMany(items, now) {
      const result = [];
      for (const item of items) {
        const record = await db.user.upsert({
          where: { id: item.id },
          update: {
            name: item.name,
            email: item.email,
            role: item.role,
            isSimulated: item.isSimulated,
            updatedAt: now,
          },
          create: {
            id: item.id,
            name: item.name,
            email: item.email,
            role: item.role,
            isSimulated: item.isSimulated,
            createdAt: now,
            updatedAt: now,
          },
        });
        result.push(record);
      }
      return result;
    },
    async deleteSimulated() {
      const res = await db.user.deleteMany({ where: { isSimulated: true } });
      return res.count;
    },
  };

  const events: EventRepository = {
    async findById(id) {
      return db.event.findUnique({ where: { id } });
    },
    async listAllOrderByCreatedDesc() {
      return db.event.findMany({ orderBy: { createdAt: 'desc' } });
    },
    async create(input) {
      return db.event.create({
        data: {
          name: input.name,
          description: input.description,
          startTime: input.startTime,
          endTime: input.endTime,
          capacity: input.capacity,
          maxPerUser: input.maxPerUser,
          confirmTimeoutSec: input.confirmTimeoutSec,
          createdById: input.createdById,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
    },
    async lockForUpdate(eventId) {
      // 事务首行自增 lockVersion 获取 PostgreSQL FOR NO KEY UPDATE 行级排他锁
      return db.event.update({
        where: { id: eventId },
        data: { lockVersion: { increment: 1 } },
      });
    },
    async lockAllForUpdateAsc() {
      const rows = await db.event.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const locked = [];
      for (const row of rows) {
        locked.push(
          await db.event.update({
            where: { id: row.id },
            data: { lockVersion: { increment: 1 } },
          }),
        );
      }
      return locked;
    },
    async adjustCounts(eventId, delta) {
      return db.event.update({
        where: { id: eventId },
        data: {
          ...(delta.confirmedDelta !== 0
            ? { confirmedCount: { increment: delta.confirmedDelta } }
            : {}),
          ...(delta.pendingDelta !== 0
            ? { pendingCount: { increment: delta.pendingDelta } }
            : {}),
        },
      });
    },
    async resetCounts(eventId) {
      return db.event.update({
        where: { id: eventId },
        data: { confirmedCount: 0, pendingCount: 0 },
      });
    },
    async deleteAll() {
      const res = await db.event.deleteMany();
      return res.count;
    },
  };

  const reservations: ReservationRepository = {
    async findById(id) {
      return db.reservation.findUnique({ where: { id } });
    },
    async findByIdWithUser(id) {
      return db.reservation.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
    },
    async findByIdempotencyKey(eventId, userId, idempotencyKey) {
      return db.reservation.findUnique({
        where: {
          eventId_userId_idempotencyKey: {
            eventId,
            userId,
            idempotencyKey,
          },
        },
      });
    },
    async countActiveByEventAndUser(eventId, userId) {
      return db.reservation.count({
        where: {
          eventId,
          userId,
          status: { in: [...ACTIVE_RESERVATION_STATUSES] },
        },
      });
    },
    async countWaitlistedByEvent(eventId) {
      return db.reservation.count({
        where: { eventId, status: 'WAITLISTED' },
      });
    },
    async countWaitlistedGroupByEvent() {
      const grouped = await db.reservation.groupBy({
        by: ['eventId'],
        where: { status: 'WAITLISTED' },
        _count: { _all: true },
      });
      const map = new Map<string, number>();
      for (const row of grouped) {
        map.set(row.eventId, row._count._all);
      }
      return map;
    },
    async countActualOccupiedGroupByEvent() {
      const grouped = await db.reservation.groupBy({
        by: ['eventId', 'status'],
        where: { status: { in: ['CONFIRMED', 'PENDING_CONFIRM'] } },
        _count: { _all: true },
      });
      const map = new Map<string, { confirmed: number; pending: number }>();
      for (const row of grouped) {
        const entry = map.get(row.eventId) ?? { confirmed: 0, pending: 0 };
        if (row.status === 'CONFIRMED') entry.confirmed = row._count._all;
        if (row.status === 'PENDING_CONFIRM') entry.pending = row._count._all;
        map.set(row.eventId, entry);
      }
      return map;
    },
    async countActualOccupiedByEvent(eventId) {
      const grouped = await db.reservation.groupBy({
        by: ['status'],
        where: {
          eventId,
          status: { in: ['CONFIRMED', 'PENDING_CONFIRM'] },
        },
        _count: { _all: true },
      });
      let confirmed = 0;
      let pending = 0;
      for (const row of grouped) {
        if (row.status === 'CONFIRMED') confirmed = row._count._all;
        if (row.status === 'PENDING_CONFIRM') pending = row._count._all;
      }
      return { confirmed, pending };
    },
    async findOverduePendingByEvent(eventId, now) {
      return db.reservation.findMany({
        where: {
          eventId,
          status: 'PENDING_CONFIRM',
          expiresAt: { lte: now },
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      });
    },
    async findOverdueEventIds(now) {
      // 使用 groupBy 确保 Prisma 下推 SQL GROUP BY，避免 distinct 客户端去重
      const grouped = await db.reservation.groupBy({
        by: ['eventId'],
        where: {
          status: 'PENDING_CONFIRM',
          expiresAt: { lte: now },
        },
        orderBy: { eventId: 'asc' },
      });
      return grouped.map((g) => g.eventId);
    },
    async findNextWaitlisted(eventId) {
      return db.reservation.findFirst({
        where: { eventId, status: 'WAITLISTED' },
        orderBy: [{ waitlistSeq: 'asc' }],
      });
    },
    async countWaitlistRank(eventId, waitlistSeq) {
      return db.reservation.count({
        where: {
          eventId,
          status: 'WAITLISTED',
          waitlistSeq: { lte: waitlistSeq },
        },
      });
    },
    async buildWaitlistRankMap(eventIds) {
      const uniqueIds = Array.from(new Set(eventIds));
      if (uniqueIds.length === 0) return new Map();

      const rows = await db.reservation.findMany({
        where: {
          eventId: { in: uniqueIds },
          status: 'WAITLISTED',
        },
        select: { id: true, eventId: true },
        orderBy: [{ eventId: 'asc' }, { waitlistSeq: 'asc' }],
      });

      const rankMap = new Map<string, number>();
      const counters = new Map<string, number>();
      for (const row of rows) {
        const nextRank = (counters.get(row.eventId) ?? 0) + 1;
        counters.set(row.eventId, nextRank);
        rankMap.set(row.id, nextRank);
      }
      return rankMap;
    },
    async findActiveByUser(userId) {
      return db.reservation.findMany({
        where: {
          userId,
          status: { in: [...ACTIVE_RESERVATION_STATUSES] },
        },
        orderBy: { updatedAt: 'desc' },
      });
    },
    async findByUserAndEvent(userId, eventId) {
      return db.reservation.findMany({
        where: { userId, eventId },
        orderBy: { updatedAt: 'desc' },
      });
    },
    async findByUserWithEvent(userId, statusFilter: MyReservationStatusFilter) {
      const where: Prisma.ReservationWhereInput = { userId };
      if (statusFilter === 'CLOSED') {
        where.status = { in: [...CLOSED_RESERVATION_STATUSES] };
      } else if (statusFilter !== 'ALL') {
        where.status = statusFilter;
      }

      return db.reservation.findMany({
        where,
        include: {
          event: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
              maxPerUser: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    },
    async findByEventWithUser(eventId, tab: AdminEventTab) {
      const where: Prisma.ReservationWhereInput = { eventId };
      if (tab === 'OCCUPIED') {
        where.status = { in: ['CONFIRMED', 'PENDING_CONFIRM'] };
      } else if (tab === 'WAITLISTED') {
        where.status = 'WAITLISTED';
      } else if (tab === 'CLOSED') {
        where.status = { in: [...CLOSED_RESERVATION_STATUSES] };
      }

      return db.reservation.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy:
          tab === 'WAITLISTED' ? [{ waitlistSeq: 'asc' }] : [{ updatedAt: 'desc' }],
      });
    },
    async create(input) {
      return db.reservation.create({
        data: {
          eventId: input.eventId,
          userId: input.userId,
          status: input.status,
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
          waitlistedAt: input.waitlistedAt,
          waitlistSeq: input.waitlistSeq,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
    },
    async markConfirmed(id, now) {
      return db.reservation.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          expiresAt: null,
          confirmedAt: now,
          updatedAt: now,
        },
      });
    },
    async markCancelled(id, now) {
      return db.reservation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          expiresAt: null,
          cancelledAt: now,
          updatedAt: now,
        },
      });
    },
    async markExpired(id, now) {
      return db.reservation.update({
        where: { id },
        data: {
          status: 'EXPIRED',
          expiresAt: null,
          expiredAt: now,
          updatedAt: now,
        },
      });
    },
    async markPromoted(id, expiresAt, now) {
      return db.reservation.update({
        where: { id },
        data: {
          status: 'PENDING_CONFIRM',
          expiresAt,
          updatedAt: now,
        },
      });
    },
    async deleteByEvent(eventId) {
      const res = await db.reservation.deleteMany({ where: { eventId } });
      return res.count;
    },
    async deleteAll() {
      const res = await db.reservation.deleteMany();
      return res.count;
    },
  };

  const auditLogs: AuditLogRepository = {
    async create(input) {
      await db.reservationAuditLog.create({
        data: {
          reservationId: input.reservationId,
          eventId: input.eventId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          trigger: input.trigger,
          actorId: input.actorId,
          note: input.note,
          createdAt: input.createdAt,
        },
      });
    },
    async findByReservationId(reservationId) {
      const rows = await db.reservationAuditLog.findMany({
        where: { reservationId },
        include: {
          actor: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        eventId: row.eventId,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        trigger: row.trigger,
        actorId: row.actorId,
        actorName: row.actor?.name ?? null,
        note: row.note,
        createdAt: row.createdAt,
      }));
    },
    async deleteByEvent(eventId) {
      const res = await db.reservationAuditLog.deleteMany({ where: { eventId } });
      return res.count;
    },
    async deleteAll() {
      const res = await db.reservationAuditLog.deleteMany();
      return res.count;
    },
  };

  return {
    users,
    events,
    reservations,
    auditLogs,
    seedInitialData: (now) => populateSeedData(db, now),
  };
}

/**
 * 基于 Prisma 交互式事务的 TransactionManager 实现。
 * 显式设置 `maxWait: 10_000, timeout: 10_000` 以支持 20 路并发排队通过行锁。
 */
export class PrismaTransactionManager implements TransactionManager {
  private readonly prisma: PrismaClient;
  private readonly maxWait: number;
  private readonly timeout: number;

  /**
   * 创建事务管理器实例。
   *
   * @param prisma PrismaClient 实例。
   * @param options 可选交互式事务超时配置（默认 `maxWait=10s`, `timeout=10s`）。
   */
  constructor(
    prisma: PrismaClient,
    options?: { maxWait?: number; timeout?: number },
  ) {
    this.prisma = prisma;
    this.maxWait = options?.maxWait ?? 10_000;
    this.timeout = options?.timeout ?? 10_000;
  }

  /**
   * 在单个 ACID 交互式事务内执行业务回调。
   *
   * @param work 接收事务级仓储集合的业务回调。
   * @returns 回调返回值。
   */
  async run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => work(createPrismaRepositories(tx)),
      { maxWait: this.maxWait, timeout: this.timeout },
    );
  }
}
