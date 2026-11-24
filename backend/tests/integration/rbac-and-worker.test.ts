/**
 * P0 RBAC 权限隔离、多活动超时巡检 Worker、优雅停机与 Reset-Seed 集成测试（测试 #8）。
 */
import {
  AdminEventListResponseSchema,
  ApiErrorEnvelopeSchema,
  CancelReservationResponseSchema,
  EventDetailResponseSchema,
  ExpireWorkerResponseSchema,
  HealthResponseSchema,
  MyReservationsResponseSchema,
  ReservationAuditLogsResponseSchema,
  ReservationDetailDtoSchema,
  ResetSeedResponseSchema,
  ResponseMetaSchema,
  UserEventListResponseSchema,
  UserListResponseSchema,
  type AdminEventDto,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
  type ExpireWorkerResponse,
  type HealthResponse,
  type MyReservationsResponse,
  type ReservationDetailDto,
  type ResetSeedResponse,
  type UserDto,
} from '@queue-reservation/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.ts';
import type { TransactionManager } from '../../src/repositories/types.ts';
import { ReservationService } from '../../src/services/reservation-service.ts';
import { ExpirationWorker } from '../../src/worker/expiration-worker.ts';
import {
  assertEventInvariants,
  createTestContext,
  resetTestDb,
} from './helpers/db.ts';

const BASE_TIME = new Date('2026-11-24T12:00:00.000Z');

describe('P0 RBAC isolation, worker expiration sweep & reset-seed tests (#8)', () => {
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

  it('#8 enforces auth headers, USER field trimming, RBAC guards, and GET /api/users filtering', async () => {
    // 1) 缺失 X-User-Id -> 401 UNAUTHORIZED；不存在用户 -> 401 USER_NOT_FOUND
    const noAuth = await ctx.app.request('/api/events');
    expect(noAuth.status).toBe(401);
    expect(((await noAuth.json()) as ApiErrorEnvelope).error.code).toBe(
      'UNAUTHORIZED',
    );

    const unknownUser = await ctx.app.request('/api/events', {
      headers: { 'X-User-Id': 'ghost-user' },
    });
    expect(unknownUser.status).toBe(401);
    expect(((await unknownUser.json()) as ApiErrorEnvelope).error.code).toBe(
      'USER_NOT_FOUND',
    );

    // 2) GET /api/users 默认过滤 isSimulated=true
    await ctx.prisma.user.create({
      data: {
        id: 'sim-1-1',
        name: '并发用户 #01',
        email: 'sim-1-1@sim.local',
        role: 'USER',
        isSimulated: true,
      },
    });
    const usersDefaultRes = await ctx.app.request('/api/users');
    expect(usersDefaultRes.status).toBe(200);
    const usersDefault =
      (await usersDefaultRes.json()) as ApiSuccessEnvelope<UserDto[]>;
    expect(usersDefault.data).toHaveLength(6);
    expect(usersDefault.data.every((u) => !u.isSimulated)).toBe(true);

    const usersAllRes = await ctx.app.request(
      '/api/users?includeSimulated=true',
    );
    const usersAll =
      (await usersAllRes.json()) as ApiSuccessEnvelope<UserDto[]>;
    expect(usersAll.data).toHaveLength(7);

    // 3) USER 调用活动列表与活动详情：严禁泄露敏感运营字段
    const forbiddenFields = [
      'capacity',
      'confirmedCount',
      'pendingCount',
      'waitlistedCount',
      'remainingCapacity',
      'confirmTimeoutSec',
      'stats',
      'lockVersion',
    ];
    const userEventsRes = await ctx.app.request('/api/events', {
      headers: { 'X-User-Id': 'u1' },
    });
    expect(userEventsRes.status).toBe(200);
    const userEvents = (await userEventsRes.json()) as ApiSuccessEnvelope<
      Array<Record<string, unknown>>
    >;
    expect(userEvents.meta?.total).toBe(2);
    for (const item of userEvents.data) {
      for (const field of forbiddenFields) {
        expect(item).not.toHaveProperty(field);
      }
      expect(Array.isArray(item.myActiveReservations)).toBe(true);
    }

    const userDetailRes = await ctx.app.request('/api/events/evt-2', {
      headers: { 'X-User-Id': 'u1' },
    });
    expect(userDetailRes.status).toBe(200);
    const userDetail = (await userDetailRes.json()) as ApiSuccessEnvelope<{
      roleView: string;
      event: Record<string, unknown>;
    }>;
    expect(userDetail.data.roleView).toBe('USER');
    for (const field of forbiddenFields) {
      expect(userDetail.data.event).not.toHaveProperty(field);
    }

    // 4) USER 调用 Admin 接口返回 403 FORBIDDEN
    const userCreateEvent = await ctx.app.request('/api/events', {
      method: 'POST',
      headers: {
        'X-User-Id': 'u1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Unauthorized Event',
        startTime: '2026-12-01T10:00:00.000Z',
        endTime: '2026-12-01T12:00:00.000Z',
        capacity: 10,
      }),
    });
    expect(userCreateEvent.status).toBe(403);
    expect(((await userCreateEvent.json()) as ApiErrorEnvelope).error.code).toBe(
      'FORBIDDEN',
    );

    const userExpire = await ctx.app.request('/api/admin/worker/expire', {
      method: 'POST',
      headers: { 'X-User-Id': 'u1' },
    });
    expect(userExpire.status).toBe(403);

    const userReset = await ctx.app.request('/api/admin/reset-seed', {
      method: 'POST',
      headers: { 'X-User-Id': 'u1' },
    });
    expect(userReset.status).toBe(403);

    // 5) USER 越权操作他人预约（res-103 归属 u4）返回 403
    const otherConfirm = await ctx.app.request('/api/reservations/res-103/confirm', {
      method: 'POST',
      headers: { 'X-User-Id': 'u1' },
    });
    expect(otherConfirm.status).toBe(403);

    const otherCancel = await ctx.app.request('/api/reservations/res-103/cancel', {
      method: 'POST',
      headers: { 'X-User-Id': 'u1' },
    });
    expect(otherCancel.status).toBe(403);

    const otherLogs = await ctx.app.request('/api/reservations/res-103/audit-logs', {
      headers: { 'X-User-Id': 'u1' },
    });
    expect(otherLogs.status).toBe(403);

    // 6) ADMIN 禁止作为 C 端下单或调用 /api/reservations/me
    const adminBook = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'POST',
      headers: { 'X-User-Id': 'admin', 'Idempotency-Key': 'admin-try-book' },
    });
    expect(adminBook.status).toBe(403);
    expect(((await adminBook.json()) as ApiErrorEnvelope).error.code).toBe(
      'FORBIDDEN',
    );

    const adminMe = await ctx.app.request('/api/reservations/me', {
      headers: { 'X-User-Id': 'admin' },
    });
    expect(adminMe.status).toBe(403);

    // 7) ADMIN 创建活动 & 代确认他人预约成功
    const adminCreate = await ctx.app.request('/api/events', {
      method: 'POST',
      headers: {
        'X-User-Id': 'admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: '管理员新建活动',
        description: '支持双份预约',
        startTime: '2026-12-05T10:00:00.000Z',
        endTime: '2026-12-05T14:00:00.000Z',
        capacity: 10,
        maxPerUser: 2,
        confirmTimeoutSec: 120,
      }),
    });
    expect(adminCreate.status).toBe(201);
    const createdEvent = (
      (await adminCreate.json()) as ApiSuccessEnvelope<AdminEventDto>
    ).data;
    expect(createdEvent.createdById).toBe('admin');
    expect(createdEvent.stats.remainingCapacity).toBe(10);

    const adminConfirmForU4 = await ctx.app.request(
      '/api/reservations/res-103/confirm',
      { method: 'POST', headers: { 'X-User-Id': 'admin' } },
    );
    expect(adminConfirmForU4.status).toBe(200);
    expect(
      ((await adminConfirmForU4.json()) as ApiSuccessEnvelope<ReservationDetailDto>)
        .data.status,
    ).toBe('CONFIRMED');

    // 8) GET /api/reservations/me 状态过滤（CLOSED 等价于 CANCELLED | EXPIRED）
    const meAllRes = await ctx.app.request('/api/reservations/me?status=ALL', {
      headers: { 'X-User-Id': 'u4' },
    });
    expect(meAllRes.status).toBe(200);
    const meAll =
      (await meAllRes.json()) as ApiSuccessEnvelope<MyReservationsResponse>;
    expect(meAll.data).toHaveLength(2);
    expect(
      meAll.data.find((r) => r.id === 'res-107')?.waitlistRank,
    ).toBe(1);

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, createdEvent.id, ctx.clock.now());
  });

  it('#8 sweeps multiple overdue events via POST /api/admin/worker/expire, updates lastWorkerRunAt, and resets seed cleanly', async () => {
    // 推进 500 秒：evt-1 的 res-103 (剩480s) 与 evt-2 的 res-106 (剩110s) 均超时
    ctx.clock.advanceSeconds(500);

    const expireRes = await ctx.app.request('/api/admin/worker/expire', {
      method: 'POST',
      headers: { 'X-User-Id': 'admin' },
    });
    expect(expireRes.status).toBe(200);
    const expireBody =
      (await expireRes.json()) as ApiSuccessEnvelope<ExpireWorkerResponse>;
    expect(expireBody.data.expiredCount).toBe(2);
    expect(expireBody.data.promotedCount).toBe(1); // evt-2 的 res-107 (Diana) 转正
    expect(expireBody.data.lastWorkerRunAt).toBe(ctx.clock.now().toISOString());

    const [res103, res106, res107] = await Promise.all([
      ctx.prisma.reservation.findUnique({ where: { id: 'res-103' } }),
      ctx.prisma.reservation.findUnique({ where: { id: 'res-106' } }),
      ctx.prisma.reservation.findUnique({ where: { id: 'res-107' } }),
    ]);
    expect(res103?.status).toBe('EXPIRED');
    expect(res106?.status).toBe('EXPIRED');
    expect(res107?.status).toBe('PENDING_CONFIRM');

    // /api/health 与 /api/events meta 均反映最新 lastWorkerRunAt
    const healthRes = await ctx.app.request('/api/health');
    const health =
      (await healthRes.json()) as ApiSuccessEnvelope<HealthResponse>;
    expect(health.data.lastWorkerRunAt).toBe(ctx.clock.now().toISOString());

    const adminEventsRes = await ctx.app.request('/api/events', {
      headers: { 'X-User-Id': 'admin' },
    });
    const adminEvents =
      (await adminEventsRes.json()) as ApiSuccessEnvelope<AdminEventDto[]>;
    expect(adminEvents.meta?.lastWorkerRunAt).toBe(
      ctx.clock.now().toISOString(),
    );

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());

    // 测试 reset-seed：先塞入虚拟用户再重置，验证虚拟用户被清且数据回到初始 Seed
    await ctx.prisma.user.create({
      data: {
        id: 'sim-cleanup-1',
        name: '并发用户 #01',
        email: 'sim-cleanup-1@sim.local',
        role: 'USER',
        isSimulated: true,
      },
    });
    const resetRes = await ctx.app.request('/api/admin/reset-seed', {
      method: 'POST',
      headers: { 'X-User-Id': 'admin' },
    });
    expect(resetRes.status).toBe(200);
    const resetBody =
      (await resetRes.json()) as ApiSuccessEnvelope<ResetSeedResponse>;
    expect(resetBody.data).toEqual({
      reset: true,
      eventsCount: 2,
      usersCount: 6,
    });

    const simCount = await ctx.prisma.user.count({
      where: { isSimulated: true },
    });
    expect(simCount).toBe(0);
    const res106Reset = await ctx.prisma.reservation.findUnique({
      where: { id: 'res-106' },
    });
    expect(res106Reset?.status).toBe('PENDING_CONFIRM');

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
  });

  it('#8 verifies ExpirationWorker re-entrancy guard and graceful stop()', async () => {
    let calls = 0;
    let releaseFirstRun!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    const worker = new ExpirationWorker({
      logger: createLogger('error'),
      intervalMs: 10_000,
      runExpire: async () => {
        calls += 1;
        await firstRunGate;
        return {
          expiredCount: 1,
          promotedCount: 0,
          lastWorkerRunAt: BASE_TIME.toISOString(),
        };
      },
    });

    const run1 = worker.runOnce();
    const run2 = worker.runOnce(); // 应被 isRunning 防重入锁跳过
    expect(await run2).toBeNull();
    expect(calls).toBe(1);

    let stopResolved = false;
    const stopPromise = worker.stop().then(() => {
      stopResolved = true;
    });
    // 当前轮次未结束前 stop() 必须持续等待
    await Promise.resolve();
    expect(stopResolved).toBe(false);

    releaseFirstRun();
    const res1 = await run1;
    await stopPromise;

    expect(stopResolved).toBe(true);
    expect(res1?.expiredCount).toBe(1);
    expect(worker.getLastRunAt()?.toISOString()).toBe(BASE_TIME.toISOString());

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
  });

  it('#8 validates all P0 response envelopes against shared Zod schemas, error mappings, and P2002 discriminator', async () => {
    // 1) 校验全量 P0 响应体与 @queue-reservation/shared Zod Schema 100% 一致
    const healthJson = (await (
      await ctx.app.request('/api/health')
    ).json()) as ApiSuccessEnvelope<unknown>;
    HealthResponseSchema.parse(healthJson.data);
    ResponseMetaSchema.parse(healthJson.meta);

    const usersJson = (await (
      await ctx.app.request('/api/users')
    ).json()) as ApiSuccessEnvelope<unknown>;
    UserListResponseSchema.parse(usersJson.data);
    ResponseMetaSchema.parse(usersJson.meta);

    const userEventsJson = (await (
      await ctx.app.request('/api/events', { headers: { 'X-User-Id': 'u1' } })
    ).json()) as ApiSuccessEnvelope<unknown>;
    UserEventListResponseSchema.parse(userEventsJson.data);
    ResponseMetaSchema.parse(userEventsJson.meta);

    const adminEventsJson = (await (
      await ctx.app.request('/api/events', { headers: { 'X-User-Id': 'admin' } })
    ).json()) as ApiSuccessEnvelope<unknown>;
    AdminEventListResponseSchema.parse(adminEventsJson.data);
    ResponseMetaSchema.parse(adminEventsJson.meta);

    const userDetailJson = (await (
      await ctx.app.request('/api/events/evt-1', {
        headers: { 'X-User-Id': 'u1' },
      })
    ).json()) as ApiSuccessEnvelope<unknown>;
    EventDetailResponseSchema.parse(userDetailJson.data);

    const adminDetailJson = (await (
      await ctx.app.request('/api/events/evt-1?tab=OCCUPIED', {
        headers: { 'X-User-Id': 'admin' },
      })
    ).json()) as ApiSuccessEnvelope<unknown>;
    EventDetailResponseSchema.parse(adminDetailJson.data);

    const bookRes = await ctx.app.request('/api/events/evt-1/reservations', {
      method: 'POST',
      headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'schema-check-1' },
    });
    expect(bookRes.status).toBe(201);
    const bookJson = (await bookRes.json()) as ApiSuccessEnvelope<ReservationDetailDto>;
    ReservationDetailDtoSchema.parse(bookJson.data);
    ResponseMetaSchema.parse(bookJson.meta);

    const auditJson = (await (
      await ctx.app.request(`/api/reservations/${bookJson.data.id}/audit-logs`, {
        headers: { 'X-User-Id': 'u1' },
      })
    ).json()) as ApiSuccessEnvelope<unknown>;
    ReservationAuditLogsResponseSchema.parse(auditJson.data);

    const cancelJson = (await (
      await ctx.app.request(`/api/reservations/${bookJson.data.id}/cancel`, {
        method: 'POST',
        headers: { 'X-User-Id': 'u1' },
      })
    ).json()) as ApiSuccessEnvelope<unknown>;
    CancelReservationResponseSchema.parse(cancelJson.data);

    // 校验 GET /api/reservations/me?status=CLOSED 仅返回 CANCELLED | EXPIRED
    const meClosedJson = (await (
      await ctx.app.request('/api/reservations/me?status=CLOSED', {
        headers: { 'X-User-Id': 'u1' },
      })
    ).json()) as ApiSuccessEnvelope<MyReservationsResponse>;
    MyReservationsResponseSchema.parse(meClosedJson.data);
    expect(meClosedJson.data).toHaveLength(1);
    expect(meClosedJson.data[0]?.status).toBe('CANCELLED');

    const expireJson = (await (
      await ctx.app.request('/api/admin/worker/expire', {
        method: 'POST',
        headers: { 'X-User-Id': 'admin' },
      })
    ).json()) as ApiSuccessEnvelope<unknown>;
    ExpireWorkerResponseSchema.parse(expireJson.data);

    const resetJson = (await (
      await ctx.app.request('/api/admin/reset-seed', {
        method: 'POST',
        headers: { 'X-User-Id': 'admin' },
      })
    ).json()) as ApiSuccessEnvelope<unknown>;
    ResetSeedResponseSchema.parse(resetJson.data);

    // 2) 不存在的活动发起预约 -> P2025 映射为 404 EVENT_NOT_FOUND
    const missingEvtRes = await ctx.app.request(
      '/api/events/evt-nonexistent/reservations',
      {
        method: 'POST',
        headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'k-missing' },
      },
    );
    expect(missingEvtRes.status).toBe(404);
    const missingEvtErr = ApiErrorEnvelopeSchema.parse(
      await missingEvtRes.json(),
    );
    expect(missingEvtErr.error.code).toBe('EVENT_NOT_FOUND');

    // 3) 非法 JSON 与非法时间窗 -> 400 VALIDATION_ERROR
    const badJsonRes = await ctx.app.request('/api/events', {
      method: 'POST',
      headers: {
        'X-User-Id': 'admin',
        'Content-Type': 'application/json',
      },
      body: '{invalid-json',
    });
    expect(badJsonRes.status).toBe(400);
    expect(
      ApiErrorEnvelopeSchema.parse(await badJsonRes.json()).error.code,
    ).toBe('VALIDATION_ERROR');

    const badWindowRes = await ctx.app.request('/api/events', {
      method: 'POST',
      headers: {
        'X-User-Id': 'admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Bad Time Window',
        startTime: '2026-12-05T14:00:00.000Z',
        endTime: '2026-12-05T10:00:00.000Z',
        capacity: 5,
      }),
    });
    expect(badWindowRes.status).toBe(400);
    expect(
      ApiErrorEnvelopeSchema.parse(await badWindowRes.json()).error.code,
    ).toBe('VALIDATION_ERROR');

    // 4) Re-review P2-1：txManager.run 外部仅在命中幂等唯一键 P2002 时重放，其他 P2002（如 waitlist_seq）原样抛出
    const u2 = await ctx.repos.users.findById('u2');
    expect(u2).not.toBeNull();

    const idempotencyP2002Tx: TransactionManager = {
      async run() {
        const err = Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: {
            driverAdapterError: {
              cause: {
                constraint: {
                  index: 'reservations_event_id_user_id_idempotency_key_key',
                },
              },
            },
          },
        });
        throw err;
      },
    };
    const svcIdem = new ReservationService({
      repos: ctx.repos,
      txManager: idempotencyP2002Tx,
      clock: ctx.clock,
      logger: createLogger('error'),
    });
    const replayed = await svcIdem.createReservation(
      u2!,
      'evt-1',
      'seed-res-101',
    );
    expect(replayed.idempotentReplay).toBe(true);
    expect(replayed.reservation.id).toBe('res-101');

    const waitlistP2002Tx: TransactionManager = {
      async run() {
        const err = Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: {
            driverAdapterError: {
              cause: {
                constraint: {
                  index: 'reservations_event_id_waitlist_seq_key',
                },
              },
            },
          },
        });
        throw err;
      },
    };
    const svcNonIdem = new ReservationService({
      repos: ctx.repos,
      txManager: waitlistP2002Tx,
      clock: ctx.clock,
      logger: createLogger('error'),
    });
    await expect(
      svcNonIdem.createReservation(u2!, 'evt-1', 'seed-res-101'),
    ).rejects.toThrow('Unique constraint failed');

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
  });

  it('isolates single-event transaction failures during expireOverdueReservations so other events and lastWorkerRunAt still complete', async () => {
    // 推进时钟使 evt-1 (res-103 剩 480s) 与 evt-2 (res-106 剩 110s) 均超时
    ctx.clock.advanceSeconds(600);

    let firstAttemptFailed = false;
    let recordedRunAt: Date | null = null;
    const flakyTxManager: TransactionManager = {
      async run(work) {
        if (!firstAttemptFailed) {
          firstAttemptFailed = true;
          throw Object.assign(new Error('Transaction timeout'), { code: 'P2028' });
        }
        return ctx.txManager.run(work);
      },
    };

    const svc = new ReservationService({
      repos: ctx.repos,
      txManager: flakyTxManager,
      clock: ctx.clock,
      logger: createLogger('error'),
      onWorkerRun: (runAt) => {
        recordedRunAt = runAt;
      },
    });

    const result = await svc.expireOverdueReservations();
    expect(result.expiredCount).toBe(1);
    expect(result.promotedCount).toBe(1);
    expect(recordedRunAt).not.toBeNull();
    expect(result.lastWorkerRunAt).toBe(ctx.clock.now().toISOString());

    // evt-1 首次模拟 P2028 失败后保持原状，evt-2 仍被正常回收并触发 res-107 转正
    const res103 = await ctx.prisma.reservation.findUnique({ where: { id: 'res-103' } });
    const res106 = await ctx.prisma.reservation.findUnique({ where: { id: 'res-106' } });
    const res107 = await ctx.prisma.reservation.findUnique({ where: { id: 'res-107' } });
    expect(res103?.status).toBe('PENDING_CONFIRM');
    expect(res106?.status).toBe('EXPIRED');
    expect(res107?.status).toBe('PENDING_CONFIRM');

    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
  });
});
