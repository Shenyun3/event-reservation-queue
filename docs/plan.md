# Implementation Plan & Phase Gates (`docs/plan.md`)

本文档定义「高并发活动预约与排队候补系统（Queue & Reservation Service）」的 3 小时快速原型实施计划、Phase 拆解、Worktree 并行分工、验收门禁与降级预案。

> **关联真相源（Truth Anchors）**
> - 需求基准：[problem.md](file:///home/shenyun/dev/queue-reservation/problem.md)
> - 视觉与交互基准：[demo/](file:///home/shenyun/dev/queue-reservation/demo)（`index.html`、`event-detail.html`、`my-reservations.html`、`admin.html`、`stress-test.html`、`app.js`）
> - 架构与 API 契约：[docs/architecture.md](file:///home/shenyun/dev/queue-reservation/docs/architecture.md)
> - 数据模型与 Seed 契约：[docs/database.md](file:///home/shenyun/dev/queue-reservation/docs/database.md)
> - 架构决策与评审修订记录：[docs/decisions.md](file:///home/shenyun/dev/queue-reservation/docs/decisions.md)

---

## 0. 协作铁律与复审收敛补充

### 0.1 Worktree 隔离与看板所有权
- **1 编码 Agent = 1 独立 Worktree**：并发阶段每个子 Agent 仅修改本任务声明的文件/目录边界，严禁越界重构无关文件。
- **`docs/plan.md` 独占更新权**：子 Agent **严禁修改本文件的 `- [ ]` / `- [x]` 勾选状态**；全部勾选由主 Orchestrator Agent 在合并 Worktree 并验证退出码 `0` 后集中更新。
- **共享契约冻结**：`package.json`、`pnpm-workspace.yaml`、`packages/shared/**`、`backend/prisma/schema.prisma` 在 Phase 1 定型并冻结，后续并发编码阶段原则上不再改动（确需微调由主 Agent 串行处理）。
- **Phase 门禁**：每个 Phase 合并后必须通过确定性命令验证（退出码 `0`）并由无历史污染的只读审查 Agent 执行 `.agents/skills/phase-review/SKILL.md`（Pass 1 + Pass 2）。

### 0.2 架构复审（Re-review Go）落入编码的 6 条实现细则
以下来自 Keema 复审（`msg_837b98bdb746`）的 P2/P3 细则在 Phase 1–4 编码中强制落地：
1. **Service 层精准捕获 `P2002`（Re-review P2-1）**：严禁在全局路由中间件里把所有 `P2002` 一律当作幂等重放（因为 `reservations` 还有 `(event_id, waitlist_seq)` 唯一键、`users` 有 `email` 唯一键，且 `P2002` 会中止交互式事务、routes 层也不得直连 DB）。改为在 `ReservationService.createReservation` 中于 **`txManager.run(...)` 外部**捕获 `P2002`，**仅当确认命中 `(event_id, user_id, idempotency_key)` 约束时**再重新查询并返回 `200 + meta.idempotentReplay = true`，其余 `P2002` 交由全局错误处理映射为 `500`（编码时先实测并打印 Prisma 7 + `@prisma/adapter-pg` 的错误元信息路径 `meta.target` vs `meta.driverAdapterError.cause.constraint`）。
2. **`createApp(deps)` DI 工厂 + `FakeClock`（Re-review P2-2）**：Phase 1 必须导出 `createApp({ clock, txManager, repos, ... })` 工厂函数与可推进时间的 `FakeClock`，确保测试 #3（惰性过期 → `409` + 落库断言）与测试 #7（`now >= startTime` 截止）可在毫秒级确定性完成，无需 `sleep(10s)`。
3. **过期边界统一为半开区间（Re-review P3-3）**：全系统统一约定 **`expiresAt <= now` 即已过期，确认/取消有效锁单要求 `now < expiresAt`**，与 `releaseExpiredInLock` 及 Worker 的 `expiresAt: { lte: now }` 判定完全一致。
4. **`applyTransition` 抛异常定位为内部不变量断言（Re-review P3-4）**：`executeTransitionInLock` 必须先显式检查状态跃迁合法性，不合法时返回 `{ kind: 'INVALID_TRANSITION' }`（确保同事务内前面 `releaseExpiredInLock` 对其他过期单的回收不回滚）；`applyTransition` 内部的 `throw` 仅作为程序员误调用的兜底断言，并附清晰注释。
5. **活动开始后存量 `WAITLISTED` 的展示策略（Re-review P3-5）**：不新增 `WAITLISTED -> EXPIRED` 状态边（保持与 `architecture.md` §5.1 状态机 1:1 一致）；当 `now >= event.startTime` 时，前端在「我的预约」与「活动详情」将仍处于 `WAITLISTED` 的记录明确展示为「活动已开始，候补未转正」并禁用无效操作。
6. **README 显式说明项（Re-review P3-6）**：在 `README.md` 注明 (a) 临近活动开始时 `expiresAt` 被钳制到 `startTime` 可能导致确认窗口短于 `confirmTimeoutSec`；(b) `X-User-Id` 为原型模拟切换头，非生产认证安全边界；(c) 演示首屏倒计时过期后可点击「重置演示数据」重放。

---

## 1. Phase 总览与时间预算（总计 ~150 分钟，留 30 分钟缓冲）

| Phase | 目标 | 执行模式 | 预计耗时 | 核心交付物 |
| :--- | :--- | :--- | :---: | :--- |
| **Phase 1** | Monorepo 骨架、共享契约、Prisma 7 迁移与 Seed、DI/测试基座、前端脚手架 | 串行（主 Agent） | 25 min | `packages/shared`、`prisma/schema.prisma` + `CHECK` 迁移、`seed.ts`、`createApp` + `FakeClock`、前端 Vite/shadcn 脚手架 |
| **Phase 2** | **P0 完整闭环**：后端全量业务/Worker/路由/8 组强一致集成测试 + 前端 4 个核心页面与审计抽屉 | **双 Worktree 并行**（`wt-backend-p0` ∥ `wt-frontend-p0`） | 55 min | 12 个 P0 API + 10s Worker + 8 组必过集成测试；4 个核心页面 + Topbar + AuditDrawer + 3s 轮询 |
| **Phase 3** | **P1 并发压测加分项** + 全栈联调与端到端冒烟 | **双 Worktree 并行**（`wt-backend-p1` ∥ `wt-frontend-p1`）+ 联调 | 35 min | `DELETE .../reservations`、`POST .../simulate-burst` + 集成测试；`/stress-test` 压测页；全流程联调通过 |
| **Phase 4** | Docker Compose 一键启动、README 交付文档与终检 | 串行（主 Agent） | 25 min | `compose.yaml`、前后端 `Dockerfile`、`nginx.conf`、`README.md`、一键拉起冒烟与终审 |

---

## 2. 分阶段任务清单与验收标准

### Phase 1：Monorepo 基座、共享契约、数据库迁移与脚手架（串行锁定）

> **独占范围**：根配置文件、`packages/shared/**`、`backend/prisma/**`、`backend/prisma.config.ts`、`backend/src/lib/**`、`backend/src/repositories/**`、`backend/tests/integration/helpers/**`、`frontend/` 基础脚手架与 `src/components/ui/**`。

- [x] **1.1 根 Monorepo 与脚本基座**
  - 创建根 `package.json`（锁定 `"packageManager": "pnpm@12.21.0"`，配置 `dev`、`build`、`typecheck`、`test`、`db:migrate`、`db:seed`、`db:generate` 脚本）、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.env.example`。
  - 更新 `.gitignore`：忽略 `node_modules/`、`dist/`、`.logs/`、`backend/src/generated/prisma/`、`.env`。
  - 提供开发启动脚本将前后端日志分别实时写入 `.logs/backend.log` 与 `.logs/frontend.log`。
- [x] **1.2 `packages/shared` 单一真实契约（source-only，禁 TS `enum`）**
  - `packages/shared/package.json` 声明 `exports: { ".": "./src/index.ts" }`。
  - `src/enums.ts`：用 `z.enum([...])` + `as const` 定义 `UserRole`、`ReservationStatus`、`AuditTrigger`、`AvailabilityStatus`（`AVAILABLE | WAITLIST_ONLY | CLOSED`）、`AdminEventTab`（`OCCUPIED | WAITLISTED | CLOSED | ALL`）、`MyReservationStatusFilter`（`ALL | PENDING_CONFIRM | CONFIRMED | WAITLISTED | CLOSED`）。**严禁使用 TS `enum` / `namespace` / 参数属性**。
  - `src/errors.ts`：定义全部 12 个稳定 `ErrorCode`（含 `SERVICE_BUSY`）与 `ApiErrorBodySchema`。
  - `src/envelope.ts`：定义泛型 `{ data, meta? }` 成功信封与 `{ error }` 错误信封 Schema。
  - `src/schemas/`：按域拆分 `user.ts`、`event.ts`、`reservation.ts`、`audit.ts`、`admin.ts`、`stress.ts` 请求/响应 Zod Schema 与导出 TypeScript 类型（严格区分 `PublicEventDto` 与 `AdminEventDto`、区分 `USER` 与 `ADMIN` 取消响应）。
- [x] **1.3 Prisma 7 数据模型、物理 `CHECK` 迁移与 Seed**
  - 创建 `backend/prisma.config.ts`（`datasource.url = env('DATABASE_URL')`，`migrations.seed = 'tsx prisma/seed.ts'`）。
  - 创建 `backend/prisma/schema.prisma`（`provider = "prisma-client"`、`output = "../src/generated/prisma"`、`datasource db` 不写 `url`；完整映射 `User`、`Event`、`Reservation`（含 `waitlistSeq` + `@@unique([eventId, waitlistSeq])` + `@@index([eventId, status, waitlistSeq])`）、`ReservationAuditLog`）。
  - 通过 `prisma migrate dev --create-only` 生成首份受版本控制的 `migration.sql`，手工追加 [docs/database.md](file:///home/shenyun/dev/queue-reservation/docs/database.md) §3.3 与 §3.4 定义的全部 `events` 与 `reservations` 物理 `CHECK` 约束，再执行 `prisma migrate deploy` 与 `prisma generate`。
  - 实现 `backend/prisma/seed.ts`：对齐 `docs/database.md` §5（6 常规用户、2 活动 `evt-1` `confirmTimeoutSec=600, lockVersion=3` / `evt-2` `confirmTimeoutSec=120, lockVersion=4`、7 预约单含 `res-106` 剩余 `110s` 与 `res-107` `waitlistSeq=4`、11 条审计日志）；启动时若库非空仅 `upsert` 6 用户后跳过（幂等不覆盖运行数据）；导出 `seedDatabase(tx, clock)` 供 `reset-seed` 复用。
- [x] **1.4 后端核心基础设施、仓储接口与 `createApp` DI 工厂**
  - `backend/src/lib/env.ts`（Zod 校验 `DATABASE_URL`、`DATABASE_URL_TEST`、`DB_POOL_MAX=30`、`PORT=3000`、`ENABLE_EXPIRATION_WORKER=true`）。
  - `backend/src/lib/prisma.ts`：创建 `@prisma/adapter-pg` + `pg` Pool（`max: env.DB_POOL_MAX`）。
  - `backend/src/lib/clock.ts`：`Clock` 接口、`SystemClock`、测试用可推进时间的 `FakeClock`。
  - `backend/src/lib/errors.ts`：`AppError` 与 Prisma 错误识别工具（准确识别 `P2025`、`P2028`、`P2034` 以及按约束名识别幂等 `P2002`）。
  - `backend/src/lib/logger.ts`：结构化 JSON 日志器（脱敏）。
  - `backend/src/repositories/`：定义 `UserRepository`、`EventRepository`（含 `lockForUpdate`、`lockAllForUpdateAsc`、`adjustCounts`）、`ReservationRepository`（含 `findOverduePendingByEvent`、`findOverdueEventIdsGroupBy`、`findNextWaitlisted`、`countWaitlistedByEvent`、`countActualOccupiedByEvent`、`findWaitlistSeqsByEvent`）、`AuditLogRepository`、`TransactionManager` 接口及 Prisma 实现（`PrismaTransactionManager` 配置 `{ maxWait: 10_000, timeout: 10_000 }`）。
  - `backend/src/app.ts`：导出 `createApp(deps)` DI 工厂骨架与 `/api/health` 路由。
  - `backend/tests/integration/helpers/db.ts`：实现 `resetTestDb()`（使用 `DATABASE_URL_TEST` 执行 `TRUNCATE TABLE "reservation_audit_logs", "reservations", "events", "users" RESTART IDENTITY CASCADE`）与 `assertEventInvariants(prisma, eventId, now)`（断言全部 4 条数据库不变量）。
- [x] **1.5 前端 Vite + React + Tailwind + shadcn/ui 脚手架**
  - 初始化 `frontend/`（React 19 / TypeScript / Vite / Tailwind CSS / React Router / TanStack Query），配置 Vite `/api` 代理到 `http://localhost:3000`。
  - 安装并落盘 `frontend/src/components/ui/` 原语（`button`、`card`、`badge`、`dialog`、`sheet`、`table`、`tabs`、`input`、`select`、`label`、`skeleton`、`sonner`/Toast 等，保持领域无关）。
  - 实现 `frontend/src/lib/api-client.ts`（自动注 `X-User-Id`、统一解包 `{ data, meta }`、维护 `serverTime` 偏移校准工具、封装 `Idempotency-Key` 生命周期管理工具与 `ApiError`）及 `frontend/src/lib/user-context.tsx`（当前模拟身份上下文，持久化于 `localStorage`）。

**Phase 1 验收门禁**：
- [x] PostgreSQL 17 已就绪（开发库与 `DATABASE_URL_TEST` 均已跑通 `prisma migrate deploy`），物理 `CHECK` 约束已生效（实测插入违背约束的记录被 DB 拒绝）。
- [x] `pnpm --filter @queue-reservation/backend db:seed` 连续执行两次均退出码 `0` 且无重复脏数据。
- [x] `pnpm typecheck` 与 `pnpm --filter @queue-reservation/frontend build` 退出码 `0`。
- [x] `createApp({ clock: fakeClock, ... })` 在 Vitest 冒烟测试中 `GET /api/health` 返回 `200`。
- [x] 通过只读 `phase-review` 门禁检查（Pass 1 & Pass 2 无 P0/P1）。

---

### Phase 2：P0 核心闭环（双 Worktree 并行：`wt-backend-p0` ∥ `wt-frontend-p0`）

> **并行边界**：
> - **`wt-backend-p0`** 仅修改 `backend/src/services/**`、`backend/src/worker/**`、`backend/src/routes/**`、`backend/src/app.ts`、`backend/src/server.ts`、`backend/tests/**`。
> - **`wt-frontend-p0`** 仅修改 `frontend/src/components/layout/**`、`frontend/src/features/events/**`、`frontend/src/features/reservations/**`、`frontend/src/features/admin/**`、`frontend/src/App.tsx`、`frontend/src/main.tsx`。
> - 两者共享 Phase 1 已冻结的 `packages/shared` 契约，**零文件交叉**。

#### Track 2A：后端 P0 业务、Worker、路由与强一致集成测试（`wt-backend-p0`）

- [x] **2A.1 核心领域原语（`backend/src/services/transition.ts`）**
  - 实现 `applyTransition(fromStatus, toStatus)` 查表函数（与 `architecture.md` §5.1 状态表 1:1 对应；内部 `throw` 仅作为非法调用断言并加注释）。
  - 实现 `releaseExpiredInLock(repos, lockedEvent, now)`：扫描当前活动 `expiresAt <= now` 的 `PENDING_CONFIRM`，逐条置 `EXPIRED` + `applyTransition` 扣 `pendingCount` + 写 `SYSTEM_TIMEOUT` 审计（`createdAt: now`）；仅当 `now < event.startTime` 时调用 `promoteNextWaitlistedInLock` 转正 `waitlistSeq ASC` 队首并钳制 `expiresAt = min(now + confirmTimeoutSec, event.startTime)`。
- [x] **2A.2 Service 用例层（纯业务，零 HTTP / Prisma 耦合）**
  - `user-service.ts`：`listUsers({ includeSimulated })`（默认过滤 `isSimulated = false`）。
  - `event-service.ts`：
    - `listEvents(actor)`：按 `createdAt DESC` 查活动 + 单次 `groupBy` 统计候补单数 + 校验 `now >= startTime -> CLOSED`；`USER` 裁剪敏感运营字段并返回 `myActiveReservations[]`；`ADMIN` 返回完整规则与 `stats`（`oversold` 按真实预约行数校验）。
    - `createEvent(actor, input)`：仅 `ADMIN`，校验 `endTime > startTime` 等参数并写入 `createdById`。
    - `getEventDetail(actor, eventId, tab)`：`USER` 返回 `{ event: PublicEventDto, myActiveReservations, myHistory }`；`ADMIN` 返回 `{ event: AdminEventDto, reservations }`（`WAITLISTED` Tab 按 `waitlistSeq ASC` 排序，其余按 `updatedAt DESC`，批量内存算 `waitlistRank` 零 N+1）。
  - `reservation-service.ts`：
    - `createReservation(actor, eventId, idempotencyKey)`：禁 `ADMIN`（`403`）；严格按 `lockForUpdate` → `now` → `releaseExpiredInLock` → **幂等查找（返回最新当前状态）** → `EVENT_ENDED`（`now >= startTime`）→ `maxPerUser` → `remaining > 0 && waitlistedCount === 0` 分配 `PENDING_CONFIRM` 或 `WAITLISTED`（`waitlistSeq = lockedEvent.lockVersion`）→ 写审计；在 `txManager.run` 外捕获 `P2002` 并仅在命中幂等唯一键时重读返回 `200 + idempotentReplay=true`。
    - `confirmReservation(actor, reservationId)` & `cancelReservation(actor, reservationId)`：锁前读取仅拿 `eventId` → 锁 `Event` → `now` → `releaseExpiredInLock` → **锁内重读 `Reservation`** → 鉴权（本人或 `ADMIN`）→ 若本事务刚被惰性置为 `EXPIRED` 返回 `{ kind: 'LAZILY_EXPIRED' }` → 校验 `now < expiresAt` 与合法状态跃迁（不合法返回 `{ kind: 'INVALID_TRANSITION' }` 不回滚前面过期回收）→ `applyTransition` 改计数 + 写审计（取消且 `now < startTime` 触发 FIFO 转正）→ 提交后由外层映射 `409` 并按角色裁剪（**`USER` 取消返回 `promotedReservation: null`**，`ADMIN` 返回完整转正 DTO）。
    - `listMyReservations(actor, statusFilter)`：支持 `ALL | PENDING_CONFIRM | CONFIRMED | WAITLISTED | CLOSED`，批量计算实时 `waitlistRank`（零 N+1）。
    - `getAuditLogs(actor, reservationId)`：仅本人或 `ADMIN`，按 `(createdAt ASC, id ASC)` 返回完整时间线。
    - `expireOverdueReservations()`：无锁 `groupBy({ by: ['eventId'] })` 扫描 `expiresAt <= now` 活动，按 `eventId ASC` 逐个开锁事务调用 `releaseExpiredInLock`，更新 `lastWorkerRunAt`。
  - `admin-service.ts`：`resetSeed(actor)` 在单事务内按 `id ASC` 锁定全部现有 `Event` 行，再按 `reservation_audit_logs -> reservations -> events -> users(isSimulated=true)` 顺序清空并调用 `seedDatabase`。
- [x] **2A.3 后台 10 秒超时巡检 Worker（`backend/src/worker/expiration-worker.ts`）**
  - `setInterval` 10 秒周期、`isRunning` 防重入锁、内存记录 `lastWorkerRunAt`、`ENABLE_EXPIRATION_WORKER` 开关控制、`stop()` 优雅等待当前轮次结束。
- [x] **2A.4 路由层、全局错误处理与启动入口（`backend/src/routes/**`、`app.ts`、`server.ts`）**
  - 实现全部 12 个 P0 路由（`GET /api/health`、`GET /api/users`、`GET /api/events`、`POST /api/events`、`GET /api/events/:eventId`、`POST /api/events/:eventId/reservations`、`GET /api/reservations/me`、`POST /api/reservations/:id/confirm`、`POST /api/reservations/:id/cancel`、`GET /api/reservations/:id/audit-logs`、`POST /api/admin/worker/expire`、`POST /api/admin/reset-seed`）。
  - 中间件：`requestId` 注入、结构化请求日志、`X-User-Id` 身份解析（区分 `401 UNAUTHORIZED` 与 `401 USER_NOT_FOUND`）、`Idempotency-Key` 必填校验（`400 VALIDATION_ERROR`）、响应信封包装（含 `requestId`、`serverTime`）。
  - 全局 `onError`：`AppError`、`ZodError -> 400 VALIDATION_ERROR`、`P2025 -> 404 EVENT_NOT_FOUND`、`P2028/P2034 -> 503 SERVICE_BUSY`、未知异常打堆栈日志并返回脱敏 `500 INTERNAL_ERROR`。
  - `server.ts`：启动 `@hono/node-server`，按配置挂载 Worker，监听 `SIGINT`/`SIGTERM` 优雅停机并释放 Prisma 连接池。
- [x] **2A.5 必过 Vitest 集成测试矩阵（`backend/tests/integration/**`，`fileParallelism: false`）**
  - 每条用例开始前调用 `resetTestDb()`，结束后强制调用 `assertEventInvariants(prisma, eventId, clock.now())`：
    - **测试 #1（20 抢 5 防超卖）**：动态创建 20 用户、`capacity=5, maxPerUser=1`，`Promise.all` 并发 `app.request('POST /api/events/:id/reservations')`，断言 5 `PENDING_CONFIRM`、15 `WAITLISTED`、零超卖、`waitlistSeq` 严格递增无重复。
    - **测试 #2（取消转正 + RBAC 防泄露）**：取消 `CONFIRMED` 与 `PENDING_CONFIRM` 均触发 FIFO 队首转正；验证 `USER` 取消返回 `promotedReservation: null`，`ADMIN` 取消返回完整转正 DTO。
    - **测试 #3（惰性过期落库 + 409）**：用 `FakeClock` 推进越过 `expiresAt`，调用 `confirm` 返回 `409 RESERVATION_EXPIRED` 且 DB 中该单已落库为 `EXPIRED`、候补队首已转正；同样验证对已过期锁单调用 `cancel` 也落库 `EXPIRED`+转正并返回 `409 RESERVATION_EXPIRED`。
    - **测试 #4（并发 `cancel × 2` 防 TOCTOU）**：同一确认单并发发两次 `cancel`，断言 1 次 `200` + 1 次 `409 INVALID_STATE_TRANSITION`，仅转正 1 人、计数严格守恒。
    - **测试 #5（严格幂等双击）**：`maxPerUser=1` 下同 `Idempotency-Key` 并发提交两次 → 1 次 `201` + 1 次 `200 (idempotentReplay=true)`，不误报限购；原单确认/取消后再次重放返回最新状态。
    - **测试 #6（`maxPerUser = 2` 多单流转）**：同一用户在 `capacity=1, maxPerUser=2` 活动下先后拿到 1 单 `PENDING_CONFIRM` 与 1 单 `WAITLISTED`，验证各自取消/转正与计数守恒。
    - **测试 #7（`EVENT_ENDED` 截止边界）**：用 `FakeClock` 推进到 `now >= startTime`，断言新预约返回 `409 EVENT_ENDED`、`availabilityStatus === 'CLOSED'`，且过期回收与取消均不再触发候补转正。
    - **测试 #8（RBAC 隔离与 Worker 巡检）**：`USER` 调用活动列表/详情确认敏感计数已裁剪、`USER` 调 Admin 接口返回 `403`、`ADMIN` 下单返回 `403`、`POST /api/admin/worker/expire` 正确回收多活动过期单并转正。

#### Track 2B：前端 P0 布局、4 核心页面与审计抽屉（`wt-frontend-p0`）

> 严格对齐 [demo/](file:///home/shenyun/dev/queue-reservation/demo) 的页面跳转、角色视野与交互闭环；全部基础组件复用 `src/components/ui/`；所有异步视图完整处理 `loading / empty / error / success` 四态。

- [x] **2B.1 全局 Topbar 与审计详情抽屉（`frontend/src/components/layout/`）**
  - `Topbar.tsx`：角色导航（`USER` 见「活动大厅」「我的预约」；`ADMIN` 见「活动看板」「运营管理台」「20人并发压测」），模拟身份切换下拉（接入 `GET /api/users`），`ADMIN` 专属快捷操作「立即触发超时巡检」（`POST /api/admin/worker/expire`）与「重置演示数据」（`POST /api/admin/reset-seed`）及 `lastWorkerRunAt` 显示。
  - `AuditDrawer.tsx`：基于 `shadcn/ui` `Sheet`，接入 `GET /api/reservations/:id/audit-logs`，按时间线展示状态变化、触发源标签（`USER_ACTION` / `SYSTEM_TIMEOUT` / `WAITLIST_PROMOTED`）、操作人、备注与时间戳。
  - `CountdownBadge.tsx`：基于 `expiresAt` 与服务端 `meta.serverTime` 偏移量本地每秒递减倒计时，归零后触发一次 query 刷新。
- [x] **2B.2 活动大厅 / 实时看板页（`/`，对齐 `demo/index.html`）**
  - 接入 `GET /api/events`（TanStack Query `refetchInterval: 3000`）。
  - `USER` 视图：仅展示公开信息、`availabilityStatus` 标签（可预约 / 仅候补 / 已截止）与本人在该活动的活跃预约摘要；点击进入详情页。
  - `ADMIN` 视图：展示顶部全局 KPI + 每个活动的容量、已确认、待确认锁单、候补单数、剩余可用名额与防超卖一致性徽标，快捷跳转活动详情与压测页。
- [x] **2B.3 活动详情页（`/events/:eventId`，对齐 `demo/event-detail.html`）**
  - 接入 `GET /api/events/:eventId`（`refetchInterval: 3000`）。
  - `USER` 视图：完整支持 **`maxPerUser > 1`** —— 渲染本人在该活动的**全部活跃预约列表**（每条独立展示倒计时/候补顺位/确认/取消/查看审计按钮），只要 `myActiveReservations.length < event.maxPerUser` 且活动未截止即展示「发起预约 / 登记候补」按钮（严格维护 `Idempotency-Key` 生命周期，防双击；对已开始活动的存量 `WAITLISTED` 展示「活动已开始，候补未转正」），下方展示本人历史记录。
  - `ADMIN` 视图：展示活动实时 KPI、`OCCUPIED / WAITLISTED / CLOSED / ALL` 名册 Tabs、每行操作（代确认、强制取消、查看审计抽屉）。
- [x] **2B.4 我的预约页（`/my-reservations`，对齐 `demo/my-reservations.html`）**
  - `USER` 专属（`ADMIN` 访问展示明确身份提示与跳转链接）；接入 `GET /api/reservations/me?status=...`（`ALL | PENDING_CONFIRM | CONFIRMED | WAITLISTED | CLOSED`，`refetchInterval: 3000`）。
  - 支持行内确认、取消、倒计时、实时候补顺位展示与审计抽屉。
- [x] **2B.5 运营管理台（`/admin`，对齐 `demo/admin.html`）**
  - `ADMIN` 专属守卫（非 `ADMIN` 展示权限拦截卡，与 `demo/admin.html` 一致）。
  - 左侧/上方「创建新活动」表单（Zod 校验名称、简介、开始/结束时间、容量、单人限购 `maxPerUser`、确认超时秒数 `>= 10`），提交 `POST /api/events` 后即时刷新看板；右侧展示活动汇总表与快捷入口（含可建 `maxPerUser = 2` 活动演示多单交互）。

**Phase 2 验收门禁**：
- [x] 合并 `wt-backend-p0` 与 `wt-frontend-p0` 后，执行 `pnpm typecheck && pnpm build` 退出码 `0`。
- [x] 执行 `pnpm --filter @queue-reservation/backend test`（真实 PostgreSQL `DATABASE_URL_TEST`），8 组集成测试 + `assertEventInvariants` 全部通过（退出码 `0`）。
- [x] 启动本地后端与前端，核实 `.logs/backend.log` 与 `.logs/frontend.log` 无未捕获异常或 500 报错；验证 User 与 Admin 核心闭环真实联通。
- [x] 通过只读 `phase-review` 门禁检查（Pass 1 & Pass 2 无 P0/P1）。

---

### Phase 3：P1 并发压测加分能力与全栈联调（双 Worktree 并行：`wt-backend-p1` ∥ `wt-frontend-p1`）

> **并行边界**：
> - **`wt-backend-p1`** 仅修改 `backend/src/services/stress-service.ts`、`backend/src/routes/stress.ts`、`backend/src/app.ts`（仅挂载压测路由）、`backend/tests/integration/stress.test.ts`。
> - **`wt-frontend-p1`** 仅修改 `frontend/src/features/stress-test/**`、`frontend/src/App.tsx`（仅挂载 `/stress-test` 路由）。

- [x] **3A.1 后端 P1 压测接口与测试（`wt-backend-p1`）**
  - 实现 `DELETE /api/events/:eventId/reservations`（`ADMIN` 专属）：事务内先 `lockForUpdate(eventId)`，按 `reservation_audit_logs -> reservations` 删除并归零 `confirmedCount = 0, pendingCount = 0`。
  - 实现 `POST /api/events/:eventId/simulate-burst`（`ADMIN` 专属）：校验 `concurrency` 位于 `1 ~ min(25, DB_POOL_MAX - 5)`；批量准备 `isSimulated = true` 虚拟用户（`sim-${batchId}-${i}`、`并发用户 #01..`、`sim-${batchId}-${i}@sim.local`）；使用 `Promise.all` 同毫秒并发调用真实 `ReservationService.createReservation`；基于 **`Reservation` 表真实行数**计算 `summary.oversold` 并返回完整逐笔战报。
  - 新增 `backend/tests/integration/stress.test.ts`：覆盖清空活动 + `simulate-burst(concurrency=20)` 抢 `capacity=5`、`oversold === false`、`assertEventInvariants` 通过及 `GET /api/users` 不含压测虚拟用户。
- [x] **3B.1 前端 P1 20 人并发压测实验室（`wt-frontend-p1`，对齐 `demo/stress-test.html`）**
  - 实现 `/stress-test` 页面（`ADMIN` 专属守卫）：活动选择下拉、并发人数输入（`1 ~ 25`，默认 `20`）、「清空该活动预约」按钮、「发起并发抢购」按钮。
  - 展示目标活动实时 KPI、强一致无超卖徽标、本次压测战报汇总与逐笔明细表（序号、模拟用户、`Idempotency-Key`、结果状态标签、候补顺位、单笔耗时、点击打开 `AuditDrawer` 查看审计时间线）。
- [x] **3.2 全栈端到端联调冒烟（主 Agent）**
  - 本地拉起完整服务，对照 `demo/` 完整走查：User 预约/双击幂等/倒计时/确认/取消/我的预约/审计抽屉 + Admin 看板/新建 `maxPerUser=2` 活动/代确认/强制取消/手动巡检/20 人并发压测/重置演示数据；检查 `.logs/backend.log` 与 `.logs/frontend.log` 零异常。

**Phase 3 验收门禁**：
- [x] `pnpm typecheck && pnpm build && pnpm --filter @queue-reservation/backend test` 退出码 `0`。
- [x] 压测页实测「清空 → 20 路并发抢 5 席」战报显示 `5 PENDING_CONFIRM + 15 WAITLISTED + 0 FAILED + 强一致无超卖`，且 `GET /api/users` 仍仅返回 6 个常规账号。
- [x] 通过只读 `phase-review` 门禁检查（Pass 1 & Pass 2 无 P0/P1）。

---

### Phase 4：Docker Compose 一键部署、README 交付文档与终检（串行）

- [x] **4.1 后端容器镜像（`backend/Dockerfile`）**
  - 基于已验证镜像 `node:26.13.1-slim` + `corepack enable`（锁定 `pnpm@12.21.0`）。
  - 拷贝根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`packages/shared`、`backend`。
  - 构建期执行 `pnpm install --frozen-lockfile` 与 `pnpm --filter @queue-reservation/backend prisma generate`。
  - 运行镜像保留 `prisma` CLI 与 `tsx`，启动命令自动执行 `prisma migrate deploy && prisma db seed && pnpm --filter @queue-reservation/backend start`（默认 `DB_POOL_MAX=30`、`ENABLE_EXPIRATION_WORKER=true`）。
- [x] **4.2 前端容器镜像与反向代理（`frontend/Dockerfile`、`frontend/nginx.conf`）**
  - 多阶段构建：Node `26.13.1-slim` 构建 Vite 静态产物 → `nginx:1.27-alpine` 托管 SPA（`try_files $uri $uri/ /index.html;`）并将 `/api/*` 反向代理至 `http://backend:3000`。
- [x] **4.3 一键编排（`compose.yaml`）**
  - 编排 `postgres`（`postgres:17-alpine` + `pg_isready` healthcheck + 数据卷）、`backend`（`depends_on: postgres (service_healthy)`，映射 `3000:3000`）、`frontend`（`depends_on: backend`，映射 `5173:80`）。
- [x] **4.4 交付文档（`README.md`）**
  - 一键启动命令（`docker compose up --build`）与访问地址（前端 `http://localhost:5173`、后端 `http://localhost:3000/api/health`）。
  - 本地开发与集成测试运行指南（含 `DATABASE_URL_TEST` 与 8 组测试说明）。
  - 演示脚本与已知原型边界声明：`X-User-Id` 非安全边界、`expiresAt` 钳制至 `startTime` 的窗口缩短说明、首屏倒计时过期后点击「重置演示数据」重放说明、Admin 新建 `maxPerUser=2` 活动演示多单交互说明。

**Phase 4 最终交付门禁**：
- [x] `docker compose up --build -d` 成功拉起全部 3 个服务且无重启崩溃循环。
- [x] 容器实测冒烟：`GET /api/health` 返回 `200`（`db: 'up'`）、`GET /api/events`（`X-User-Id: u1` 裁剪敏感字段，`X-User-Id: admin` 返回完整看板）、前端 `http://localhost:5173` 可正常访问且 `/api/*` 代理畅通。
- [x] `pnpm typecheck && pnpm build && pnpm --filter @queue-reservation/backend test` 退出码 `0`。
- [x] 通过最终只读 `phase-review` 双轮盲审（Pass 1 & Pass 2 零 P0/P1）。

---

## 3. 限时原型降级与可裁剪顺序（应急预案）

若 3 小时内时间紧张，按**从先砍到后砍**的严格顺序确保核心 P0 闭环与自动化测试不缩水：
1. **最先可砍**：Phase 3 的 P1 并发压测页与 `simulate-burst` / `DELETE /api/events/:eventId/reservations` 接口（并发防超卖仍由 Vitest 集成测试 100% 证明）。
2. **其次可砍**：`POST /api/admin/reset-seed` 快捷按钮（保留容器启动 `prisma db seed`）。
3. **再次可降级**：Admin 活动详情 `?tab` 服务端过滤可降级为前端本地过滤全量名册。
4. **明确不做**：SSE 实时推送保持在 `docs/architecture.md` §11 未来演进路线，不在 MVP 范围。

---

## 4. 确定性验证命令速查

```bash
# 全仓类型检查与构建
pnpm typecheck
pnpm build

# 数据库迁移、客户端生成与幂等 Seed
pnpm --filter @queue-reservation/backend db:generate
pnpm --filter @queue-reservation/backend db:migrate
pnpm --filter @queue-reservation/backend db:seed

# 真实 PostgreSQL 并发与状态机集成测试（使用 DATABASE_URL_TEST，串行文件执行）
pnpm --filter @queue-reservation/backend test

# Docker Compose 一键验收
docker compose up --build -d
curl -sf http://localhost:3000/api/health
curl -sf -H "X-User-Id: u1" http://localhost:5173/api/events
curl -sf -H "X-User-Id: admin" http://localhost:5173/api/events
```
