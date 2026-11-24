/**
 * 活动与发起预约 HTTP 路由：
 * - `GET /api/events`
 * - `POST /api/events`
 * - `GET /api/events/:eventId`
 * - `POST /api/events/:eventId/reservations`
 */
import {
  CreateEventInputSchema,
  ERROR_CODES,
  GetEventDetailQuerySchema,
} from '@queue-reservation/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import type { EventService } from '../services/event-service.ts';
import type { ReservationService } from '../services/reservation-service.ts';
import {
  buildResponseMeta,
  getRequiredActor,
  parseJsonBody,
  type AppEnv,
} from './context.ts';

/** `createEventsRoutes` 依赖注入契约。 */
export interface EventsRoutesDeps {
  eventService: EventService;
  reservationService: ReservationService;
  clock: Clock;
  getLastWorkerRunAt: () => Date | null;
  requireActor: MiddlewareHandler<AppEnv>;
}

/**
 * 构建活动与活动下预约子路由（挂载路径：`/api/events`）。
 *
 * @param deps 活动服务、预约服务、时钟、巡检时间读取器与鉴权中间件。
 * @returns Hono 子路由实例。
 */
export function createEventsRoutes(deps: EventsRoutesDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.use('*', deps.requireActor);

  router.get('/', async (c) => {
    const actor = getRequiredActor(c);
    const events = await deps.eventService.listEvents(actor);
    const lastRun = deps.getLastWorkerRunAt();
    return c.json({
      data: events,
      meta: buildResponseMeta(c, deps.clock, {
        total: events.length,
        lastWorkerRunAt: lastRun ? lastRun.toISOString() : null,
      }),
    });
  });

  router.post('/', async (c) => {
    const actor = getRequiredActor(c);
    const input = await parseJsonBody(c, CreateEventInputSchema);
    const created = await deps.eventService.createEvent(actor, input);
    return c.json(
      {
        data: created,
        meta: buildResponseMeta(c, deps.clock),
      },
      201,
    );
  });

  router.get('/:eventId', async (c) => {
    const actor = getRequiredActor(c);
    const eventId = c.req.param('eventId');
    const query = GetEventDetailQuerySchema.parse(c.req.query());
    const detail = await deps.eventService.getEventDetail(
      actor,
      eventId,
      query.tab,
    );
    return c.json({
      data: detail,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  router.post('/:eventId/reservations', async (c) => {
    const actor = getRequiredActor(c);
    const eventId = c.req.param('eventId');
    const rawKey = c.req.header('idempotency-key');
    const idempotencyKey = rawKey?.trim() ?? '';
    if (idempotencyKey.length === 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        '请求头 Idempotency-Key 不能为空',
      );
    }
    if (idempotencyKey.length > 128) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        '请求头 Idempotency-Key 长度不能超过 128 字符',
      );
    }

    const result = await deps.reservationService.createReservation(
      actor,
      eventId,
      idempotencyKey,
    );
    const statusCode = result.idempotentReplay ? 200 : 201;
    return c.json(
      {
        data: result.reservation,
        meta: buildResponseMeta(c, deps.clock, {
          idempotentReplay: result.idempotentReplay,
        }),
      },
      statusCode,
    );
  });

  return router;
}
