/**
 * 后台 10 秒超时锁单巡检 Worker（与 HTTP 路由完全解耦，支持防重入锁与优雅停机等待）。
 */
import type { ExpireWorkerResponse } from '@queue-reservation/shared';
import type { Logger } from '../lib/logger.ts';

/** `ExpirationWorker` 构造选项。 */
export interface ExpirationWorkerOptions {
  /** 执行单次超时扫描与回收的业务函数。 */
  runExpire: () => Promise<ExpireWorkerResponse>;
  logger: Logger;
  /** 巡检间隔毫秒数（默认 `10_000`，即 10 秒）。 */
  intervalMs?: number;
}

/** 定时超时巡检调度器。 */
export class ExpirationWorker {
  private readonly runExpire: () => Promise<ExpireWorkerResponse>;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private activeRun: Promise<ExpireWorkerResponse | null> | null = null;
  private lastRunAt: Date | null = null;

  /**
   * 创建 `ExpirationWorker` 实例。
   *
   * @param options 巡检执行回调、日志器与周期配置。
   */
  constructor(options: ExpirationWorkerOptions) {
    this.runExpire = options.runExpire;
    this.logger = options.logger;
    this.intervalMs = options.intervalMs ?? 10_000;
  }

  /**
   * 启动周期定时器（幂等：重复调用不会创建多个定时器）。
   */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.logger.info('expiration_worker_started', {
      intervalMs: this.intervalMs,
    });
  }

  /**
   * 执行单次超时巡检（内置 `isRunning` 防重入锁，异常捕获不击穿定时器）。
   *
   * @returns 巡检摘要结果；若上一轮尚未结束或发生异常则返回 `null`。
   */
  runOnce(): Promise<ExpireWorkerResponse | null> {
    if (this.isRunning) {
      this.logger.warn('expiration_worker_skipped_reentrant', {
        intervalMs: this.intervalMs,
      });
      return Promise.resolve(null);
    }

    this.isRunning = true;
    const task = (async (): Promise<ExpireWorkerResponse | null> => {
      try {
        const result = await this.runExpire();
        this.lastRunAt = new Date(result.lastWorkerRunAt);
        return result;
      } catch (err) {
        this.logger.error('expiration_worker_failed', {
          errorName: err instanceof Error ? err.name : typeof err,
          errorMessage: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        return null;
      } finally {
        this.isRunning = false;
        this.activeRun = null;
      }
    })();

    this.activeRun = task;
    return task;
  }

  /**
   * 停止周期调度并优雅等待当前正在进行的巡检轮次执行完毕。
   */
  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.activeRun !== null) {
      await this.activeRun;
    }
    this.logger.info('expiration_worker_stopped');
  }

  /**
   * 获取最近一次成功完成巡检的 UTC 时间戳。
   *
   * @returns 最近巡检时间，若尚未执行过则返回 `null`。
   */
  getLastRunAt(): Date | null {
    return this.lastRunAt;
  }
}
