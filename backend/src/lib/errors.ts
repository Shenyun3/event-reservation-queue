/**
 * 统一业务异常基类与 Prisma 错误特征识别工具。
 */
import type { ErrorCode } from '@queue-reservation/shared';

/** 标准业务异常，用于在 Service 提交事务后向路由层传递稳定错误码与 HTTP 状态码。 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  /**
   * 构造业务异常实例。
   *
   * @param code 稳定业务错误码。
   * @param status HTTP 状态码（4xx / 5xx）。
   * @param message 面向调用方的可读错误描述。
   * @param details 可选结构化错误上下文。
   */
  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface PrismaLikeError {
  code?: unknown;
  meta?: Record<string, unknown>;
}

/**
 * 判断未知异常是否匹配指定的 Prisma 错误码。
 *
 * @param err 捕获到的异常对象。
 * @param code 目标 Prisma 错误码（如 `P2025`、`P2002`、`P2028`、`P2034`）。
 * @returns 匹配则返回 `true`。
 */
export function isPrismaErrorCode(err: unknown, code: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as PrismaLikeError).code === code;
}

/**
 * 判断异常是否为 `reservations(event_id, user_id, idempotency_key)` 幂等唯一键冲突（P2002）。
 * 严禁把 `waitlist_seq` 或 `users.email` 的 P2002 误判为幂等重放。
 *
 * @param err 捕获到的异常对象。
 * @returns 仅当明确命中幂等唯一键约束时返回 `true`。
 */
export function isIdempotencyUniqueViolation(err: unknown): boolean {
  if (!isPrismaErrorCode(err, 'P2002')) return false;
  const meta = (err as PrismaLikeError).meta;
  if (!meta) return false;

  // 兼容 Prisma 标准 meta.target 数组/字符串
  const target = meta.target;
  if (Array.isArray(target)) {
    const joined = target.map(String).join(',');
    if (joined.includes('idempotency_key') || joined.includes('idempotencyKey')) {
      return true;
    }
  } else if (typeof target === 'string') {
    if (target.includes('idempotency_key') || target.includes('idempotencyKey')) {
      return true;
    }
  }

  // 兼容 Prisma 7 @prisma/adapter-pg 的 driverAdapterError.cause.constraint 结构
  const driverErr = meta.driverAdapterError as Record<string, unknown> | undefined;
  const cause = driverErr?.cause as Record<string, unknown> | undefined;
  const constraint = cause?.constraint as Record<string, unknown> | string | undefined;
  if (typeof constraint === 'string' && constraint.includes('idempotency_key')) {
    return true;
  }
  if (constraint && typeof constraint === 'object') {
    const index = constraint.index;
    if (typeof index === 'string') {
      return index.includes('idempotency_key') || index.includes('idempotencyKey');
    }
    const fields = constraint.fields;
    if (Array.isArray(fields)) {
      return fields.map(String).some((f) => f.includes('idempotency_key') || f.includes('idempotencyKey'));
    }
    const serialized = JSON.stringify(constraint);
    if (serialized.includes('idempotency_key') || serialized.includes('idempotencyKey')) {
      return true;
    }
  }

  return false;
}
