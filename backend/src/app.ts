/**
 * Hono 应用 DI 工厂（Phase 1 基座：支持注入 Clock、Repositories、TransactionManager 与 Worker 状态，
 * 供 server.ts 与 Vitest 集成测试进程内 `app.request()` 共享）。
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

/** `createApp` 依赖注入契约。 */
export interface AppDependencies {
  clock: Clock;
  logger: Logger;
  repos: Repositories;
  txManager: TransactionManager;
  dbPoolMax: number;
  workerEnabled: boolean;
  getLastWorkerRunAt: () => Date | null;
  checkDbHealth: () => Promise<boolean>;
}

/** Hono 上下文扩展变量类型。 */
export interface AppVariables {
  requestId: string;
}

/**
 * 组装 Hono 应用实例（包含全局 requestId、结构化请求日志、统一错误处理与 `/api/health` 路由）。
 *
 * @param deps 注入的时钟、仓储、事务管理器与运行时配置。
 * @returns 已组装完成的 Hono 应用实例。
 */
export function createApp(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

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
    const lastRun = deps.getLastWorkerRunAt();
    return c.json({
      data: {
        status: 'ok' as const,
        db: dbUp ? ('up' as const) : ('down' as const),
        workerEnabled: deps.workerEnabled,
        lastWorkerRunAt: lastRun ? lastRun.toISOString() : null,
      },
      meta: {
        requestId: c.get('requestId'),
        serverTime: deps.clock.now().toISOString(),
      },
    });
  });

  return app;
}
