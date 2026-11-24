/**
 * Phase 1 基础设施冒烟测试：验证 createApp DI + FakeClock + /api/health + 物理 CHECK 约束生效。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { isIdempotencyUniqueViolation, isPrismaErrorCode } from '../../src/lib/errors.ts';
import {
  assertEventInvariants,
  createTestContext,
  resetTestDb,
} from './helpers/db.ts';

describe('Phase 1 foundation smoke tests', () => {
  const ctx = createTestContext(new Date('2026-11-24T12:00:00.000Z'));

  beforeEach(async () => {
    await resetTestDb(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('serves GET /api/health with FakeClock serverTime and db up', async () => {
    const res = await ctx.app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; db: string; workerEnabled: boolean };
      meta: { serverTime: string; requestId: string };
    };
    expect(body.data.status).toBe('ok');
    expect(body.data.db).toBe('up');
    expect(body.data.workerEnabled).toBe(false);
    expect(body.meta.serverTime).toBe('2026-11-24T12:00:00.000Z');
  });

  it('populates seed data via transactional repository and satisfies all 4 event invariants', async () => {
    const summary = await ctx.txManager.run((repos) => repos.seedInitialData(ctx.clock.now()));
    expect(summary).toEqual({ usersCount: 6, eventsCount: 2 });
    await assertEventInvariants(ctx.prisma, 'evt-1', ctx.clock.now());
    await assertEventInvariants(ctx.prisma, 'evt-2', ctx.clock.now());
  });

  it('enforces PostgreSQL physical CHECK constraints against oversell and invalid expiry', async () => {
    await ctx.txManager.run((repos) => repos.seedInitialData(ctx.clock.now()));

    // 违背 events_no_oversell_chk (confirmedCount + pendingCount > capacity) 必须被 DB 拒绝
    await expect(
      ctx.prisma.event.update({
        where: { id: 'evt-2' },
        data: { pendingCount: 2 }, // confirmed=2 + pending=2 > capacity=3
      }),
    ).rejects.toThrow();

    // 违背 reservations_pending_expiry_invariant_chk (PENDING_CONFIRM 但 expiresAt = null) 必须被 DB 拒绝
    await expect(
      ctx.prisma.reservation.create({
        data: {
          eventId: 'evt-1',
          userId: 'u1',
          status: 'PENDING_CONFIRM',
          idempotencyKey: 'bad-pending-no-expiry',
          expiresAt: null,
        },
      }),
    ).rejects.toThrow();
  });

  it('distinguishes idempotency P2002 from waitlist_seq and email P2002 under Prisma 7 adapter-pg', async () => {
    await ctx.txManager.run((repos) => repos.seedInitialData(ctx.clock.now()));

    // 正例：命中 reservations(event_id, user_id, idempotency_key) 唯一约束
    let idempotencyErr: unknown;
    try {
      await ctx.prisma.reservation.create({
        data: {
          eventId: 'evt-1',
          userId: 'u2',
          status: 'CONFIRMED',
          idempotencyKey: 'seed-res-101',
        },
      });
    } catch (err) {
      idempotencyErr = err;
    }
    expect(isPrismaErrorCode(idempotencyErr, 'P2002')).toBe(true);
    expect(isIdempotencyUniqueViolation(idempotencyErr)).toBe(true);

    // 反例 1：命中 reservations(event_id, waitlist_seq) 唯一约束不得误判为幂等重放
    let waitlistSeqErr: unknown;
    try {
      await ctx.prisma.reservation.create({
        data: {
          eventId: 'evt-2',
          userId: 'u5',
          status: 'WAITLISTED',
          idempotencyKey: 'fresh-key-seq-collision',
          waitlistedAt: ctx.clock.now(),
          waitlistSeq: 4, // seed res-107 已占用 evt-2 waitlistSeq=4
        },
      });
    } catch (err) {
      waitlistSeqErr = err;
    }
    expect(isPrismaErrorCode(waitlistSeqErr, 'P2002')).toBe(true);
    expect(isIdempotencyUniqueViolation(waitlistSeqErr)).toBe(false);

    // 反例 2：命中 users.email 唯一约束不得误判为幂等重放
    let emailErr: unknown;
    try {
      await ctx.prisma.user.create({
        data: {
          id: 'u-dup-email',
          name: 'Dup Alice',
          email: 'alice@example.com',
          role: 'USER',
        },
      });
    } catch (err) {
      emailErr = err;
    }
    expect(isPrismaErrorCode(emailErr, 'P2002')).toBe(true);
    expect(isIdempotencyUniqueViolation(emailErr)).toBe(false);
  });
});
