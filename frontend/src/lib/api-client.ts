/**
 * 统一 API 客户端：自动注入 X-User-Id、解包 { data, meta }、校准服务端时间并管理 Idempotency-Key 生命周期。
 */
import {
  ApiErrorEnvelopeSchema,
  createSuccessEnvelopeSchema,
  type ErrorCode,
  type ResponseMeta,
} from '@queue-reservation/shared';
import type { z } from 'zod';

/** 本地存储模拟用户 ID 的键名。 */
export const ACTIVE_USER_STORAGE_KEY = 'queue_reservation_active_user_id';
/** 默认演示身份 ID（Alice / USER）。 */
export const DEFAULT_USER_ID = 'u1';

/**
 * 统一前端 API 异常对象。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
  readonly details?: unknown;

  /**
   * 构造前端统一 API 异常对象。
   *
   * @param status HTTP 状态码（网络异常时为 0）
   * @param code 稳定业务错误码或网络/契约错误标识
   * @param message 面向用户的可读错误消息
   * @param details 可选结构化错误详情
   */
  constructor(
    status: number,
    code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE',
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let serverClockOffsetMs = 0;

/**
 * 获取当前估算的服务端与浏览器时钟偏移（serverTime - Date.now()，单位毫秒）。
 *
 * @returns 毫秒级时间偏移量
 */
export function getServerClockOffsetMs(): number {
  return serverClockOffsetMs;
}

/**
 * 获取基于最新响应 `meta.serverTime` 校准后的当前估算服务端时间戳（毫秒）。
 *
 * @returns 校准后的 Unix 毫秒时间戳
 */
export function getEstimatedServerNowMs(): number {
  return Date.now() + serverClockOffsetMs;
}

/**
 * 根据响应中的 `meta.serverTime` 更新时钟偏移量。
 *
 * @param serverTimeIso 服务端 ISO 时间字符串
 */
export function updateServerClockOffset(serverTimeIso: string | undefined): void {
  if (!serverTimeIso) {
    return;
  }
  const parsed = Date.parse(serverTimeIso);
  if (!Number.isNaN(parsed)) {
    serverClockOffsetMs = parsed - Date.now();
  }
}

/**
 * 读取当前持久化在 localStorage 中的模拟用户 ID（在受限隐私模式下安全降级）。
 *
 * @returns 当前活动用户 ID
 */
export function getStoredUserId(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_USER_ID;
  }
  try {
    return window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY) || DEFAULT_USER_ID;
  } catch {
    return DEFAULT_USER_ID;
  }
}

/**
 * 管理写请求 `Idempotency-Key` 的生命周期：
 * - 单次用户预约意图生成唯一键；
 * - 网络异常或 5xx（含 503）重试时复用同一个键；
 * - 收到 2xx 或 4xx 确定结果后立即销毁，避免下一次新预约误复用旧键。
 */
export class IdempotencyKeyManager {
  private readonly keys = new Map<string, string>();

  /**
   * 获取指定意图键当前未决的 `Idempotency-Key`；不存在时自动生成新键。
   *
   * @param intentKey 业务意图标识（例如 `reserve:evt-1:u1`）
   * @returns UUID 格式幂等键
   */
  getOrCreate(intentKey: string): string {
    const existing = this.keys.get(intentKey);
    if (existing) {
      return existing;
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.keys.set(intentKey, generated);
    return generated;
  }

  /**
   * 销毁指定意图键（在收到 2xx 或 4xx 确定结果后调用）。
   *
   * @param intentKey 业务意图标识
   */
  clear(intentKey: string): void {
    this.keys.delete(intentKey);
  }
}

/** 全局共享幂等键管理器实例。 */
export const idempotencyKeyManager = new IdempotencyKeyManager();

/** API 请求参数选项。 */
export interface ApiRequestOptions<TSchema extends z.ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  userId?: string;
  skipAuth?: boolean;
  idempotencyKey?: string;
  schema: TSchema;
  signal?: AbortSignal;
}

/** 解包后的成功响应结构。 */
export interface ApiRequestResult<TData> {
  data: TData;
  meta?: ResponseMeta;
  status: number;
}

/**
 * 发送强类型 API 请求，自动注入身份头并按共享 Zod Schema 校验返回体。
 *
 * @param path 接口路径（例如 `/api/events`）
 * @param options 请求配置与响应 data Schema
 * @returns 解包并校验后的 `{ data, meta, status }`
 * @throws {ApiError} 当网络失败、服务端返回错误或契约校验失败时抛出
 */
export async function apiRequest<TSchema extends z.ZodTypeAny>(
  path: string,
  options: ApiRequestOptions<TSchema>,
): Promise<ApiRequestResult<z.infer<TSchema>>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (!options.skipAuth) {
    headers['X-User-Id'] = options.userId ?? getStoredUserId();
  }

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  let bodyText: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: bodyText,
      signal: options.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络连接失败，请稍后重试';
    throw new ApiError(0, 'NETWORK_ERROR', message);
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      `服务端返回了非 JSON 响应 (HTTP ${response.status})`,
    );
  }

  if (!response.ok) {
    const parsedError = ApiErrorEnvelopeSchema.safeParse(rawJson);
    if (parsedError.success) {
      throw new ApiError(
        response.status,
        parsedError.data.error.code,
        parsedError.data.error.message,
        parsedError.data.error.details,
      );
    }
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      `请求失败 (HTTP ${response.status})`,
      rawJson,
    );
  }

  const envelopeSchema = createSuccessEnvelopeSchema(options.schema);
  const parsedSuccess = envelopeSchema.safeParse(rawJson);
  if (!parsedSuccess.success) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      '响应数据不符合共享契约 Schema',
      parsedSuccess.error.flatten(),
    );
  }

  updateServerClockOffset(parsedSuccess.data.meta?.serverTime);

  return {
    data: parsedSuccess.data.data as z.infer<TSchema>,
    meta: parsedSuccess.data.meta,
    status: response.status,
  };
}

/**
 * 结合幂等键生命周期执行写请求：2xx 或 4xx 清除键，网络错误或 5xx 保留键用于安全重试。
 *
 * @param intentKey 业务意图标识
 * @param path 接口路径
 * @param options 不含 `idempotencyKey` 的请求配置
 * @returns 解包并校验后的 `{ data, meta, status }`
 */
export async function apiRequestWithIdempotency<TSchema extends z.ZodTypeAny>(
  intentKey: string,
  path: string,
  options: Omit<ApiRequestOptions<TSchema>, 'idempotencyKey'>,
): Promise<ApiRequestResult<z.infer<TSchema>>> {
  const key = idempotencyKeyManager.getOrCreate(intentKey);
  try {
    const result = await apiRequest(path, {
      ...options,
      idempotencyKey: key,
    });
    idempotencyKeyManager.clear(intentKey);
    return result;
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      idempotencyKeyManager.clear(intentKey);
    }
    throw err;
  }
}
