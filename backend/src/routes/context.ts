/**
 * Hono 路由层公共上下文类型、统一响应信封构造器、JSON Body 解析与 `X-User-Id` 身份解析中间件。
 * 路由层仅做校验、身份提取与信封包装，严禁导入 Prisma 或包含核心业务规则。
 */
import { ERROR_CODES, type ResponseMeta } from '@queue-reservation/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import type { UserRecord } from '../repositories/types.ts';
import type { UserService } from '../services/user-service.ts';

/** Hono 上下文变量契约（含全局 requestId 与鉴权解析后的操作人）。 */
export interface AppVariables {
  requestId: string;
  actor?: UserRecord;
}

/** Hono 应用环境泛型类型。 */
export interface AppEnv {
  Variables: AppVariables;
}

/**
 * 构造统一成功响应信封的 `meta` 对象。
 *
 * @param c Hono 请求上下文。
 * @param clock 服务端注入时钟。
 * @param extra 可选扩展元信息（如 `idempotentReplay`、`total`、`lastWorkerRunAt`）。
 * @returns 符合 `ResponseMetaSchema` 的元信息对象。
 */
export function buildResponseMeta(
  c: Context<AppEnv>,
  clock: Clock,
  extra?: Partial<Omit<ResponseMeta, 'requestId' | 'serverTime'>>,
): ResponseMeta {
  return {
    requestId: c.get('requestId'),
    serverTime: clock.now().toISOString(),
    ...extra,
  };
}

/**
 * 解析并校验 JSON 请求体；非法 JSON 语法映射为 `400 VALIDATION_ERROR`，Schema 不合法交由全局 `onError` 处理 `ZodError`。
 *
 * @param c Hono 请求上下文。
 * @param schema 目标 Zod Schema。
 * @returns 通过校验的强类型载荷。
 * @throws {AppError} 当请求体不是合法 JSON 时抛出 `400 VALIDATION_ERROR`。
 */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  c: Context<AppEnv>,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 400, '请求体必须为合法 JSON');
  }
  return schema.parse(raw);
}

/**
 * 创建 `X-User-Id` 身份解析中间件。
 * 缺失返回 `401 UNAUTHORIZED`，用户不存在返回 `401 USER_NOT_FOUND`。
 *
 * @param userService 用户查询服务。
 * @returns Hono 中间件处理器。
 */
export function createActorMiddleware(
  userService: UserService,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const rawUserId = c.req.header('x-user-id');
    const userId = rawUserId?.trim();
    if (!userId) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, 401, '缺少 X-User-Id 请求头');
    }

    const user = await userService.findById(userId);
    if (!user) {
      throw new AppError(
        ERROR_CODES.USER_NOT_FOUND,
        401,
        `用户 ${userId} 不存在`,
      );
    }

    c.set('actor', user);
    await next();
  };
}

/**
 * 从已完成身份解析的上下文中读取当前操作用户。
 *
 * @param c Hono 请求上下文。
 * @returns 已解析的 `UserRecord`。
 * @throws {AppError} 若中间件未注入操作人则兜底抛出 `401 UNAUTHORIZED`。
 */
export function getRequiredActor(c: Context<AppEnv>): UserRecord {
  const actor = c.get('actor');
  if (!actor) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401, '未识别到当前用户身份');
  }
  return actor;
}
