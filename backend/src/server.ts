/**
 * 后端服务启动入口：加载配置、初始化 Prisma 7 连接池、挂载 Hono HTTP 服务与 10 秒超时巡检 Worker，
 * 并监听 `SIGINT` / `SIGTERM` 执行优雅停机（停服务 → 等 Worker 轮次结束 → 释放连接池）。
 */
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { SystemClock } from './lib/clock.ts';
import { loadEnv } from './lib/env.ts';
import { createLogger } from './lib/logger.ts';
import { createPrismaHandle } from './lib/prisma.ts';
import {
  createPrismaRepositories,
  PrismaTransactionManager,
} from './repositories/prisma-repositories.ts';
import { ReservationService } from './services/reservation-service.ts';
import { ExpirationWorker } from './worker/expiration-worker.ts';

/**
 * 启动 HTTP 服务与后台超时巡检调度器，并注册优雅停机信号处理器。
 */
export function startServer(): void {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const clock = new SystemClock();
  const prismaHandle = createPrismaHandle(env.DATABASE_URL, env.DB_POOL_MAX);
  const repos = createPrismaRepositories(prismaHandle.prisma);
  const txManager = new PrismaTransactionManager(prismaHandle.prisma);

  let lastWorkerRunAt: Date | null = null;
  const onWorkerRun = (runAt: Date): void => {
    lastWorkerRunAt = runAt;
  };

  const reservationService = new ReservationService({
    repos,
    txManager,
    clock,
    logger,
    onWorkerRun,
  });

  const worker = new ExpirationWorker({
    runExpire: () => reservationService.expireOverdueReservations(),
    logger,
    intervalMs: 10_000,
  });

  const app = createApp({
    clock,
    logger,
    repos,
    txManager,
    dbPoolMax: env.DB_POOL_MAX,
    workerEnabled: env.ENABLE_EXPIRATION_WORKER,
    getLastWorkerRunAt: () => lastWorkerRunAt,
    onWorkerRun,
    reservationService,
    checkDbHealth: async () => {
      await prismaHandle.prisma.user.count();
      return true;
    },
  });

  const server = serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      logger.info('backend_server_started', {
        port: info.port,
        dbPoolMax: env.DB_POOL_MAX,
        workerEnabled: env.ENABLE_EXPIRATION_WORKER,
      });
    },
  );

  if (env.ENABLE_EXPIRATION_WORKER) {
    worker.start();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('backend_shutdown_started', { signal });

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await worker.stop();
      await prismaHandle.close();
      logger.info('backend_shutdown_completed', { signal });
      process.exit(0);
    } catch (err) {
      logger.error('backend_shutdown_failed', {
        signal,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

startServer();
