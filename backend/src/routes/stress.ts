/**
 * P1 并发压测与活动清场 HTTP 路由：
 * - `DELETE /api/events/:eventId/reservations`
 * - `POST /api/events/:eventId/simulate-burst`
 * 仅负责身份提取、请求体 Zod 校验、调用 `StressService` 与统一响应信封包装。
 */
import {
  ERROR_CODES,
  SimulateBurstInputSchema,
} from '@queue-reservation/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import type { StressService } from '../services/stress-service.ts';
import {
  buildResponseMeta,
  getRequiredActor,
  type AppEnv,
} from './context.ts';

/** `createStressRoutes` 依赖注入契约。 */
export interface StressRoutesDeps {
  stressService: StressService;
  clock: Clock;
  requireActor: MiddlewareHandler<AppEnv>;
}

/**
 * 构建 P1 并发压测与清空活动预约子路由（挂载路径：`/api/events`）。
 *
 * @param deps 压测服务、时钟与鉴权中间件。
 * @returns Hono 子路由实例。
 */
export function createStressRoutes(deps: StressRoutesDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  // 避免与同前缀 `/api/events` 路由的 requireActor 重复查询数据库，同时保障独立挂载时仍强校验身份
  const ensureActor: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.get('actor')) {
      await next();
      return;
    }
    return deps.requireActor(c, next);
  };

  router.delete('/:eventId/reservations', ensureActor, async (c) => {
    const actor = getRequiredActor(c);
    const eventId = c.req.param('eventId');
    const result = await deps.stressService.clearEventReservations(
      actor,
      eventId,
    );
    return c.json({
      data: result,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  router.post('/:eventId/simulate-burst', ensureActor, async (c) => {
    const actor = getRequiredActor(c);
    const eventId = c.req.param('eventId');

    const rawText = await c.req.text();
    let rawBody: unknown = {};
    if (rawText.trim().length > 0) {
      try {
        rawBody = JSON.parse(rawText);
      } catch {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          400,
          '请求体必须为合法 JSON',
        );
      }
    }

    const input = SimulateBurstInputSchema.parse(rawBody);
    const result = await deps.stressService.simulateBurst(
      actor,
      eventId,
      input.concurrency,
    );
    return c.json({
      data: result,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  return router;
}
