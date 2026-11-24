/**
 * P0 高并发强一致与幂等集成测试：
 * - 测试 #1：20 人并发抢 5 席防超卖 + 严格单调 waitlistSeq
 * - 测试 #4：同一确认单并发 cancel × 2 防 TOCTOU
 * - 测试 #5：maxPerUser=1 严格幂等双击 + 确认/取消/截止后重放返回最新状态
 */
import type {
  AdminEventDetailResponse,
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  CancelReservationResponse,
  ReservationDetailDto,
} from '@queue-reservation/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertEventInvariants,
  createTestContext,
  resetTestDb,
} from './helpers/db.ts';

const BASE_TIME = new Date('2026-11-24T12:00:00.000Z');

describe('P0 concurrency & idempotency integration tests (#1, #4, #5)', () => {
  const ctx = createTestContext(BASE_TIME);

  beforeEach(async () => {
    ctx.clock.set(BASE_TIME);
    await resetTestDb(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('#1 prevents overselling under 20 concurrent requests for 5 seats with strict monotonic waitlistSeq', async () => {
    const now = ctx.clock.now();
    await ctx.prisma.user.create({
      data: {
        id: 'admin',
        name: 'Admin',
        email: 'admin@example.com',
        role: 'ADMIN',
      },
    });

    const userIds = Array.from({ length: 20 }, (_, i) => `u-${i + 1}`);
    await ctx.prisma.user.createMany({
      data: userIds.map((id, i) => ({
        id,
        name: `User ${i + 1}`,
        email: `user-${i + 1}@example.com`,
        role: 'USER',
        isSimulated: false,
      })),
    });

    const event = await ctx.prisma.event.create({
      data: {
        id: 'evt-burst-5',
        name: '20 抢 5 高并发测试活动',
        description: '验证 PostgreSQL 行锁串行化防超卖',
        startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        endTime: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        capacity: 5,
        maxPerUser: 1,
        confirmTimeoutSec: 300,
        createdById: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    });

    const responses = await Promise.all(
      userIds.map((userId, i) =>
        ctx.app.request(`/api/events/${event.id}/reservations`, {
          method: 'POST',
          headers: {
            'X-User-Id': userId,
            'Idempotency-Key': `burst-key-${i + 1}`,
          },
        }),
      ),
    );

    const payloads = await Promise.all(
      responses.map(async (res) => ({
        status: res.status,
        body: (await res.json()) as ApiSuccessEnvelope<ReservationDetailDto>,
      })),
    );

    expect(payloads.every((p) => p.status === 201)).toBe(true);
    expect(payloads.every((p) => p.body.meta?.idempotentReplay === false)).toBe(
      true,
    );

    const pending = payloads.filter(
      (p) => p.body.data.status === 'PENDING_CONFIRM',
    );
    const waitlisted = payloads.filter(
      (p) => p.body.data.status === 'WAITLISTED',
    );
    expect(pending).toHaveLength(5);
    expect(waitlisted).toHaveLength(15);

    // 验证 DB 层面 waitlistSeq 严格单调无重复
    const waitlistedRows = await ctx.prisma.reservation.findMany({
      where: { eventId: event.id, status: 'WAITLISTED' },
      orderBy: { waitlistSeq: 'asc' },
    });
    expect(waitlistedRows).toHaveLength(15);
    const seqs = waitlistedRows.map((r) => r.waitlistSeq);
    expect(seqs.every((s): s is number => typeof s === 'number' && s > 0)).toBe(
      true,
    );
    expect(new Set(seqs).size).toBe(15);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }

    // 验证 Admin 详情接口 WAITLISTED Tab 顺序与 1..15 顺位及零超卖
    const adminDetailRes = await ctx.app.request(
      `/api/events/${event.id}?tab=WAITLISTED`,
      { headers: { 'X-User-Id': 'admin' } },
    );
    expect(adminDetailRes.status).toBe(200);
    const adminDetail = (await adminDetailRes.json()) as ApiSuccessEnvelope<
      AdminEventDetailResponse
    >;
    expect(adminDetail.data.roleView).toBe('ADMIN');
    expect(adminDetail.data.event.stats.oversold).toBe(false);
    expect(adminDetail.data.event.stats.pendingCount).toBe(5);
    expect(adminDetail.data.event.stats.waitlistedCount).toBe(15);
    expect(adminDetail.data.reservations.map((r) => r.waitlistRank)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );

    await assertEventInvariants(ctx.prisma, event.id, ctx.clock.now());
  });

  it('#4 prevents TOCTOU under concurrent cancel x 2 on the same confirmed reservation', async () => {
    const now = ctx.clock.now();
    await ctx.prisma.user.createMany({
      data: [
        { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' },
        { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'USER' },
        { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'USER' },
        { id: 'u3', name: 'Charlie', email: 'charlie@example.com', role: 'USER' },
      ],
    });

    const event = await ctx.prisma.event.create({
      data: {
        id: 'evt-toctou',
        name: '并发取消防 TOCTOU 测试活动',
        description: '',
        startTime: new Date(now.getTime() + 3600_000),
        endTime: new Date(now.getTime() + 7200_000),
        capacity: 1,
        maxPerUser: 1,
        confirmTimeoutSec: 300,
        createdById: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    });

    // u1 占位并确认；u2、u3 按序进入候补
    const r1Res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'k-u1' },
    });
    const r1 = (
      (await r1Res.json()) as ApiSuccessEnvelope<ReservationDetailDto>
    ).data;
    const confirmRes = await ctx.app.request(
      `/api/reservations/${r1.id}/confirm`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(confirmRes.status).toBe(200);

    const r2Res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u2', 'Idempotency-Key': 'k-u2' },
    });
    const r2 = (
      (await r2Res.json()) as ApiSuccessEnvelope<ReservationDetailDto>
    ).data;
    expect(r2.status).toBe('WAITLISTED');
    expect(r2.waitlistRank).toBe(1);

    const r3Res = await ctx.app.request(`/api/events/${event.id}/reservations`, {
      method: 'POST',
      headers: { 'X-User-Id': 'u3', 'Idempotency-Key': 'k-u3' },
    });
    const r3 = (
      (await r3Res.json()) as ApiSuccessEnvelope<ReservationDetailDto>
    ).data;
    expect(r3.status).toBe('WAITLISTED');
    expect(r3.waitlistRank).toBe(2);

    // 对同一确认单并发发送两次 cancel
    const [c1, c2] = await Promise.all([
      ctx.app.request(`/api/reservations/${r1.id}/cancel`, {
        method: 'POST',
        headers: { 'X-User-Id': 'u1' },
      }),
      ctx.app.request(`/api/reservations/${r1.id}/cancel`, {
        method: 'POST',
        headers: { 'X-User-Id': 'u1' },
      }),
    ]);

    const statuses = [c1.status, c2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const errRes = c1.status === 409 ? c1 : c2;
    const errBody = (await errRes.json()) as ApiErrorEnvelope;
    expect(errBody.error.code).toBe('INVALID_STATE_TRANSITION');

    const okRes = c1.status === 200 ? c1 : c2;
    const okBody =
      (await okRes.json()) as ApiSuccessEnvelope<CancelReservationResponse>;
    expect(okBody.data.reservation.status).toBe('CANCELLED');
    expect(okBody.data.promotedReservation).toBeNull();

    // 仅转正 1 人（u2），u3 仍为 WAITLISTED 且顺位变为 1
    const [r2After, r3After] = await Promise.all([
      ctx.prisma.reservation.findUnique({ where: { id: r2.id } }),
      ctx.prisma.reservation.findUnique({ where: { id: r3.id } }),
    ]);
    expect(r2After?.status).toBe('PENDING_CONFIRM');
    expect(r3After?.status).toBe('WAITLISTED');

    const u3MeRes = await ctx.app.request('/api/reservations/me', {
      headers: { 'X-User-Id': 'u3' },
    });
    const u3Me = (await u3MeRes.json()) as ApiSuccessEnvelope<
      Array<{ id: string; waitlistRank: number | null }>
    >;
    expect(u3Me.data[0]?.waitlistRank).toBe(1);

    await assertEventInvariants(ctx.prisma, event.id, ctx.clock.now());
  });

  it('#5 enforces strict idempotency on concurrent double-click and returns latest state on replay', async () => {
    const now = ctx.clock.now();
    await ctx.prisma.user.createMany({
      data: [
        { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' },
        { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'USER' },
      ],
    });

    const event = await ctx.prisma.event.create({
      data: {
        id: 'evt-idem',
        name: '严格幂等测试活动',
        description: '',
        startTime: new Date(now.getTime() + 3600_000),
        endTime: new Date(now.getTime() + 7200_000),
        capacity: 5,
        maxPerUser: 1,
        confirmTimeoutSec: 300,
        createdById: 'admin',
        createdAt: now,
        updatedAt: now,
      },
    });

    // 缺失或空白 Idempotency-Key 必须返回 400 VALIDATION_ERROR
    const missingKeyRes = await ctx.app.request(
      `/api/events/${event.id}/reservations`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(missingKeyRes.status).toBe(400);
    expect(
      ((await missingKeyRes.json()) as ApiErrorEnvelope).error.code,
    ).toBe('VALIDATION_ERROR');

    // maxPerUser = 1 下同 Idempotency-Key 并发双击：1 次 201 + 1 次 200 (idempotentReplay=true)
    const [resA, resB] = await Promise.all([
      ctx.app.request(`/api/events/${event.id}/reservations`, {
        method: 'POST',
        headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'idem-double-click' },
      }),
      ctx.app.request(`/api/events/${event.id}/reservations`, {
        method: 'POST',
        headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'idem-double-click' },
      }),
    ]);

    const bodyA = (await resA.json()) as ApiSuccessEnvelope<ReservationDetailDto>;
    const bodyB = (await resB.json()) as ApiSuccessEnvelope<ReservationDetailDto>;

    expect([resA.status, resB.status].sort((a, b) => a - b)).toEqual([200, 201]);
    expect(bodyA.data.id).toBe(bodyB.data.id);
    const replayFlags = [
      bodyA.meta?.idempotentReplay,
      bodyB.meta?.idempotentReplay,
    ].sort();
    expect(replayFlags).toEqual([false, true]);

    const reservationId = bodyA.data.id;

    // 原单确认后再次用同一 key 重放 -> 返回最新当前状态 CONFIRMED
    const confirmRes = await ctx.app.request(
      `/api/reservations/${reservationId}/confirm`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(confirmRes.status).toBe(200);

    const replayAfterConfirm = await ctx.app.request(
      `/api/events/${event.id}/reservations`,
      {
        method: 'POST',
        headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'idem-double-click' },
      },
    );
    expect(replayAfterConfirm.status).toBe(200);
    const confirmedReplayBody =
      (await replayAfterConfirm.json()) as ApiSuccessEnvelope<ReservationDetailDto>;
    expect(confirmedReplayBody.meta?.idempotentReplay).toBe(true);
    expect(confirmedReplayBody.data.status).toBe('CONFIRMED');
    expect(confirmedReplayBody.data.expiresAt).toBeNull();

    // 原单取消后再次用同一 key 重放 -> 返回最新当前状态 CANCELLED
    const cancelRes = await ctx.app.request(
      `/api/reservations/${reservationId}/cancel`,
      { method: 'POST', headers: { 'X-User-Id': 'u1' } },
    );
    expect(cancelRes.status).toBe(200);

    const replayAfterCancel = await ctx.app.request(
      `/api/events/${event.id}/reservations`,
      {
        method: 'POST',
        headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'idem-double-click' },
      },
    );
    expect(replayAfterCancel.status).toBe(200);
    const cancelledReplayBody =
      (await replayAfterCancel.json()) as ApiSuccessEnvelope<ReservationDetailDto>;
    expect(cancelledReplayBody.meta?.idempotentReplay).toBe(true);
    expect(cancelledReplayBody.data.status).toBe('CANCELLED');

    // 活动开始后（now >= startTime）重放历史 key 依然命中幂等返回 200（幂等在 EVENT_ENDED 之前）
    ctx.clock.set(new Date(event.startTime.getTime() + 1000));
    const replayAfterEnded = await ctx.app.request(
      `/api/events/${event.id}/reservations`,
      {
        method: 'POST',
        headers: { 'X-User-Id': 'u1', 'Idempotency-Key': 'idem-double-click' },
      },
    );
    expect(replayAfterEnded.status).toBe(200);
    const endedReplayBody =
      (await replayAfterEnded.json()) as ApiSuccessEnvelope<ReservationDetailDto>;
    expect(endedReplayBody.meta?.idempotentReplay).toBe(true);
    expect(endedReplayBody.data.status).toBe('CANCELLED');

    await assertEventInvariants(ctx.prisma, event.id, ctx.clock.now());
  });
});
