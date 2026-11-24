/**
 * P0 预约状态机全生命周期集成测试：
 * - 测试 #2：取消 CONFIRMED / PENDING_CONFIRM 触发 FIFO 转正 + USER/ADMIN 权限防泄露
 * - 测试 #3：惰性过期落库 + 409 RESERVATION_EXPIRED（含 confirm & cancel 及不回滚他人回收）
 * - 测试 #6：maxPerUser = 2 同用户多单流转（PENDING_CONFIRM + WAITLISTED）
 * - 测试 #7：EVENT_ENDED 截止边界（now >= startTime 拒绝新单、availabilityStatus=CLOSED、不再转正）
 */
import type {
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  CancelReservationResponse,
  PublicEventDto,
  ReservationAuditLogsResponse,
  ReservationDetailDto,
  UserEventDetailResponse,
} from '@queue-reservation/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertEventInvariants,
  createTestContext,
  resetTestDb,
} from './helpers/db.ts';

const BASE_TIME = new Date('2026-11-24T12:00:00.000Z');

describe('P0 lifecycle, lazy expiration, maxPerUser & EVENT_ENDED tests (#2, #3, #6, #7)', () => {
  const ctx = createTestContext(BASE_TIME);

  beforeEach(async () => {
    ctx.clock.set(BASE_TIME);
    await resetTestDb(ctx.prisma);
    await ctx.prisma.user.createMany({
      data: [
        { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' },
        { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'USER' },
        { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'USER' },
        { id: 'u3', name: 'Charlie', email: 'charlie@example.com', role: 'USER' },
        { id: 'u4', name: 'Diana', email: 'diana@example.com', role: 'USER' },
        { id: 'u5', name: 'Evan', email: 'evan@example.com', role: 'USER' },
      ],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('#2 promotes waitlist head in FIFO order on CONFIRMED/PENDING cancel and trims promotedReservation for USER', async () => {
    const now = ctx.clock.now();
    const event = await ctx.prisma.event.create({
      data: {
        id: 'evt-promo',
        name: '取消转正与 RBAC 防泄露测试活动',
        description: '',
        startTime: new Date(now.getTime() + 3600_000),
        endTime: new Date(now.getTime() + 7200_000),
        capacity: 2,
        maxPerUser: 1,
        confirmTimeoutSec: 300,
        createdById: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    });

    // u1 锁座并确认；u2 保持 PENDING_CONFIRM；u3、u4 按序候补
    const createFor = async (userId: string, key: string) => {
      const res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Idempotency-Key': key },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as ApiSuccessEnvelope<ReservationDetailDto>)
        .data;
    };

    const r1 = await createFor('u1', 'k1');
    const r2 = await createFor('u2', 'k2');
    const r3 = await createFor('u3', 'k3');
    const r4 = await createFor('u4', 'k4');

    expect(r1.status).toBe('PENDING_CONFIRM');
    expect(r2.status).toBe('PENDING_CONFIRM');
    expect(r3.status).toBe('WAITLISTED');
    expect(r3.waitlistRank).toBe(1);
    expect(r4.status).toBe('WAITLISTED');
    expect(r4.waitlistRank).toBe(2);

    // u1 确认 r1
    const confirmR1 = await ctx.app.request(
      `/api/reservations/${r1.id}/confirm`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(confirmR1.status).toBe(200);

    // 1) USER(u1) 取消 CONFIRMED 预约 -> 必须裁剪 promotedReservation 为 null，但 DB 中 u3 已 FIFO 转正
    const userCancelRes = await ctx.app.request(
      `/api/reservations/${r1.id}/cancel`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(userCancelRes.status).toBe(200);
    const userCancelBody =
      (await userCancelRes.json()) as ApiSuccessEnvelope<CancelReservationResponse>;
    expect(userCancelBody.data.reservation.status).toBe('CANCELLED');
    expect(userCancelBody.data.promotedReservation).toBeNull();

    const r3AfterUserCancel = await ctx.prisma.reservation.findUnique({
      where: { id: r3.id },
    });
    expect(r3AfterUserCancel?.status).toBe('PENDING_CONFIRM');
    expect(r3AfterUserCancel?.expiresAt).not.toBeNull();

    // 验证 u3 审计日志含 WAITLIST_PROMOTED
    const r3LogsRes = await ctx.app.request(
      `/api/reservations/${r3.id}/audit-logs`,
      { headers: { 'X-User-Id': 'u3' } },
    );
    expect(r3LogsRes.status).toBe(200);
    const r3Logs =
      (await r3LogsRes.json()) as ApiSuccessEnvelope<ReservationAuditLogsResponse>;
    expect(r3Logs.data.logs.map((l) => l.trigger)).toEqual([
      'USER_ACTION',
      'WAITLIST_PROMOTED',
    ]);

    // 2) ADMIN 强制取消 PENDING_CONFIRM(r2) -> 必须返回完整转正 DTO (u4)
    const adminCancelRes = await ctx.app.request(
      `/api/reservations/${r2.id}/cancel`,
      { method: 'POST', headers: { 'X-User-Id': 'admin' } },
    );
    expect(adminCancelRes.status).toBe(200);
    const adminCancelBody =
      (await adminCancelRes.json()) as ApiSuccessEnvelope<CancelReservationResponse>;
    expect(adminCancelBody.data.reservation.status).toBe('CANCELLED');
    expect(adminCancelBody.data.promotedReservation).not.toBeNull();
    expect(adminCancelBody.data.promotedReservation?.id).toBe(r4.id);
    expect(adminCancelBody.data.promotedReservation?.userId).toBe('u4');
    expect(adminCancelBody.data.promotedReservation?.userName).toBe('Diana');
    expect(adminCancelBody.data.promotedReservation?.userEmail).toBe(
      'diana@example.com',
    );
    expect(adminCancelBody.data.promotedReservation?.status).toBe(
      'PENDING_CONFIRM',
    );

    await assertEventInvariants(ctx.prisma, event.id, ctx.clock.now());
  });

  it('#3 lazily persists EXPIRED + waitlist promotion before returning 409 RESERVATION_EXPIRED on confirm & cancel', async () => {
    const now = ctx.clock.now();
    const event = await ctx.prisma.event.create({
      data: {
        id: 'evt-lazy-exp',
        name: '惰性过期落库与 409 测试活动',
        description: '',
        startTime: new Date(now.getTime() + 3600_000),
        endTime: new Date(now.getTime() + 7200_000),
        capacity: 2,
        maxPerUser: 1,
        confirmTimeoutSec: 60,
        createdById: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    });

    const book = async (userId: string, key: string) => {
      const res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Idempotency-Key': key },
      });
      return ((await res.json()) as ApiSuccessEnvelope<ReservationDetailDto>)
        .data;
    };

    const r1 = await book('u1', 'k1'); // expires at T + 60s
    ctx.clock.advanceSeconds(10);
    const r2 = await book('u2', 'k2'); // expires at T + 70s
    const r3 = await book('u3', 'k3'); // WAITLISTED #1
    const r4 = await book('u4', 'k4'); // WAITLISTED #2

    // 推进到恰好 now === r1.expiresAt（验证半开区间 expiresAt <= now 即过期）
    ctx.clock.set(new Date(r1.expiresAt!));

    // 对已过期的 r1 调用 confirm -> 409 RESERVATION_EXPIRED，且 DB 中 r1 已落库 EXPIRED、r3 已转正
    const expiredConfirmRes = await ctx.app.request(
      `/api/reservations/${r1.id}/confirm`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(expiredConfirmRes.status).toBe(409);
    expect(
      ((await expiredConfirmRes.json()) as ApiErrorEnvelope).error.code,
    ).toBe('RESERVATION_EXPIRED');

    const [r1Db, r3Db] = await Promise.all([
      ctx.prisma.reservation.findUnique({ where: { id: r1.id } }),
      ctx.prisma.reservation.findUnique({ where: { id: r3.id } }),
    ]);
    expect(r1Db?.status).toBe('EXPIRED');
    expect(r1Db?.expiresAt).toBeNull();
    expect(r1Db?.expiredAt?.toISOString()).toBe(ctx.clock.now().toISOString());
    expect(r3Db?.status).toBe('PENDING_CONFIRM');

    // 验证 r1 审计日志为 SYSTEM_TIMEOUT 且 actorId = null
    const r1LogsRes = await ctx.app.request(
      `/api/reservations/${r1.id}/audit-logs`,
      { headers: { 'X-User-Id': 'u1' } },
    );
    const r1Logs =
      (await r1LogsRes.json()) as ApiSuccessEnvelope<ReservationAuditLogsResponse>;
    const timeoutLog = r1Logs.data.logs.find(
      (l) => l.toStatus === 'EXPIRED',
    );
    expect(timeoutLog?.trigger).toBe('SYSTEM_TIMEOUT');
    expect(timeoutLog?.actorId).toBeNull();

    // 推进越过 r2.expiresAt，对已过期的 r2 调用 cancel -> 同样落库 EXPIRED + 转正 r4，返回 409 RESERVATION_EXPIRED
    ctx.clock.set(new Date(new Date(r2.expiresAt!).getTime() + 5000));
    const expiredCancelRes = await ctx.app.request(
      `/api/reservations/${r2.id}/cancel`,
      { method: 'POST', headers: { 'X-User-Id': 'u2' } },
    );
    expect(expiredCancelRes.status).toBe(409);
    expect(
      ((await expiredCancelRes.json()) as ApiErrorEnvelope).error.code,
    ).toBe('RESERVATION_EXPIRED');

    const [r2Db, r4Db] = await Promise.all([
      ctx.prisma.reservation.findUnique({ where: { id: r2.id } }),
      ctx.prisma.reservation.findUnique({ where: { id: r4.id } }),
    ]);
    expect(r2Db?.status).toBe('EXPIRED');
    expect(r2Db?.expiresAt).toBeNull();
    expect(r4Db?.status).toBe('PENDING_CONFIRM');

    // 再推进越过 r3.expiresAt，然后对已 EXPIRED 的 r1 发起无效 confirm -> 返回 INVALID_STATE_TRANSITION 且不能回滚同事务对 r3 的过期回收
    ctx.clock.set(new Date(r3Db!.expiresAt!.getTime() + 1000));
    const invalidConfirmRes = await ctx.app.request(
      `/api/reservations/${r1.id}/confirm`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(invalidConfirmRes.status).toBe(409);
    expect(
      ((await invalidConfirmRes.json()) as ApiErrorEnvelope).error.code,
    ).toBe('INVALID_STATE_TRANSITION');

    const r3AfterInvalid = await ctx.prisma.reservation.findUnique({
      where: { id: r3.id },
    });
    expect(r3AfterInvalid?.status).toBe('EXPIRED');

    await assertEventInvariants(ctx.prisma, event.id, ctx.clock.now());
  });

  it('#6 supports maxPerUser = 2 with independent PENDING_CONFIRM + WAITLISTED lifecycle for the same user', async () => {
    const now = ctx.clock.now();
    const event = await ctx.prisma.event.create({
      data: {
        id: 'evt-multi-2',
        name: '单人限购 2 份多单测试活动',
        description: '',
        startTime: new Date(now.getTime() + 3600_000),
        endTime: new Date(now.getTime() + 7200_000),
        capacity: 1,
        maxPerUser: 2,
        confirmTimeoutSec: 300,
        createdById: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    });

    // u1 第 1 单拿 PENDING_CONFIRM，第 2 单拿 WAITLISTED
    const r1Res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'multi-1' },
    });
    expect(r1Res.status).toBe(201);
    const r1 = (
      (await r1Res.json()) as ApiSuccessEnvelope<ReservationDetailDto>
    ).data;
    expect(r1.status).toBe('PENDING_CONFIRM');

    const r2Res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'multi-2' },
    });
    expect(r2Res.status).toBe(201);
    const r2 = (
      (await r2Res.json()) as ApiSuccessEnvelope<ReservationDetailDto>
    ).data;
    expect(r2.status).toBe('WAITLISTED');
    expect(r2.waitlistRank).toBe(1);

    // 第 3 单超出 maxPerUser = 2 -> 409 MAX_PER_USER_EXCEEDED
    const r3Res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'multi-3' },
    });
    expect(r3Res.status).toBe(409);
    expect(((await r3Res.json()) as ApiErrorEnvelope).error.code).toBe(
      'MAX_PER_USER_EXCEEDED',
    );

    // GET /api/events/:id (USER) 返回 u1 的全部 2 条活跃预约
    const detailRes = await ctx.app.request(`/api/events/${event.id}`, {
      headers: { 'X-User-Id': 'u1' },
    });
    expect(detailRes.status).toBe(200);
    const detail =
      (await detailRes.json()) as ApiSuccessEnvelope<UserEventDetailResponse>;
    expect(detail.data.myActiveReservations).toHaveLength(2);

    // u1 取消第 1 单 PENDING_CONFIRM -> u1 本人的第 2 单 WAITLISTED 自动转正为 PENDING_CONFIRM
    const cancelR1 = await ctx.app.request(
      `/api/reservations/${r1.id}/cancel`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(cancelR1.status).toBe(200);

    const r2Promoted = await ctx.prisma.reservation.findUnique({
      where: { id: r2.id },
    });
    expect(r2Promoted?.status).toBe('PENDING_CONFIRM');

    // u1 确认转正后的 r2，并可再申请 1 份候补单（此时活跃单数为 1 < maxPerUser=2）
    const confirmR2 = await ctx.app.request(
      `/api/reservations/${r2.id}/confirm`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(confirmR2.status).toBe(200);

    const r4Res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'multi-4' },
    });
    expect(r4Res.status).toBe(201);
    const r4 = (
      (await r4Res.json()) as ApiSuccessEnvelope<ReservationDetailDto>
    ).data;
    expect(r4.status).toBe('WAITLISTED');
    expect(r4.waitlistRank).toBe(1);

    // 取消候补单 r4 不影响已确认占座
    const cancelR4 = await ctx.app.request(
      `/api/reservations/${r4.id}/cancel`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(cancelR4.status).toBe(200);

    await assertEventInvariants(ctx.prisma, event.id, ctx.clock.now());
  });

  it('#7 enforces EVENT_ENDED cutoff at now >= startTime (clamps expiresAt, returns CLOSED, stops promotion)', async () => {
    const now = ctx.clock.now();
    // 距离开始仅 30 秒，但 confirmTimeoutSec = 300 -> expiresAt 必须被钳制到 startTime
    const startTime = new Date(now.getTime() + 30_000);
    const event = await ctx.prisma.event.create({
      data: {
        id: 'evt-cutoff',
        name: '活动截止边界测试活动',
        description: '',
        startTime,
        endTime: new Date(startTime.getTime() + 3600_000),
        capacity: 2,
        maxPerUser: 1,
        confirmTimeoutSec: 300,
        createdById: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    });

    const book = async (userId: string, key: string) => {
      const res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Idempotency-Key': key },
      });
      return { res, body: await res.json() };
    };

    const b1 = await book('u1', 'cut-1');
    const r1 = (b1.body as ApiSuccessEnvelope<ReservationDetailDto>).data;
    expect(r1.status).toBe('PENDING_CONFIRM');
    // 钳制断言：expiresAt === startTime
    expect(r1.expiresAt).toBe(startTime.toISOString());

    const b2 = await book('u2', 'cut-2');
    const r2 = (b2.body as ApiSuccessEnvelope<ReservationDetailDto>).data;
    await ctx.app.request(`/api/reservations/${r2.id}/confirm`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u2' },
    });

    const b3 = await book('u3', 'cut-3');
    const r3 = (b3.body as ApiSuccessEnvelope<ReservationDetailDto>).data;
    expect(r3.status).toBe('WAITLISTED');

    // 推进到 now === startTime（触发 EVENT_ENDED 与 r1 到期）
    ctx.clock.set(startTime);

    // 1) 新预约返回 409 EVENT_ENDED（且同事务惰性将 r1 置 EXPIRED，但不转正 r3）
    const b4 = await book('u4', 'cut-4');
    expect(b4.res.status).toBe(409);
    expect((b4.body as ApiErrorEnvelope).error.code).toBe('EVENT_ENDED');

    const [r1After, r3After] = await Promise.all([
      ctx.prisma.reservation.findUnique({ where: { id: r1.id } }),
      ctx.prisma.reservation.findUnique({ where: { id: r3.id } }),
    ]);
    expect(r1After?.status).toBe('EXPIRED');
    expect(r3After?.status).toBe('WAITLISTED');

    // 2) GET /api/events 与 GET /api/events/:id 中 availabilityStatus === 'CLOSED'
    const listRes = await ctx.app.request('/api/events', {
      headers: { 'X-User-Id': 'u4' },
    });
    const listBody =
      (await listRes.json()) as ApiSuccessEnvelope<PublicEventDto[]>;
    expect(listBody.data[0]?.availabilityStatus).toBe('CLOSED');

    // 3) 活动开始后取消已有 CONFIRMED 单(r2) 释放计数，但依然不触发候补转正
    const cancelR2 = await ctx.app.request(
      `/api/reservations/${r2.id}/cancel`,
      { method: 'POST', headers: { 'X-User-Id': 'admin' } },
    );
    expect(cancelR2.status).toBe(200);
    const cancelR2Body =
      (await cancelR2.json()) as ApiSuccessEnvelope<CancelReservationResponse>;
    expect(cancelR2Body.data.promotedReservation).toBeNull();

    const r3Final = await ctx.prisma.reservation.findUnique({
      where: { id: r3.id },
    });
    expect(r3Final?.status).toBe('WAITLISTED');

    await assertEventInvariants(ctx.prisma, event.id, ctx.clock.now());
  });
});
