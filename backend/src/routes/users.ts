/**
 * 用户域 HTTP 路由：`GET /api/users`（公开接口，返回顶部模拟账号切换器列表）。
 */
import { ListUsersQuerySchema } from '@queue-reservation/shared';
import { Hono } from 'hono';
import type { Clock } from '../lib/clock.ts';
import type { UserService } from '../services/user-service.ts';
import { buildResponseMeta, type AppEnv } from './context.ts';

/** `createUsersRoutes` 依赖注入契约。 */
export interface UsersRoutesDeps {
  userService: UserService;
  clock: Clock;
}

/**
 * 构建用户域子路由（挂载路径：`/api/users`）。
 *
 * @param deps 用户服务与时钟依赖。
 * @returns Hono 子路由实例。
 */
export function createUsersRoutes(deps: UsersRoutesDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const query = ListUsersQuerySchema.parse(c.req.query());
    const users = await deps.userService.listUsers({
      includeSimulated: query.includeSimulated,
    });
    return c.json({
      data: users,
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  return router;
}
