/**
 * 集成测试数据库辅助工具（独立测试库 DATABASE_URL_TEST 清理 + 每用例 4 条数据库不变量断言）。
 * 说明：resetTestDb 的 TRUNCATE 属于 backend/AGENTS.md 明确允许的测试夹具例外。
 */
import { expect } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.ts';
import { FakeClock } from '../../../src/lib/clock.ts';
import { loadEnv } from '../../../src/lib/env.ts';
import { createLogger } from '../../../src/lib/logger.ts';
import { createPrismaHandle, type PrismaHandle } from '../../../src/lib/prisma.ts';
import {
  createPrismaRepositories,
  PrismaTransactionManager,
} from '../../../src/repositories/prisma-repositories.ts';
import { createApp } from '../../../src/app.ts';

/**
 * 解析测试数据库连接串；禁止意外连到非测试库。
 *
 * @returns `DATABASE_URL_TEST` 连接串。
 */
export function getTestDatabaseUrl(): string {
  const env = loadEnv();
  const url = env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_TEST 未配置，拒绝在开发库上运行集成测试');
  }
  return url;
}

/**
 * 在每条集成测试前清空独立测试库中的全部业务表（RESTART IDENTITY CASCADE）。
 *
 * @param prisma 连接 `DATABASE_URL_TEST` 的 PrismaClient。
 */
export async function resetTestDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "reservation_audit_logs", "reservations", "events", "users" RESTART IDENTITY CASCADE',
  );
}

/**
 * 断言指定活动在任意已提交事务后严格满足全部 4 条核心数据库不变量。
 *
 * @param prisma PrismaClient 实例。
 * @param eventId 目标活动 ID。
 * @param now 当前测试时钟时刻（用于判断是否未截止）。
 */
export async function assertEventInvariants(
  prisma: PrismaClient,
  eventId: string,
  now: Date,
): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  expect(event, `Event ${eventId} should exist for invariant check`).not.toBeNull();
  if (!event) return;

  const [actualConfirmed, actualPending, actualWaitlisted] = await Promise.all([
    prisma.reservation.count({ where: { eventId, status: 'CONFIRMED' } }),
    prisma.reservation.count({ where: { eventId, status: 'PENDING_CONFIRM' } }),
    prisma.reservation.count({ where: { eventId, status: 'WAITLISTED' } }),
  ]);

  // 不变量 1 & 2：冗余计数与真实预约行数严格相等
  expect(event.confirmedCount).toBe(actualConfirmed);
  expect(event.pendingCount).toBe(actualPending);

  // 不变量 3：真实占座数不超过容量上限
  expect(actualConfirmed + actualPending).toBeLessThanOrEqual(event.capacity);

  // 不变量 4：活动未截止时，有余量则候补队列必为空（防插队不变量）
  if (now.getTime() < event.startTime.getTime()) {
    const remaining = event.capacity - actualConfirmed - actualPending;
    if (remaining > 0) {
      expect(actualWaitlisted).toBe(0);
    }
  }
}

/**
 * 创建集成测试上下文（包含连接测试库的 PrismaHandle、FakeClock 与 Hono app）。
 *
 * @param initialTime 可选假时钟初始时间。
 * @returns 测试上下文对象。
 */
export function createTestContext(initialTime: Date = new Date('2026-11-24T12:00:00.000Z')) {
  const handle: PrismaHandle = createPrismaHandle(getTestDatabaseUrl(), 30);
  const clock = new FakeClock(initialTime);
  const logger = createLogger('error');
  const repos = createPrismaRepositories(handle.prisma);
  const txManager = new PrismaTransactionManager(handle.prisma);
  let lastWorkerRunAt: Date | null = null;

  const app = createApp({
    clock,
    logger,
    repos,
    txManager,
    dbPoolMax: 30,
    workerEnabled: false,
    getLastWorkerRunAt: () => lastWorkerRunAt,
    onWorkerRun: (runAt) => {
      lastWorkerRunAt = runAt;
    },
    checkDbHealth: async () => {
      await handle.prisma.user.count();
      return true;
    },
  });

  return {
    handle,
    prisma: handle.prisma,
    clock,
    repos,
    txManager,
    app,
    setLastWorkerRunAt: (d: Date | null) => {
      lastWorkerRunAt = d;
    },
    close: () => handle.close(),
  };
}
