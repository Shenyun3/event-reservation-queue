/**
 * 可复用的 Seed 数据构建与写入模块（供 `prisma/seed.ts` 启动初始化与 `POST /api/admin/reset-seed` 共享）。
 */
import type { AuditTrigger, ReservationStatus, UserRole } from '@queue-reservation/shared';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';

/** 6 个常规模拟演示账号（5 User + 1 Admin）。 */
export const SEED_USERS: ReadonlyArray<{
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isSimulated: boolean;
}> = [
  { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'USER', isSimulated: false },
  { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'USER', isSimulated: false },
  { id: 'u3', name: 'Charlie', email: 'charlie@example.com', role: 'USER', isSimulated: false },
  { id: 'u4', name: 'Diana', email: 'diana@example.com', role: 'USER', isSimulated: false },
  { id: 'u5', name: 'Evan', email: 'evan@example.com', role: 'USER', isSimulated: false },
  { id: 'admin', name: 'Admin（运营管理员）', email: 'admin@example.com', role: 'ADMIN', isSimulated: false },
];

function addDaysAtUtcHour(base: Date, days: number, utcHour: number): Date {
  const target = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  target.setUTCHours(utcHour, 0, 0, 0);
  return target;
}

function offsetSec(base: Date, seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000);
}

/**
 * 向指定 Prisma 客户端或事务中写入完整的初始演示数据集（6 用户、2 活动、7 预约单、11 审计日志）。
 *
 * @param db PrismaClient 或交互式事务客户端 `Prisma.TransactionClient`。
 * @param now 基准时间（统一按此时刻相对计算未来活动时间窗与锁单倒计时）。
 * @returns 写入的用户数与活动数摘要。
 */
export async function populateSeedData(
  db: PrismaClient | Prisma.TransactionClient,
  now: Date,
): Promise<{ usersCount: number; eventsCount: number }> {
  for (const user of SEED_USERS) {
    await db.user.upsert({
      where: { id: user.id },
      update: {
        name: user.name,
        email: user.email,
        role: user.role,
        isSimulated: false,
      },
      create: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isSimulated: false,
        createdAt: offsetSec(now, -3600),
        updatedAt: offsetSec(now, -3600),
      },
    });
  }

  const t0 = offsetSec(now, -600);
  const t1 = offsetSec(now, -300);
  const t2 = offsetSec(now, -120);
  const t3 = offsetSec(now, -10);
  const t4 = offsetSec(now, -5);

  await db.event.createMany({
    data: [
      {
        id: 'evt-1',
        name: 'LINE FRIENDS 限量快闪店入场券',
        description: '热门限量线下主题快闪体验，凭确认后的预约凭证扫码入场。',
        startTime: addDaysAtUtcHour(now, 4, 2),
        endTime: addDaysAtUtcHour(now, 4, 10),
        capacity: 5,
        maxPerUser: 1,
        confirmTimeoutSec: 600,
        confirmedCount: 2,
        pendingCount: 1,
        lockVersion: 3,
        createdById: 'admin',
        createdAt: offsetSec(now, -1800),
        updatedAt: t2,
      },
      {
        id: 'evt-2',
        name: '2026 高并发架构线下沙龙',
        description: '一线架构师面对面交流，席位有限，满额后可登记候补。',
        startTime: addDaysAtUtcHour(now, 7, 6),
        endTime: addDaysAtUtcHour(now, 7, 9),
        capacity: 3,
        maxPerUser: 1,
        confirmTimeoutSec: 120,
        confirmedCount: 2,
        pendingCount: 1,
        lockVersion: 4,
        createdById: 'admin',
        createdAt: offsetSec(now, -1200),
        updatedAt: t4,
      },
    ],
  });

  const reservations: Array<{
    id: string;
    eventId: string;
    userId: string;
    status: ReservationStatus;
    idempotencyKey: string;
    expiresAt: Date | null;
    waitlistedAt: Date | null;
    waitlistSeq: number | null;
    confirmedAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [
    {
      id: 'res-101',
      eventId: 'evt-1',
      userId: 'u2',
      status: 'CONFIRMED',
      idempotencyKey: 'seed-res-101',
      expiresAt: null,
      waitlistedAt: null,
      waitlistSeq: null,
      confirmedAt: t1,
      cancelledAt: null,
      expiredAt: null,
      createdAt: t0,
      updatedAt: t1,
    },
    {
      id: 'res-102',
      eventId: 'evt-1',
      userId: 'u3',
      status: 'CONFIRMED',
      idempotencyKey: 'seed-res-102',
      expiresAt: null,
      waitlistedAt: null,
      waitlistSeq: null,
      confirmedAt: t1,
      cancelledAt: null,
      expiredAt: null,
      createdAt: t0,
      updatedAt: t1,
    },
    {
      id: 'res-103',
      eventId: 'evt-1',
      userId: 'u4',
      status: 'PENDING_CONFIRM',
      idempotencyKey: 'seed-res-103',
      expiresAt: offsetSec(now, 480),
      waitlistedAt: null,
      waitlistSeq: null,
      confirmedAt: null,
      cancelledAt: null,
      expiredAt: null,
      createdAt: t2,
      updatedAt: t2,
    },
    {
      id: 'res-104',
      eventId: 'evt-2',
      userId: 'u1',
      status: 'CONFIRMED',
      idempotencyKey: 'seed-res-104',
      expiresAt: null,
      waitlistedAt: null,
      waitlistSeq: null,
      confirmedAt: t1,
      cancelledAt: null,
      expiredAt: null,
      createdAt: t0,
      updatedAt: t1,
    },
    {
      id: 'res-105',
      eventId: 'evt-2',
      userId: 'u2',
      status: 'CONFIRMED',
      idempotencyKey: 'seed-res-105',
      expiresAt: null,
      waitlistedAt: null,
      waitlistSeq: null,
      confirmedAt: t1,
      cancelledAt: null,
      expiredAt: null,
      createdAt: t0,
      updatedAt: t1,
    },
    {
      id: 'res-106',
      eventId: 'evt-2',
      userId: 'u3',
      status: 'PENDING_CONFIRM',
      idempotencyKey: 'seed-res-106',
      expiresAt: offsetSec(now, 110),
      waitlistedAt: null,
      waitlistSeq: null,
      confirmedAt: null,
      cancelledAt: null,
      expiredAt: null,
      createdAt: t3,
      updatedAt: t3,
    },
    {
      id: 'res-107',
      eventId: 'evt-2',
      userId: 'u4',
      status: 'WAITLISTED',
      idempotencyKey: 'seed-res-107',
      expiresAt: null,
      waitlistedAt: t4,
      waitlistSeq: 4,
      confirmedAt: null,
      cancelledAt: null,
      expiredAt: null,
      createdAt: t4,
      updatedAt: t4,
    },
  ];

  await db.reservation.createMany({ data: reservations });

  const auditLogs: Array<{
    id: string;
    reservationId: string;
    eventId: string;
    fromStatus: ReservationStatus | null;
    toStatus: ReservationStatus;
    trigger: AuditTrigger;
    actorId: string;
    note: string;
    createdAt: Date;
  }> = [
    {
      id: 'log-1',
      reservationId: 'res-101',
      eventId: 'evt-1',
      fromStatus: null,
      toStatus: 'PENDING_CONFIRM',
      trigger: 'USER_ACTION',
      actorId: 'u2',
      note: '提交预约申请，名额已暂留，等待确认',
      createdAt: t0,
    },
    {
      id: 'log-2',
      reservationId: 'res-101',
      eventId: 'evt-1',
      fromStatus: 'PENDING_CONFIRM',
      toStatus: 'CONFIRMED',
      trigger: 'USER_ACTION',
      actorId: 'u2',
      note: '在有效期内完成预约确认',
      createdAt: t1,
    },
    {
      id: 'log-3',
      reservationId: 'res-102',
      eventId: 'evt-1',
      fromStatus: null,
      toStatus: 'PENDING_CONFIRM',
      trigger: 'USER_ACTION',
      actorId: 'u3',
      note: '提交预约申请，名额已暂留，等待确认',
      createdAt: t0,
    },
    {
      id: 'log-4',
      reservationId: 'res-102',
      eventId: 'evt-1',
      fromStatus: 'PENDING_CONFIRM',
      toStatus: 'CONFIRMED',
      trigger: 'USER_ACTION',
      actorId: 'u3',
      note: '在有效期内完成预约确认',
      createdAt: t1,
    },
    {
      id: 'log-5',
      reservationId: 'res-103',
      eventId: 'evt-1',
      fromStatus: null,
      toStatus: 'PENDING_CONFIRM',
      trigger: 'USER_ACTION',
      actorId: 'u4',
      note: '提交预约申请，名额已暂留，等待确认',
      createdAt: t2,
    },
    {
      id: 'log-6',
      reservationId: 'res-104',
      eventId: 'evt-2',
      fromStatus: null,
      toStatus: 'PENDING_CONFIRM',
      trigger: 'USER_ACTION',
      actorId: 'u1',
      note: '提交预约申请，名额已暂留，等待确认',
      createdAt: t0,
    },
    {
      id: 'log-7',
      reservationId: 'res-104',
      eventId: 'evt-2',
      fromStatus: 'PENDING_CONFIRM',
      toStatus: 'CONFIRMED',
      trigger: 'USER_ACTION',
      actorId: 'u1',
      note: '在有效期内完成预约确认',
      createdAt: t1,
    },
    {
      id: 'log-8',
      reservationId: 'res-105',
      eventId: 'evt-2',
      fromStatus: null,
      toStatus: 'PENDING_CONFIRM',
      trigger: 'USER_ACTION',
      actorId: 'u2',
      note: '提交预约申请，名额已暂留，等待确认',
      createdAt: t0,
    },
    {
      id: 'log-9',
      reservationId: 'res-105',
      eventId: 'evt-2',
      fromStatus: 'PENDING_CONFIRM',
      toStatus: 'CONFIRMED',
      trigger: 'USER_ACTION',
      actorId: 'u2',
      note: '在有效期内完成预约确认',
      createdAt: t1,
    },
    {
      id: 'log-10',
      reservationId: 'res-106',
      eventId: 'evt-2',
      fromStatus: null,
      toStatus: 'PENDING_CONFIRM',
      trigger: 'USER_ACTION',
      actorId: 'u3',
      note: '提交预约申请，名额已暂留，等待确认',
      createdAt: t3,
    },
    {
      id: 'log-11',
      reservationId: 'res-107',
      eventId: 'evt-2',
      fromStatus: null,
      toStatus: 'WAITLISTED',
      trigger: 'USER_ACTION',
      actorId: 'u4',
      note: '当前名额已满，已加入候补队列',
      createdAt: t4,
    },
  ];

  await db.reservationAuditLog.createMany({ data: auditLogs });

  return { usersCount: SEED_USERS.length, eventsCount: 2 };
}
