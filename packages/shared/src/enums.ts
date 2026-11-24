/**
 * 共享领域枚举定义（纯 z.enum / as const，严禁 TS enum 以兼容 Node 26 原生类型剥离）。
 */
import { z } from 'zod';

/** 系统角色枚举值。 */
export const USER_ROLES = ['USER', 'ADMIN'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** 预约单 5 状态枚举值。 */
export const RESERVATION_STATUSES = [
  'PENDING_CONFIRM',
  'CONFIRMED',
  'WAITLISTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

/** 计入单人限购上限（maxPerUser）的活跃预约状态集合。 */
export const ACTIVE_RESERVATION_STATUSES = [
  'CONFIRMED',
  'PENDING_CONFIRM',
  'WAITLISTED',
] as const satisfies readonly ReservationStatus[];

/** 预约终态集合（对应查询过滤参数 CLOSED）。 */
export const CLOSED_RESERVATION_STATUSES = [
  'CANCELLED',
  'EXPIRED',
] as const satisfies readonly ReservationStatus[];

/** 审计日志触发源枚举值。 */
export const AUDIT_TRIGGERS = [
  'USER_ACTION',
  'SYSTEM_TIMEOUT',
  'WAITLIST_PROMOTED',
] as const;
export const AuditTriggerSchema = z.enum(AUDIT_TRIGGERS);
export type AuditTrigger = z.infer<typeof AuditTriggerSchema>;

/** C 端公开活动可用态枚举值（now >= startTime 时为 CLOSED）。 */
export const AVAILABILITY_STATUSES = [
  'AVAILABLE',
  'WAITLIST_ONLY',
  'CLOSED',
] as const;
export const AvailabilityStatusSchema = z.enum(AVAILABILITY_STATUSES);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;

/** 管理台活动详情名册 Tab 枚举值。 */
export const ADMIN_EVENT_TABS = [
  'OCCUPIED',
  'WAITLISTED',
  'CLOSED',
  'ALL',
] as const;
export const AdminEventTabSchema = z.enum(ADMIN_EVENT_TABS);
export type AdminEventTab = z.infer<typeof AdminEventTabSchema>;

/** 「我的预约」列表状态过滤枚举值。 */
export const MY_RESERVATION_STATUS_FILTERS = [
  'ALL',
  'PENDING_CONFIRM',
  'CONFIRMED',
  'WAITLISTED',
  'CLOSED',
] as const;
export const MyReservationStatusFilterSchema = z.enum(MY_RESERVATION_STATUS_FILTERS);
export type MyReservationStatusFilter = z.infer<typeof MyReservationStatusFilterSchema>;
