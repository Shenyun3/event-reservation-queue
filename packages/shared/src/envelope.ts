/**
 * 统一 API 成功响应信封 `{ data, meta? }` 定义与构造函数。
 */
import { z } from 'zod';

/** 跨接口通用响应元信息 Schema。 */
export const ResponseMetaSchema = z.object({
  requestId: z.string(),
  serverTime: z.string().datetime(),
  idempotentReplay: z.boolean().optional(),
  lastWorkerRunAt: z.string().datetime().nullable().optional(),
  total: z.number().int().nonnegative().optional(),
});
export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;

/**
 * 构造指定数据载荷的统一成功响应信封 Zod Schema。
 *
 * @param dataSchema 接口 `data` 字段对应的 Zod Schema。
 * @returns 包含 `data` 与可选 `meta` 的信封 Zod Schema。
 */
export function createSuccessEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: ResponseMetaSchema.optional(),
  });
}

/** 泛型成功响应信封 TypeScript 类型。 */
export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: ResponseMeta;
}
