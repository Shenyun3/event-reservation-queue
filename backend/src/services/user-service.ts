/**
 * 用户查询用例服务（提供模拟账号列表与身份解析，默认过滤压测虚拟用户）。
 */
import type { UserDto } from '@queue-reservation/shared';
import type { Repositories, UserRecord } from '../repositories/types.ts';
import { toUserDto } from './mappers.ts';

/** `UserService` 构造依赖。 */
export interface UserServiceDeps {
  repos: Repositories;
}

/** 用户域业务服务。 */
export class UserService {
  private readonly repos: Repositories;

  /**
   * 创建 `UserService` 实例。
   *
   * @param deps 仓储依赖集合。
   */
  constructor(deps: UserServiceDeps) {
    this.repos = deps.repos;
  }

  /**
   * 查询模拟账号列表（默认仅返回 `isSimulated = false` 的常规演示账号）。
   *
   * @param options 查询选项，`includeSimulated` 为 `true` 时包含压测虚拟用户。
   * @returns 按角色与 ID 排序的用户 DTO 列表。
   */
  async listUsers(options: { includeSimulated: boolean }): Promise<UserDto[]> {
    const users = await this.repos.users.list({
      includeSimulated: options.includeSimulated,
    });
    return users.map(toUserDto);
  }

  /**
   * 按用户 ID 查找操作主体（供路由层 `X-User-Id` 身份解析中间件使用）。
   *
   * @param userId 请求头中的用户 ID。
   * @returns 匹配的用户记录，不存在则返回 `null`。
   */
  async findById(userId: string): Promise<UserRecord | null> {
    return this.repos.users.findById(userId);
  }
}
