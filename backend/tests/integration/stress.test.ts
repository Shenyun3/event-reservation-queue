/**
 * P1 并发压测与清空活动预约集成测试：
 * - RBAC 鉴权、404 活动不存在与 `min(25, dbPoolMax - 5)` 并发上限校验
 * - `DELETE /api/events/:eventId/reservations` 事务级清场与计数归零
 * - `POST /api/events/evt-1/simulate-burst`（20 并发抢 5 席）强一致无超卖与战报契约校验
 * - `GET /api/users` 虚拟压测用户隔离与活动已截止（`now >= startTime`）全量失败兜底
 */
import {
  ApiErrorEnvelopeSchema,
  ClearEventReservationsResponseSchema,
  ResponseMetaSchema,
  SimulateBurstResponseSchema,
  UserListResponseSchema,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
  type ClearEventReservationsResponse,
  type SimulateBurstResponse,
  type UserDto,
} from '@queue-reservation/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { createLogger } from '../../src/lib/logger.ts';
import {
  assertEventInvariants,
  createTestContext,
  resetTestDb,
} from './helpers/db.ts';

const BASE_TIME = new Date('2026-11-24T12:00:00.000Z');

describe('P1 stress test endpoints integration tests', () => {
  const ctx = createTestContext(BASE_TIME);

  beforeEach(async () => {
    ctx.clock.set(BASE_TIME);
    ctx.setLastWorkerRunAt(null);
    await resetTestDb(ctx.prisma);
    await ctx.txManager.run((repos) => repos.seedInitialData(ctx.clock.now()));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('enforces ADMIN-only RBAC, 404 EVENT_NOT_FOUND, and min(25, dbPoolMax - 5) validation', async () => {
    // 1) 未携带 X-User-Id -> 401 UNAUTHORIZED
    const noAuthClear = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'DELETE',
    });
    expect(noAuthClear.status).toBe(401);
    expect(
      ApiErrorEnvelopeSchema.parse(await noAuthClear.json()).error.code,
    ).toBe('UNAUTHORIZED');

    // 2) 非 ADMIN 调用清空与并发压测 -> 403 FORBIDDEN
    const userClear = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'DELETE',
      headers: { 'X-User-Id': 'u1' },
    });
    expect(userClear.status).toBe(403);
    expect(
      ((await userClear.json()) as ApiErrorEnvelope).error.code,
    ).toBe('FORBIDDEN');

    const userBurst = await ctx.app.request('/api/events/evt-1/simulate-burst', {
      method: 'POST',
      headers: {
        'X-User-Id': 'u1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ concurrency: 5 }),
    });
    expect(userBurst.status).toBe(403);
    expect(
      ((await userBurst.json()) as ApiErrorEnvelope).error.code,
    ).toBe('FORBIDDEN');

    // 3) 不存在活动 -> 404 EVENT_NOT_FOUND
    const missingClear = await ctx.app.request(
      '/api/events/evt-does-not-exist/reservations',
      {
        method: 'DELETE',
        headers: { 'X-User-Id': 'admin' },
      },
    );
    expect(missingClear.status).toBe(404);
    expect(
      ((await missingClear.json()) as ApiErrorEnvelope).error.code,
    ).toBe('EVENT_NOT_FOUND');

    const missingBurst = await ctx.app.request(
      '/api/events/evt-does-not-exist/simulate-burst',
      {
        method: 'POST',
        headers: {
          'X-User-Id': 'admin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ concurrency: 5 }),
      },
    );
    expect(missingBurst.status).toBe(404);
    expect(
      ((await missingBurst.json()) as ApiErrorEnvelope).error.code,
    ).toBe('EVENT_NOT_FOUND');

    // 4) 超出硬上限 25 或 <= 0 -> 400 VALIDATION_ERROR
    const overHardCap = await ctx.app.request(
      '/api/events/evt-1/simulate-burst',
      {
        method: 'POST',
        headers: {
          'X-User-Id': 'admin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ concurrency: 26 }),
      },
    );
    expect(overHardCap.status).toBe(400);
    expect(
      ((await overHardCap.json()) as ApiErrorEnvelope).error.code,
    ).toBe('VALIDATION_ERROR');

    const zeroConcurrency = await ctx.app.request(
      '/api/events/evt-1/simulate-burst',
      {
        method: 'POST',
        headers: {
          'X-User-Id': 'admin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ concurrency: 0 }),
      },
    );
    expect(zeroConcurrency.status).toBe(400);
    expect(
      ((await zeroConcurrency.json()) as ApiErrorEnvelope).error.code,
    ).toBe('VALIDATION_ERROR');

    // 5) 动态连接池上限校验：dbPoolMax = 15 时允许最大并发为 min(25, 15 - 5) = 10
    const constrainedApp = createApp({
      clock: ctx.clock,
      logger: createLogger('error'),
      repos: ctx.repos,
      txManager: ctx.txManager,
      dbPoolMax: 15,
      workerEnabled: false,
      getLastWorkerRunAt: () => null,
      checkDbHealth: async () => true,
    });

    const overPoolCap = await constrainedApp.request(
      '/api/events/evt-1/simulate-burst',
      {
        method: 'POST',
        headers: {
          'X-User-Id': 'admin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ concurrency: 11 }),
      },
    );
    expect(overPoolCap.status).toBe(400);
    expect(
      ((await overPoolCap.json()) as ApiErrorEnvelope).error.code,
    ).toBe('VALIDATION_ERROR');

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
  });

  it('clears event reservations and audit logs atomically and resets event counts to zero', async () => {
    const beforeEvt1ResCount = await ctx.prisma.reservation.count({
      where: { eventId: 'evt-1' },
    });
    const beforeEvt1LogCount = await ctx.prisma.reservationAuditLog.count({
      where: { eventId: 'evt-1' },
    });
    const beforeEvt2ResCount = await ctx.prisma.reservation.count({
      where: { eventId: 'evt-2' },
    });
    expect(beforeEvt1ResCount).toBeGreaterThan(0);
    expect(beforeEvt1LogCount).toBeGreaterThan(0);

    const res = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'DELETE',
      headers: { 'X-User-Id': 'admin' },
    });
    expect(res.status).toBe(200);

    const body =
      (await res.json()) as ApiSuccessEnvelope<ClearEventReservationsResponse>;
    const parsedData = ClearEventReservationsResponseSchema.parse(body.data);
    ResponseMetaSchema.parse(body.meta);
    expect(parsedData.deletedReservationsCount).toBe(beforeEvt1ResCount);

    const [evt1After, evt1ResAfter, evt1LogsAfter, evt2ResAfter] =
      await Promise.all([
        ctx.prisma.event.findUniqueOrThrow({ where: { id: 'evt-1' } }),
        ctx.prisma.reservation.count({ where: { eventId: 'evt-1' } }),
        ctx.prisma.reservationAuditLog.count({ where: { eventId: 'evt-1' } }),
        ctx.prisma.reservation.count({ where: { eventId: 'evt-2' } }),
      ]);

    expect(evt1After.confirmedCount).toBe(0);
    expect(evt1After.pendingCount).toBe(0);
    expect(evt1ResAfter).toBe(0);
    expect(evt1LogsAfter).toBe(0);
    // 确认未误删其他活动的预约数据
    expect(evt2ResAfter).toBe(beforeEvt2ResCount);

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
  });

  it('runs 20-way concurrent burst on evt-1 (capacity=5) with 5 pending, 15 waitlisted, zero oversell, and valid schema', async () => {
    const clearRes = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'DELETE',
      headers: { 'X-User-Id': 'admin' },
    });
    expect(clearRes.status).toBe(200);

    const burstRes = await ctx.app.request('/api/events/evt-1/simulate-burst', {
      method: 'POST',
      headers: {
        'X-User-Id': 'admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ concurrency: 20 }),
    });
    expect(burstRes.status).toBe(200);

    const envelope =
      (await burstRes.json()) as ApiSuccessEnvelope<SimulateBurstResponse>;
    ResponseMetaSchema.parse(envelope.meta);
    const data = SimulateBurstResponseSchema.parse(envelope.data);

    expect(data.summary.totalRequests).toBe(20);
    expect(data.summary.pendingCount).toBe(5);
    expect(data.summary.waitlistedCount).toBe(15);
    expect(data.summary.failedCount).toBe(0);
    expect(data.summary.oversold).toBe(false);

    expect(data.eventStatsAfter.capacity).toBe(5);
    expect(data.eventStatsAfter.confirmedCount).toBe(0);
    expect(data.eventStatsAfter.pendingCount).toBe(5);
    expect(data.eventStatsAfter.waitlistedCount).toBe(15);
    expect(data.eventStatsAfter.occupiedCount).toBe(5);
    expect(data.eventStatsAfter.remainingCapacity).toBe(0);
    expect(data.eventStatsAfter.oversold).toBe(false);

    expect(data.results).toHaveLength(20);
    expect(data.results.map((r) => r.index)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(data.results.every((r) => r.ok && r.reservation !== undefined)).toBe(
      true,
    );

    const pendingItems = data.results.filter(
      (r) => r.reservation?.status === 'PENDING_CONFIRM',
    );
    const waitlistedItems = data.results.filter(
      (r) => r.reservation?.status === 'WAITLISTED',
    );
    expect(pendingItems).toHaveLength(5);
    expect(waitlistedItems).toHaveLength(15);
    expect(pendingItems.every((r) => r.waitlistRank === null)).toBe(true);

    // 验证候补顺位为严格 1..15 且与 reservation.waitlistRank 保持一致
    const ranks = waitlistedItems
      .map((r) => r.waitlistRank)
      .filter((rank): rank is number => typeof rank === 'number')
      .sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(
      waitlistedItems.every(
        (r) => r.waitlistRank === r.reservation?.waitlistRank,
      ),
    ).toBe(true);

    // 验证每笔压测预约均落盘了初始审计日志
    const auditLogCount = await ctx.prisma.reservationAuditLog.count({
      where: { eventId: 'evt-1' },
    });
    expect(auditLogCount).toBe(20);

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
  });

  it('hides simulated burst users from GET /api/users and returns 20 failed items when event has already started', async () => {
    // 1) 清空并压测 evt-1
    const clear1 = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'DELETE',
      headers: { 'X-User-Id': 'admin' },
    });
    expect(clear1.status).toBe(200);

    const burst1 = await ctx.app.request('/api/events/evt-1/simulate-burst', {
      method: 'POST',
      headers: {
        'X-User-Id': 'admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ concurrency: 20 }),
    });
    expect(burst1.status).toBe(200);

    // 2) GET /api/users 默认仅返回 6 个 isSimulated=false 常规用户，绝不泄露压测虚拟用户
    const usersRes = await ctx.app.request('/api/users');
    expect(usersRes.status).toBe(200);
    const usersBody = (await usersRes.json()) as ApiSuccessEnvelope<UserDto[]>;
    const users = UserListResponseSchema.parse(usersBody.data);
    expect(users).toHaveLength(6);
    expect(users.every((u) => u.isSimulated === false)).toBe(true);

    const allUsersRes = await ctx.app.request('/api/users?includeSimulated=true');
    expect(allUsersRes.status).toBe(200);
    const allUsersBody =
      (await allUsersRes.json()) as ApiSuccessEnvelope<UserDto[]>;
    expect(UserListResponseSchema.parse(allUsersBody.data)).toHaveLength(26);

    // 3) FakeClock 推进到 now >= startTime 后清空再压测，20 笔均返回 ok: false 且零超卖
    const evt1 = await ctx.prisma.event.findUniqueOrThrow({
      where: { id: 'evt-1' },
    });
    ctx.clock.set(new Date(evt1.startTime.getTime()));

    const clear2 = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'DELETE',
      headers: { 'X-User-Id': 'admin' },
    });
    expect(clear2.status).toBe(200);

    const endedBurstRes = await ctx.app.request(
      '/api/events/evt-1/simulate-burst',
      {
        method: 'POST',
        headers: {
          'X-User-Id': 'admin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ concurrency: 20 }),
      },
    );
    expect(endedBurstRes.status).toBe(200);

    const endedEnvelope =
      (await endedBurstRes.json()) as ApiSuccessEnvelope<SimulateBurstResponse>;
    const endedData = SimulateBurstResponseSchema.parse(endedEnvelope.data);

    expect(endedData.summary.totalRequests).toBe(20);
    expect(endedData.summary.pendingCount).toBe(0);
    expect(endedData.summary.waitlistedCount).toBe(0);
    expect(endedData.summary.failedCount).toBe(20);
    expect(endedData.summary.oversold).toBe(false);
    expect(endedData.eventStatsAfter.oversold).toBe(false);
    expect(endedData.eventStatsAfter.occupiedCount).toBe(0);
    expect(
      endedData.results.every(
        (r) => !r.ok && typeof r.error === 'string' && r.error.length > 0,
      ),
    ).toBe(true);

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
  });
});
