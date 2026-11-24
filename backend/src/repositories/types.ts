/**
 * Clean Architecture 仓储层领域实体类型、仓储接口与 TransactionManager 抽象定义。
 * 本文件严禁导入 Prisma 类型，确保 services 层与 ORM 细节完全解耦。
 */
import type {
  AdminEventTab,
  AuditTrigger,
  MyReservationStatusFilter,
  ReservationStatus,
  UserRole,
} from '@queue-reservation/shared';

/** 用户领域记录。 */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isSimulated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 活动领域记录。 */
export interface EventRecord {
  id: string;
  name: string;
  description: string;
  startTime: Date;
  endTime: Date;
  capacity: number;
  maxPerUser: number;
  confirmTimeoutSec: number;
  confirmedCount: number;
  pendingCount: number;
  lockVersion: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 预约单领域记录。 */
export interface ReservationRecord {
  id: string;
  eventId: string;
  userId: string;
  status: ReservationStatus;
  idempotencyKey: string;
  expiresAt: Date | null;
  waitlistedAt: Date | null;
  waitlistSeq: number | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 附带用户摘要的预约单记录（仅限 ADMIN 视角使用）。 */
export interface ReservationWithUserRecord extends ReservationRecord {
  user: Pick<UserRecord, 'id' | 'name' | 'email'>;
}

/** 附带活动摘要的预约单记录（用于「我的预约」列表）。 */
export interface ReservationWithEventRecord extends ReservationRecord {
  event: Pick<EventRecord, 'id' | 'name' | 'startTime' | 'endTime' | 'maxPerUser'>;
}

/** 附带操作人摘要的审计日志记录。 */
export interface AuditLogWithActorRecord {
  id: string;
  reservationId: string;
  eventId: string;
  fromStatus: ReservationStatus | null;
  toStatus: ReservationStatus;
  trigger: AuditTrigger;
  actorId: string | null;
  actorName: string | null;
  note: string;
  createdAt: Date;
}

/** 新建活动仓储入参。 */
export interface CreateEventRecordInput {
  name: string;
  description: string;
  startTime: Date;
  endTime: Date;
  capacity: number;
  maxPerUser: number;
  confirmTimeoutSec: number;
  createdById: string | null;
  now: Date;
}

/** 新建预约单仓储入参。 */
export interface CreateReservationRecordInput {
  eventId: string;
  userId: string;
  status: ReservationStatus;
  idempotencyKey: string;
  expiresAt: Date | null;
  waitlistedAt: Date | null;
  waitlistSeq: number | null;
  now: Date;
}

/** 新建审计日志仓储入参。 */
export interface CreateAuditLogInput {
  reservationId: string;
  eventId: string;
  fromStatus: ReservationStatus | null;
  toStatus: ReservationStatus;
  trigger: AuditTrigger;
  actorId: string | null;
  note: string;
  createdAt: Date;
}

/** 用户仓储接口。 */
export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  list(options: { includeSimulated: boolean }): Promise<UserRecord[]>;
  upsertMany(
    users: Array<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
      isSimulated: boolean;
    }>,
    now: Date,
  ): Promise<UserRecord[]>;
  deleteSimulated(): Promise<number>;
}

/** 活动仓储接口。 */
export interface EventRepository {
  findById(id: string): Promise<EventRecord | null>;
  listAllOrderByCreatedDesc(): Promise<EventRecord[]>;
  create(input: CreateEventRecordInput): Promise<EventRecord>;
  /**
   * 在事务首行递增 lockVersion 以获取该 Event 行的 PostgreSQL FOR NO KEY UPDATE 排他锁。
   * 若 eventId 不存在将触发 Prisma P2025。
   */
  lockForUpdate(eventId: string): Promise<EventRecord>;
  /** 按 id ASC 依次锁定全部现有活动行（供 reset-seed 维持全局加锁顺序杜绝死锁）。 */
  lockAllForUpdateAsc(): Promise<EventRecord[]>;
  /** 在行锁保护下原子增减 confirmedCount / pendingCount。 */
  adjustCounts(
    eventId: string,
    delta: { confirmedDelta: number; pendingDelta: number },
  ): Promise<EventRecord>;
  /** 在行锁保护下将活动占座计数归零（用于清空活动预约）。 */
  resetCounts(eventId: string): Promise<EventRecord>;
  deleteAll(): Promise<number>;
}

/** 预约单仓储接口。 */
export interface ReservationRepository {
  findById(id: string): Promise<ReservationRecord | null>;
  findByIdWithUser(id: string): Promise<ReservationWithUserRecord | null>;
  findByIdempotencyKey(
    eventId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<ReservationRecord | null>;
  countActiveByEventAndUser(eventId: string, userId: string): Promise<number>;
  countWaitlistedByEvent(eventId: string): Promise<number>;
  /** 批量按活动聚合候补单数（零 N+1）。 */
  countWaitlistedGroupByEvent(): Promise<Map<string, number>>;
  /** 批量按活动聚合真实占座行数（CONFIRMED + PENDING_CONFIRM），用于真实行数 oversold 校验。 */
  countActualOccupiedGroupByEvent(): Promise<Map<string, { confirmed: number; pending: number }>>;
  /** 统计单个活动的真实占座行数（CONFIRMED / PENDING_CONFIRM）。 */
  countActualOccupiedByEvent(eventId: string): Promise<{ confirmed: number; pending: number }>;
  /** 查询指定活动下全部已过期（expiresAt <= now）的 PENDING_CONFIRM 订单。 */
  findOverduePendingByEvent(eventId: string, now: Date): Promise<ReservationRecord[]>;
  /** 无锁轻量扫描存在过期锁单的去重 eventId 列表（使用 groupBy 确保 SQL 下推，按 eventId ASC）。 */
  findOverdueEventIds(now: Date): Promise<string[]>;
  /** 按 waitlistSeq ASC 查询当前活动候补队首记录。 */
  findNextWaitlisted(eventId: string): Promise<ReservationRecord | null>;
  /** 计算单条候补记录的实时顺位（1-based）。 */
  countWaitlistRank(eventId: string, waitlistSeq: number): Promise<number>;
  /** 批量拉取目标活动的候补队列有序 ID 映射（Map<reservationId, rank>），彻底消除 N+1。 */
  buildWaitlistRankMap(eventIds: string[]): Promise<Map<string, number>>;
  findActiveByUser(userId: string): Promise<ReservationRecord[]>;
  findByUserAndEvent(userId: string, eventId: string): Promise<ReservationRecord[]>;
  findByUserWithEvent(
    userId: string,
    statusFilter: MyReservationStatusFilter,
  ): Promise<ReservationWithEventRecord[]>;
  findByEventWithUser(
    eventId: string,
    tab: AdminEventTab,
  ): Promise<ReservationWithUserRecord[]>;
  create(input: CreateReservationRecordInput): Promise<ReservationRecord>;
  markConfirmed(id: string, now: Date): Promise<ReservationRecord>;
  markCancelled(id: string, now: Date): Promise<ReservationRecord>;
  markExpired(id: string, now: Date): Promise<ReservationRecord>;
  markPromoted(id: string, expiresAt: Date, now: Date): Promise<ReservationRecord>;
  deleteByEvent(eventId: string): Promise<number>;
  deleteAll(): Promise<number>;
}

/** 审计日志仓储接口。 */
export interface AuditLogRepository {
  create(input: CreateAuditLogInput): Promise<void>;
  findByReservationId(reservationId: string): Promise<AuditLogWithActorRecord[]>;
  deleteByEvent(eventId: string): Promise<number>;
  deleteAll(): Promise<number>;
}

/** 事务内可用仓储集合。 */
export interface Repositories {
  users: UserRepository;
  events: EventRepository;
  reservations: ReservationRepository;
  auditLogs: AuditLogRepository;
  /** 在当前事务内灌入初始演示数据集（供 `reset-seed` 单事务原子重建）。 */
  seedInitialData(now: Date): Promise<{ usersCount: number; eventsCount: number }>;
}

/**
 * 回调式 Unit of Work 事务管理器抽象。
 * 注意：凡会修改数据库状态的业务拒绝（如惰性过期返回 409），回调内严禁 throw，
 * 必须返回判别联合结果对象并在事务提交后由外层映射为 HTTP 错误。
 */
export interface TransactionManager {
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
