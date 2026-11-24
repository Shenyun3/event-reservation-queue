/**
 * 运营管理维护 HTTP 路由：
 * - `POST /api/admin/worker/expire`
 * - `POST /api/admin/reset-seed`
 */
import { Hono, type MiddlewareHandler } from 'hono';
import type { Clock } from '../lib/clock.ts';
import type { AdminService } from '../services/admin-service.ts';
import {
  buildResponseMeta,
  getRequiredActor,
  type AppEnv,
} from './context.ts';

/** `createAdminRoutes` 依赖注入契约。 */
export interface AdminRoutesDeps {
  adminService: AdminService;
  clock: Clock;
  requireActor: MiddlewareHandler<AppEnv>;
}

/**
 * 构建运营管理维护子路由（挂载路径：`/api/admin`）。
 *
 * @param deps 管理员运维服务、时钟与鉴权中间件。
 * @returns Hono 子路由实例。
 */
export function createAdminRoutes(deps: AdminRoutesDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.use('*', deps.requireActor);

  router.post('/worker/expire', async (c) => {
    const actor = getRequiredActor(c);
    const result = await deps.adminService.triggerExpireWorker(actor);
    return c.json({
      data: result,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  router.post('/reset-seed', async (c) => {
    const actor = getRequiredActor(c);
    const result = await deps.adminService.resetSeed(actor);
    return c.json({
      data: result,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  return router;
}
