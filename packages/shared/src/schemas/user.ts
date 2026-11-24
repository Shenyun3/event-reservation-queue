/**
 * 用户与模拟身份账号相关 Zod Schema 与 DTO 定义。
 */
import { z } from 'zod';
import { UserRoleSchema } from '../enums.ts';

/** 公开/模拟用户 DTO Schema。 */
export const UserDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: UserRoleSchema,
  isSimulated: z.boolean(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

/** `GET /api/users` 查询参数 Schema。 */
export const ListUsersQuerySchema = z.object({
  includeSimulated: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

/** `GET /api/users` 响应体 Schema。 */
export const UserListResponseSchema = z.array(UserDtoSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
