/**
 * Hono 应用 DI 工厂：组装全局中间件、统一错误处理、服务用例与全部 P0/P1 REST 路由。
 * 供 `server.ts` 与 Vitest 集成测试进程内 `app.request()` 共享。
 */
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@queue-reservation/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { Clock } from './lib/clock.ts';
import { AppError, isPrismaErrorCode } from './lib/errors.ts';
import type { Logger } from './lib/logger.ts';
import type { Repositories, TransactionManager } from './repositories/types.ts';
import { createAdminRoutes } from './routes/admin.ts';
import {
  buildResponseMeta,
  createActorMiddleware,
  type AppEnv,
  type AppVariables,
} from './routes/context.ts';
import { createEventsRoutes } from './routes/events.ts';
import { createReservationsRoutes } from './routes/reservations.ts';
import { createStressRoutes } from './routes/stress.ts';
import { createUsersRoutes } from './routes/users.ts';
import { AdminService } from './services/admin-service.ts';
import { EventService } from './services/event-service.ts';
import { ReservationService } from './services/reservation-service.ts';
import { StressService } from './services/stress-service.ts';
import { UserService } from './services/user-service.ts';

export type { AppVariables };

/** `createApp` 依赖注入契约。 */
export interface AppDependencies {
  clock: Clock;
  logger: Logger;
  repos: Repositories;
  txManager: TransactionManager;
  dbPoolMax: number;
  workerEnabled: boolean;
  getLastWorkerRunAt: () => Date | null;
  /** 可选巡检完成时间戳回调（用于将手动巡检时间同步给宿主运行态）。 */
  onWorkerRun?: (runAt: Date) => void;
  /** 可选预构造的 ReservationService（便于 server.ts 与 Worker 共享同一实例）。 */
  reservationService?: ReservationService;
  checkDbHealth: () => Promise<boolean>;
}

/**
 * 组装 Hono 应用实例（包含全局 requestId、结构化请求日志、统一错误处理与全部 12 个 P0 REST 路由）。
 *
 * @param deps 注入的时钟、仓储、事务管理器与运行时配置。
 * @returns 已组装完成的 Hono 应用实例。
 */
export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  let localLastWorkerRunAt: Date | null = null;
  const resolveLastWorkerRunAt = (): Date | null => {
    if (deps.onWorkerRun) {
      return deps.getLastWorkerRunAt();
    }
    const external = deps.getLastWorkerRunAt();
    if (external && localLastWorkerRunAt) {
      return external.getTime() >= localLastWorkerRunAt.getTime()
        ? external
        : localLastWorkerRunAt;
    }
    return external ?? localLastWorkerRunAt;
  };
  const recordWorkerRun = (runAt: Date): void => {
    if (deps.onWorkerRun) {
      deps.onWorkerRun(runAt);
      return;
    }
    localLastWorkerRunAt = runAt;
  };

  const userService = new UserService({ repos: deps.repos });
  const eventService = new EventService({
    repos: deps.repos,
    clock: deps.clock,
  });
  const reservationService =
    deps.reservationService ??
    new ReservationService({
      repos: deps.repos,
      txManager: deps.txManager,
      clock: deps.clock,
      logger: deps.logger,
      onWorkerRun: recordWorkerRun,
    });
  const adminService = new AdminService({
    txManager: deps.txManager,
    reservationService,
    clock: deps.clock,
    logger: deps.logger,
  });
  const stressService = new StressService({
    repos: deps.repos,
    txManager: deps.txManager,
    reservationService,
    clock: deps.clock,
    logger: deps.logger,
    dbPoolMax: deps.dbPoolMax,
  });

  const requireActor = createActorMiddleware(userService);

  app.use('*', cors());

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? `req-${randomUUID()}`;
    c.set('requestId', requestId);
    const startMs = performance.now();
    await next();
    const durationMs = Math.round((performance.now() - startMs) * 100) / 100;
    deps.logger.info('http_request', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
      userId: c.req.header('x-user-id') ?? null,
    });
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId');

    if (err instanceof AppError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        err.status as ContentfulStatusCode,
      );
    }

    if (err instanceof ZodError) {
      return c.json(
        {
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: err.issues[0]?.message ?? '请求参数校验失败',
            details: err.flatten(),
          },
        },
        400,
      );
    }

    if (isPrismaErrorCode(err, 'P2025')) {
      return c.json(
        {
          error: {
            code: ERROR_CODES.EVENT_NOT_FOUND,
            message: '目标活动或记录不存在',
          },
        },
        404,
      );
    }

    if (isPrismaErrorCode(err, 'P2028') || isPrismaErrorCode(err, 'P2034')) {
      return c.json(
        {
          error: {
            code: ERROR_CODES.SERVICE_BUSY,
            message: '系统当前并发繁忙，请稍后沿用同一幂等键重试',
          },
        },
        503,
      );
    }

    deps.logger.error('unhandled_error', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    return c.json(
      {
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: '服务器内部错误，请稍后重试',
        },
      },
      500,
    );
  });

  app.get('/api/health', async (c) => {
    let dbUp = false;
    try {
      dbUp = await deps.checkDbHealth();
    } catch (err) {
      deps.logger.warn('health_db_check_failed', {
        requestId: c.get('requestId'),
        message: err instanceof Error ? err.message : String(err),
      });
    }
    const lastRun = resolveLastWorkerRunAt();
    return c.json({
      data: {
        status: 'ok' as const,
        db: dbUp ? ('up' as const) : ('down' as const),
        workerEnabled: deps.workerEnabled,
        lastWorkerRunAt: lastRun ? lastRun.toISOString() : null,
      },
      meta: buildResponseMeta(c, deps.clock),
    });
  });

  app.route(
    '/api/users',
    createUsersRoutes({
      userService,
      clock: deps.clock,
    }),
  );

  app.route(
    '/api/events',
    createEventsRoutes({
      eventService,
      reservationService,
      clock: deps.clock,
      getLastWorkerRunAt: resolveLastWorkerRunAt,
      requireActor,
    }),
  );

  app.route(
    '/api/events',
    createStressRoutes({
      stressService,
      clock: deps.clock,
      requireActor,
    }),
  );

  app.route(
    '/api/reservations',
    createReservationsRoutes({
      reservationService,
      clock: deps.clock,
      requireActor,
    }),
  );

  app.route(
    '/api/admin',
    createAdminRoutes({
      adminService,
      clock: deps.clock,
      requireActor,
    }),
  );

  return app;
}
