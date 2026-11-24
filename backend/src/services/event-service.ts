/**
 * 活动浏览、创建与详情查询用例服务（严格按 USER / ADMIN 角色裁剪字段，全部查询零 N+1）。
 */
import {
  ACTIVE_RESERVATION_STATUSES,
  ERROR_CODES,
  type AdminEventDto,
  type AdminEventListResponse,
  type AdminEventTab,
  type CreateEventInput,
  type EventDetailResponse,
  type UserEventListResponse,
} from '@queue-reservation/shared';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import type {
  Repositories,
  ReservationRecord,
  UserRecord,
} from '../repositories/types.ts';
import {
  toAdminEventDto,
  toPublicEventDto,
  toReservationDetailDto,
  toReservationWithUserDto,
} from './mappers.ts';

/** `EventService` 构造依赖。 */
export interface EventServiceDeps {
  repos: Repositories;
  clock: Clock;
}

const ACTIVE_STATUS_SET = new Set<string>(ACTIVE_RESERVATION_STATUSES);

/** 活动与看板业务服务。 */
export class EventService {
  private readonly repos: Repositories;
  private readonly clock: Clock;

  /**
   * 创建 `EventService` 实例。
   *
   * @param deps 仓储与时钟依赖。
   */
  constructor(deps: EventServiceDeps) {
    this.repos = deps.repos;
    this.clock = deps.clock;
  }

  /**
   * 查询活动列表（按 `createdAt DESC` 排序，批量聚合零 N+1）。
   * - `USER` 视角：裁剪所有运营计数与配额字段，附加本人在各活动的 `myActiveReservations[]`；
   * - `ADMIN` 视角：返回完整规则与 `stats`（`oversold` 按真实预约行数校验）。
   *
   * @param actor 当前请求操作人。
   * @returns 按角色裁剪的活动列表 DTO。
   */
  async listEvents(
    actor: UserRecord,
  ): Promise<UserEventListResponse | AdminEventListResponse> {
    const now = this.clock.now();
    const [events, waitlistedMap] = await Promise.all([
      this.repos.events.listAllOrderByCreatedDesc(),
      this.repos.reservations.countWaitlistedGroupByEvent(),
    ]);

    if (actor.role === 'ADMIN') {
      const actualOccupiedMap =
        await this.repos.reservations.countActualOccupiedGroupByEvent();
      return events.map((event) =>
        toAdminEventDto(
          event,
          waitlistedMap.get(event.id) ?? 0,
          actualOccupiedMap.get(event.id) ?? { confirmed: 0, pending: 0 },
          now,
        ),
      );
    }

    const myActive = await this.repos.reservations.findActiveByUser(actor.id);
    const waitlistedEventIds = myActive
      .filter((r) => r.status === 'WAITLISTED')
      .map((r) => r.eventId);
    const rankMap =
      waitlistedEventIds.length > 0
        ? await this.repos.reservations.buildWaitlistRankMap(waitlistedEventIds)
        : new Map<string, number>();

    const activeByEvent = new Map<string, ReservationRecord[]>();
    for (const reservation of myActive) {
      const list = activeByEvent.get(reservation.eventId);
      if (list) {
        list.push(reservation);
      } else {
        activeByEvent.set(reservation.eventId, [reservation]);
      }
    }

    return events.map((event) => ({
      ...toPublicEventDto(event, waitlistedMap.get(event.id) ?? 0, now),
      myActiveReservations: (activeByEvent.get(event.id) ?? []).map((r) =>
        toReservationDetailDto(r, rankMap.get(r.id) ?? null),
      ),
    }));
  }

  /**
   * 创建新活动（仅限 `ADMIN` 角色）。
   *
   * @param actor 当前请求操作人。
   * @param input 已通过 Zod 校验的活动创建参数。
   * @returns 新建活动的运营视角 `AdminEventDto`。
   * @throws {AppError} 非管理员抛出 `403 FORBIDDEN`；时间窗非法抛出 `400 VALIDATION_ERROR`。
   */
  async createEvent(
    actor: UserRecord,
    input: CreateEventInput,
  ): Promise<AdminEventDto> {
    if (actor.role !== 'ADMIN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, '仅管理员可创建活动');
    }

    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    if (endTime.getTime() <= startTime.getTime()) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        '活动结束时间必须晚于开始时间',
      );
    }

    const now = this.clock.now();
    const created = await this.repos.events.create({
      name: input.name,
      description: input.description ?? '',
      startTime,
      endTime,
      capacity: input.capacity,
      maxPerUser: input.maxPerUser,
      confirmTimeoutSec: input.confirmTimeoutSec,
      createdById: actor.id,
      now,
    });

    return toAdminEventDto(created, 0, { confirmed: 0, pending: 0 }, now);
  }

  /**
   * 查询单个活动详情（按角色区分返回结构，批量内存计算 `waitlistRank` 零 N+1）。
   *
   * @param actor 当前请求操作人。
   * @param eventId 目标活动 ID。
   * @param tab 管理台名册过滤 Tab（仅 `ADMIN` 视角生效，默认 `'ALL'`）。
   * @returns `UserEventDetailResponse` 或 `AdminEventDetailResponse`。
   * @throws {AppError} 活动不存在时抛出 `404 EVENT_NOT_FOUND`。
   */
  async getEventDetail(
    actor: UserRecord,
    eventId: string,
    tab: AdminEventTab = 'ALL',
  ): Promise<EventDetailResponse> {
    const now = this.clock.now();
    const event = await this.repos.events.findById(eventId);
    if (!event) {
      throw new AppError(ERROR_CODES.EVENT_NOT_FOUND, 404, '活动不存在');
    }

    const waitlistedCount =
      await this.repos.reservations.countWaitlistedByEvent(eventId);

    if (actor.role === 'ADMIN') {
      const [actualOccupied, reservations, rankMap] = await Promise.all([
        this.repos.reservations.countActualOccupiedByEvent(eventId),
        this.repos.reservations.findByEventWithUser(eventId, tab),
        waitlistedCount > 0
          ? this.repos.reservations.buildWaitlistRankMap([eventId])
          : Promise.resolve(new Map<string, number>()),
      ]);

      return {
        roleView: 'ADMIN',
        event: toAdminEventDto(event, waitlistedCount, actualOccupied, now),
        reservations: reservations.map((r) =>
          toReservationWithUserDto(r, rankMap.get(r.id) ?? null),
        ),
      };
    }

    const myReservations = await this.repos.reservations.findByUserAndEvent(
      actor.id,
      eventId,
    );
    const hasWaitlisted = myReservations.some((r) => r.status === 'WAITLISTED');
    const rankMap = hasWaitlisted
      ? await this.repos.reservations.buildWaitlistRankMap([eventId])
      : new Map<string, number>();

    const myActiveReservations: ReservationRecord[] = [];
    const myHistory: ReservationRecord[] = [];
    for (const r of myReservations) {
      if (ACTIVE_STATUS_SET.has(r.status)) {
        myActiveReservations.push(r);
      } else {
        myHistory.push(r);
      }
    }

    return {
      roleView: 'USER',
      event: toPublicEventDto(event, waitlistedCount, now),
      myActiveReservations: myActiveReservations.map((r) =>
        toReservationDetailDto(r, rankMap.get(r.id) ?? null),
      ),
      myHistory: myHistory.map((r) => toReservationDetailDto(r, null)),
    };
  }
}
