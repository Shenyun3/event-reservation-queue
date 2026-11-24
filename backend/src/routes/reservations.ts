/**
 * 预约单查询与状态流转 HTTP 路由：
 * - `GET /api/reservations/me`
 * - `POST /api/reservations/:id/confirm`
 * - `POST /api/reservations/:id/cancel`
 * - `GET /api/reservations/:id/audit-logs`
 */
import { ListMyReservationsQuerySchema } from '@queue-reservation/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Clock } from '../lib/clock.ts';
import type { ReservationService } from '../services/reservation-service.ts';
import {
  buildResponseMeta,
  getRequiredActor,
  type AppEnv,
} from './context.ts';

/** `createReservationsRoutes` 依赖注入契约。 */
export interface ReservationsRoutesDeps {
  reservationService: ReservationService;
  clock: Clock;
  requireActor: MiddlewareHandler<AppEnv>;
}

/**
 * 构建预约单子路由（挂载路径：`/api/reservations`）。
 *
 * @param deps 预约服务、时钟与鉴权中间件。
 * @returns Hono 子路由实例。
 */
export function createReservationsRoutes(
  deps: ReservationsRoutesDeps,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.use('*', deps.requireActor);

  router.get('/me', async (c) => {
    const actor = getRequiredActor(c);
    const query = ListMyReservationsQuerySchema.parse(c.req.query());
    const reservations = await deps.reservationService.listMyReservations(
      actor,
      query.status,
    );
    return c.json({
      data: reservations,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  router.post('/:id/confirm', async (c) => {
    const actor = getRequiredActor(c);
    const reservationId = c.req.param('id');
    const reservation = await deps.reservationService.confirmReservation(
      actor,
      reservationId,
    );
    return c.json({
      data: reservation,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  router.post('/:id/cancel', async (c) => {
    const actor = getRequiredActor(c);
    const reservationId = c.req.param('id');
    const result = await deps.reservationService.cancelReservation(
      actor,
      reservationId,
    );
    return c.json({
      data: result,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  router.get('/:id/audit-logs', async (c) => {
    const actor = getRequiredActor(c);
    const reservationId = c.req.param('id');
    const result = await deps.reservationService.getAuditLogs(
      actor,
      reservationId,
    );
    return c.json({
      data: result,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  return router;
}
