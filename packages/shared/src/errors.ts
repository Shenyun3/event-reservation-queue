/**
 * 共享稳定业务错误码与统一错误响应信封 Schema。
 */
import { z } from 'zod';

/** 全系统稳定业务错误码列表。 */
export const ERROR_CODE_LIST = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'USER_NOT_FOUND',
  'FORBIDDEN',
  'EVENT_NOT_FOUND',
  'RESERVATION_NOT_FOUND',
  'EVENT_ENDED',
  'MAX_PER_USER_EXCEEDED',
  'RESERVATION_EXPIRED',
  'INVALID_STATE_TRANSITION',
  'SERVICE_BUSY',
  'INTERNAL_ERROR',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODE_LIST);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** 常量字典，便于前后端类型安全引用错误码。 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  RESERVATION_NOT_FOUND: 'RESERVATION_NOT_FOUND',
  EVENT_ENDED: 'EVENT_ENDED',
  MAX_PER_USER_EXCEEDED: 'MAX_PER_USER_EXCEEDED',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  SERVICE_BUSY: 'SERVICE_BUSY',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const satisfies Record<ErrorCode, ErrorCode>;

/** 统一错误体结构 Schema。 */
export const ApiErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/** 统一错误响应信封 Schema。 */
export const ApiErrorEnvelopeSchema = z.object({
  error: ApiErrorBodySchema,
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
