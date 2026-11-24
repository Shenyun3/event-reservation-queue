# Architecture Decision Records (`docs/decisions.md`)

本文档集中记录本项目的所有关键技术与架构决策（ADR）以及架构评审修订追踪。每条决策均按「**背景 → 备选方案对比 → 最终决定与理由 → 权衡与演进 → 面试一句话总结**」组织，便于开发对齐、项目复盘与面试表达。

---

## ADR-001：采用 `pnpm workspace` 单仓与 `packages/shared` 共享契约

- **背景**：项目为前后端分离的全栈 TypeScript 应用，涉及较多的状态枚举（5 种预约状态、3 种审计触发源、3 种公开可用态）、错误码以及前后端接口 DTO。如何在 3 小时内避免前后端字段漂移、降低联调成本？
- **备选方案对比**：
  - **方案 A（独立 `backend/` + `frontend/` 无共享包）**：零根配置成本，但 Zod Schema 和类型需两边手写维护，改字段容易漏同步。
  - **方案 B（`pnpm workspace` + `packages/shared`）**：共享 Zod Schema、Enum、ErrorCode 与统一信封定义，两端编译期强一致。
  - **方案 C（Hono RPC `hc<AppType>` 跨目录引用）**：无需共享包，但前端源码强依赖后端目录路径，容器分离构建与多 Worktree 容易踩路径坑。
- **最终决定与理由**：选择 **方案 B**。
  - 根 `package.json` 通过 `"packageManager": "pnpm@12.21.0"` + Corepack 锁定包管理器版本。
  - `packages/shared` 采用 **source-only** 消费模式（`exports: { ".": "./src/index.ts" }`），前端由 Vite 直接编译，后端由 `tsx` / `tsc` 消费。
  - 为兼容 Node 26 原生类型剥离（type stripping），`enums.ts` 统一使用 `z.enum([...])` / `as const`，**严禁使用 TS `enum`、`namespace` 与参数属性**。
- **权衡与演进**：Docker 构建时需同步拷贝 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`packages/shared` 与 `backend`；在 3 小时原型中仅多出极少配置，换来联调零字段对齐 bug。
- **面试一句话总结**：*“我们通过 pnpm workspace 抽离了 source-only 的 `packages/shared`，用 `z.enum` 兼容 Node 26 类型剥离，让前后端在编译期和运行时双重消灭接口契约漂移。”*

---

## ADR-002：后端采用 Node.js 26.13.1 + Hono + Prisma 7+，并用 `TransactionManager` 守住 Clean Architecture

- **背景**：系统要求 Clean Architecture 分层（`routes -> services -> repositories -> prisma`），同时单个预约/取消/过期操作需要跨多张表（`Event`、`Reservation`、`ReservationAuditLog`）原子提交，且在惰性过期等场景下需要“提交状态变更后再向客户端返回 409”。
- **备选方案对比**：
  - **方案 A（抽象 `TransactionManager` 回调式 Unit of Work）**：Service 仅依赖 `TransactionManager`、`Clock` 与 Repository 接口，通过 `txManager.run(async (repos) => ...)` 编排跨表事务。
  - **方案 B（Service 直接注入 `PrismaClient`）**：少写一层适配器，但 Service 强耦合 Prisma 具体实现，破坏分层边界且难以单测。
- **最终决定与理由**：选择 **方案 A**，运行时锁定已验证存在的 Docker 镜像 **`node:26.13.1-slim`** + Hono + Prisma 7+（`prisma.config.ts` + `@prisma/adapter-pg`）。
  - 连接池显式配置 `max: env.DB_POOL_MAX`（默认 `30`），交互式事务统一配置 `{ maxWait: 10_000, timeout: 10_000 }`，规避 `pg` 默认 `max=10` 与 Prisma 默认 `maxWait=2000ms` 在 20 并发下的 `P2028` 失败。
  - **结果对象优于异常抛出**：凡是已修改数据的业务拒绝（如惰性过期返回 `409`），事务回调内禁止 `throw AppError`（否则会回滚事务），必须返回判别联合结果对象并在事务提交后由外层映射为 HTTP 错误。
  - **注入 `Clock`**：统一在获取 `Event` 行锁之后取 `now = clock.now()` 并显式写入各时间戳字段，避免与数据库事务开始时间 `now()` 错位。
- **权衡与演进**：增加约 30 行接口样板代码；未来即便替换 ORM 或增加读写分离，Service 层业务逻辑零改动。
- **面试一句话总结**：*“我们用轻量的回调式 `TransactionManager` 在不侵入 Prisma 的前提下编排多表 ACID 事务，并约定含写操作的业务拒绝通过返回值在提交后映射 409，避免抛异常误回滚过期与转正。”*

---

## ADR-003：高并发防超卖采用「`Event` 行级排他锁串行化 + 集中式 `applyTransition` 计数守恒 + DB `CHECK` 上溢约束」

- **背景**：核心压测要求 20 个并发请求同毫秒抢 5 个名额，绝对不允许出现超卖（`confirmed + pending > capacity`），同时工程规范要求运行时 **ORM Only（禁止运行时手写裸 SQL）**。
- **备选方案对比**：
  - **方案 A（事务首行 `tx.event.update` 行锁 + 实时聚合）**：100% 纯 Prisma ORM、无重试风暴、不同活动互不阻塞，但缺少数据库单行计数上溢防线。
  - **方案 B（`Serializable` 隔离级别 + `P2034` 退避重试）**：热点抢购下冲突率高，产生大量重试与延迟抖动。
  - **方案 C（乐观锁 `version` CAS + 应用层重试）**：同样不适合高冲突热点写场景，20 并发退化为重试风暴。
  - **方案 D（`Event` 行锁串行化 + `Event` 冗余计数 + 集中式查表维护 + PostgreSQL `CHECK` 约束）**：结合行锁零重试、统一计数守恒与数据库物理上溢检查。
- **最终决定与理由**：选择 **方案 D**，并明确各层防线职责边界：
  1. **主防线（行锁串行化 + 防 TOCTOU）**：任何影响活动名额的写事务首步通过纯 Prisma 执行 `tx.event.update({ where: { id }, data: { lockVersion: { increment: 1 } } })` 获取 PostgreSQL `FOR NO KEY UPDATE` 行锁（与插入 `Reservation` 外键的 `FOR KEY SHARE` 兼容不冲突），同活动串行、不同活动并行；`/confirm` 与 `/cancel` 锁前读取仅用于拿 `eventId`，**锁后必须在事务内重新读取 `Reservation`** 杜绝 TOCTOU 重复扣减。
  2. **计数守恒保障（防计数偏低漂移）**：所有状态跃迁的计数增减统一收口到单一纯函数 `applyTransition(from, to)`；管理台与压测的 `oversold` 指标按 **`Reservation` 真实行数**计算；每条集成测试结束后执行 `assertEventInvariants(eventId)` 校验计数与真实行严格相等。
  3. **物理上溢防线（`CHECK`）**：在 Migration DDL 添加 `CHECK (confirmed_count + pending_count <= capacity)` 与非负约束，防止计数字段上溢或减成负数（不夸大其能检测“漏加计数漂移”）。
  4. **零死锁**：全局统一加锁顺序 `events -> reservations -> reservation_audit_logs`；`reset-seed` 按 `id ASC` 锁定全部现有活动后再清空。
- **权衡与演进**：未来若单活动瞬时 QPS 达万级，可在前置引入 Redis Lua 令牌预扣削峰，DB 行锁与计数守恒继续作为最终落库防线。
- **面试一句话总结**：*“在纯 ORM 约束下，我们以事务首行更新 `Event.lockVersion` 获取 `FOR NO KEY UPDATE` 行锁串行化为主防线，锁内强制重读防 TOCTOU，用集中式 `applyTransition` 查表与集成测试不变量断言保证计数不漂移，再辅以数据库 `CHECK` 防止计数上溢。”*

---

## ADR-004：发起预约强制校验 `Idempotency-Key`（严格模式）

- **背景**：前端弱网重试或用户快速连击容易产生重复预约请求，导致误报限购或产生脏数据。
- **备选方案对比**：
  - **方案 A（严格模式）**：`POST /api/events/:eventId/reservations` 强制要求请求头携带 `Idempotency-Key`，缺失返回 `400 VALIDATION_ERROR`；以 `(eventId, userId, idempotencyKey)` 建立数据库唯一索引，命中重放返回该预约单的**最新当前状态**（HTTP `200` + `meta.idempotentReplay = true`）。
  - **方案 B（宽松模式）**：缺失时后端自动生成随机 UUID 兜底。
- **最终决定与理由**：选择 **方案 A**。
  - **锁内固定检查顺序**：`lockForUpdate` → `now` → `releaseExpiredInLock` → **幂等查找** → `EVENT_ENDED` → `maxPerUser` → 名额分配，确保 `maxPerUser = 1` 时双击第二下不会误触发 `409`。
  - **作用域说明**：唯一键有意包含 `eventId`，同一 key 跨活动提交不算冲突；数据库 `P2002` 兜底触发时重读并按 `200 + idempotentReplay=true` 返回。
  - **前端 Key 生命周期**：每次用户发起提交意图生成新 UUID，仅在网络异常或 `5xx`/`503` 重试时复用，收到 `2xx` 或明确 `4xx` 后立即作废。
- **权衡与演进**：调用方（前端、curl、集成测试）都必须显式传 Header；若未来需要跨资源幂等，可扩展独立 `idempotency_keys` 通用幂等表。
- **面试一句话总结**：*“我们将 `Idempotency-Key` 设为强制请求头，把幂等查找固定在行锁后、限购与截止检查之前，配合联合唯一索引 `P2002` 兜底与前端重试复用生命周期，确保并发双击既不重复占座也不误报限购。”*

---

## ADR-005：内嵌 10 秒超时巡检 Worker + 全写路径共享 `releaseExpiredInLock` 惰性回收

- **背景**：待确认锁单超时后必须自动置为 `EXPIRED` 并触发 FIFO 候补转正；但 10 秒轮询存在最多 10 秒的临界时间窗口，若只在 Worker 回收，窗口内既可能被误确认，也可能让新请求误入候补或插队。
- **备选方案对比**：
  - **Worker 部署**：方案 A（后端进程内嵌 `setInterval` + 防重入 + 优雅停机 + 环境变量开关）vs 方案 B（独立 Worker 容器）。
  - **临界窗口处理**：仅靠定时任务 vs 仅在确认时惰性校验 vs **所有写路径（Worker / create / confirm / cancel）拿到行锁后统一先执行共享原语 `releaseExpiredInLock`**。
- **最终决定与理由**：选择 **内嵌解耦 Worker（方案 A）+ 统一 `releaseExpiredInLock` 惰性回收**。
  1. Worker 无锁扫描使用 `reservation.groupBy({ by: ['eventId'], ... })`（确保下推 SQL `GROUP BY`），随后按 `eventId ASC` 逐活动加锁并调用 `releaseExpiredInLock`。
  2. `create` / `confirm` / `cancel` 在拿到 `Event` 行锁后均第一时间调用同一份 `releaseExpiredInLock`：新请求既不会因未回收的过期单被误放进候补，也绝不会越过候补队首插队（`remaining > 0 && waitlistedCount === 0` 防御性不变量）。
  3. 若用户/Admin 对已过期的 `PENDING_CONFIRM` 点击**确认或取消**，`releaseExpiredInLock` 在本事务完成置 `EXPIRED`（`SYSTEM_TIMEOUT`）与条件转正，事务正常提交后由外层统一返回 `409 RESERVATION_EXPIRED`。
  4. 活动开始后（`now >= startTime`），过期回收照常释放 `pendingCount`，但停止触发候补转正。
- **权衡与演进**：MVP 减少了一个容器维护成本；生产规模扩大时可直接将 Worker 模块打包为独立容器运行，无需改写业务逻辑。
- **面试一句话总结**：*“我们把过期回收与 FIFO 转正抽成锁内共享原语 `releaseExpiredInLock`，Worker 与创建/确认/取消全部复用同一段代码，既消除了 10 秒窗口内的误确认和插队，又通过提交后映射 409 保证过期落库不回滚。”*

---

## ADR-006：后端强执行 RBAC 字段裁剪与关键业务边界（对齐 `demo/`）

- **背景**：静态原型 [demo/](file:///home/shenyun/dev/queue-reservation/demo) 明确区分了 C 端普通用户与 Admin 运营管理员的视野与权限。
- **最终决定与理由**：
  1. **真后端 RBAC 裁剪**：普通用户请求活动列表/详情时，后端直接裁剪 `capacity`、`confirmedCount`、`pendingCount`、`waitlistedCount`、`confirmTimeoutSec` 等运营敏感指标，仅下发 `availabilityStatus`（`AVAILABLE | WAITLIST_ONLY | CLOSED`）与用户自己的预约，而非“接口全返回、前端隐藏 DOM”。
  2. **取消接口防他人信息泄露**：`POST /api/reservations/:id/cancel` 触发他人候补转正时，对 `USER` 角色强制返回 `promotedReservation: null`，仅 `ADMIN` 返回完整转正 DTO；`ReservationDetailDto` 对 `USER` 不包含他人 `userId`/`userName`。
  3. **Admin 职能边界**：禁止 Admin 自己作为 C 端下单（`403 FORBIDDEN`），但允许 Admin 对任意预约执行**代确认 / 强制取消**及查看全量审计日志，并在 `AuditLog.actorId` 中真实记录操作人。
  4. **安全边界坦诚声明**：`X-User-Id` 模拟身份切换仅为原型演示便利，**不构成生产级认证安全边界**；未来替换为 JWT 中间件仅改动 `routes/` 层。
  5. **压测虚拟用户隔离 & 多份限购**：`User.isSimulated = true` 隔离压测账号不污染顶部切换器；前端正式版支持 `maxPerUser > 1` 的全部活跃预约列表渲染，且后端集成测试强制覆盖 `maxPerUser = 2`。
- **面试一句话总结**：*“我们把 C 端和运营端的权限隔离彻底下沉到了后端 DTO 裁剪层——包括普通用户取消后隐藏被转正他人的预约详情——同时明确声明模拟 Header 仅用于原型演示，可无痛替换为 JWT。”*

---

## ADR-007：统一 API 响应信封 `{ data, meta? }` 与稳定错误体 `{ error }`

- **背景**：接口既需要返回业务数据，也需要承载 `requestId`、`serverTime`（校准前端倒计时）、`idempotentReplay`、`lastWorkerRunAt` 等跨接口元信息，同时需要明确映射 Prisma 数据库错误防止 500 泄露。
- **备选方案对比**：
  - **风格 1（直接返回 DTO）**：响应扁平，但难以统一扩展全局元信息。
  - **风格 2（统一 `{ data, meta? }` 信封 + `{ error: { code, message, details? } }`）**：格式完全一致，扩展性强。
- **最终决定与理由**：选择 **风格 2（统一信封）**，并在全局错误处理器补全 Prisma 错误映射：`P2025`（含并发 `reset-seed` 命中旧行）→ `404 EVENT_NOT_FOUND`、`P2002`（幂等唯一键兜底）→ 重读按 `200 + idempotentReplay` 返回、`P2028/P2034` → `503 SERVICE_BUSY`（可重试）。
- **面试一句话总结**：*“所有成功接口统一使用 `{ data, meta }` 信封，配合 `meta.serverTime` 校准倒计时，并在全局错误层将 Prisma 并发/缺行错误收敛为稳定的 `404`/`503` 业务契约，杜绝误报 500。”*

---

## ADR-008：前端看板采用 TanStack Query 3 秒短轮询（SSE 纳入未来演进）

- **背景**：后台每 10 秒自动回收过期锁单并触发候补转正，前端看板与用户状态需要自动更新而无需手工刷新页面。
- **备选方案对比**：
  - **方案 A（TanStack Query + 3 秒短轮询 + 写操作后即时 `invalidate`）**：天然处理 `loading/empty/error/success` 四态，零长连接维护成本，3 小时原型最稳妥。
  - **方案 B（SSE 实时推送）**：毫秒级更新体验更好，但需处理连接管理、断线重连、代理缓冲与状态合并，研发与排障开销较高。
- **最终决定与理由**：MVP 采用 **方案 A**，并将 **方案 B（SSE）** 明确记录在 `docs/architecture.md` 的未来演进路线中，保留 `Event` / `Reservation` 状态变更事件扩展点。
- **面试一句话总结**：*“在 3 小时限时原型里，我们优先用 TanStack Query 短轮询加写后立即失效来确保四态稳健与快速交付，同时在架构上把 SSE 实时推送预留为下一阶段的无痛升级路径。”*

---

## ADR-009：P0 闭环优先，P1 通过专用服务端并发接口实现「模拟 20 人并发抢购」

- **背景**：题目要求提供前端「模拟 20 人并发抢购」调试按钮（加分项）。
- **备选方案对比**：
  - **方案 A（浏览器端 `Promise.all` 发 20 次 HTTP）**：受限于浏览器同域 HTTP/1.1 最多 6 并发连接上限，实际是分批串行，并非真正同毫秒 20 路撞库。
  - **方案 B（后端提供专用 `POST /api/events/:eventId/simulate-burst` 压测接口）**：后端在 Node 内通过 `Promise.all` 同毫秒并发触发真实预约用例，并直接返回每笔耗时、结果、顺位与基于真实行数的防超卖校验战报。
- **最终决定与理由**：按 **P0 先跑通完整核心闭环 → P1 交付压测能力** 的节奏推进；P1 采用 **方案 B**，同时将压测并发上限设为 `min(25, DB_POOL_MAX - 5)`（默认连接池 `30`），既能真并发跑满 20 路撞库，又为同时到来的 `GET` 与 Worker 预留空闲连接；战报中的 `oversold` 严格基于 **`Reservation` 真实行数**计算；并在 Vitest 中额外通过 Hono `app.request()` 对真实 HTTP 入口做 20 路并发集成测试。
- **面试一句话总结**：*“为绕开浏览器 HTTP/1.1 的 6 连接上限，我们在后端提供受连接池余量保护（`<= pool.max - 5`）的真并发压测接口，并用真实预约行数校验 `oversold`，再配合 Vitest 进程内 `app.request()` 并发测试验证端到端强一致。”*

---

## ADR-010：FIFO 候补顺位采用活动内严格单调 `waitlistSeq = lockedEvent.lockVersion`

- **背景**：原设计按 `(waitlistedAt ASC, id ASC)` 决定候补 FIFO 顺序。在高并发场景下存在两类隐患：(1) 若时间戳在加锁前获取，提交顺序与时间顺序可能倒挂；(2) 同毫秒并发写入依赖随机 `cuid` 破平，严格 FIFO 语义脆弱。
- **备选方案对比**：
  - **方案 A（锁后取时间戳 `(waitlistedAt ASC, id ASC)`）**：不加列，但同毫秒仍需靠 `id` 字典序破平。
  - **方案 B（`Reservation.waitlistSeq = lockedEvent.lockVersion` + `UNIQUE(event_id, waitlist_seq)`）**：复用已有行锁自增的 `Event.lockVersion` 作为活动内严格单调排队序号，同时保留锁后 `waitlistedAt` 用于界面展示。
- **最终决定与理由**：选择 **方案 B**。每次写事务首行 `lockForUpdate` 都会原子递增 `Event.lockVersion`，将其直接赋给新入队候补单的 `waitlistSeq`，零额外 SQL 开销即可获得活动内严格单调、全局无并列的 FIFO 全序，索引也简化为 `reservations(event_id, status, waitlist_seq)`。
- **权衡与演进**：增加 1 个可空整型列与唯一约束（PostgreSQL 允许 `NULL` 多行并存）；完全消除时钟回拨与同毫秒并列风险。
- **面试一句话总结**：*“我们直接复用 `Event` 行锁递增的 `lockVersion` 作为候补单的 `waitlistSeq`，零额外开销就拿到了活动内严格单调无并列的 FIFO 全序，彻底规避了同毫秒时间戳和时钟漂移问题。”*

---

## ADR-011：明确活动截止口径（`now >= startTime`）与终态过滤语义（`CLOSED`）

- **背景**：原设计缺少 `EVENT_ENDED` 触发时点与活动开始后过期/转正行为的明确定义，且用 `ENDED` 同时指代「预约终态 Tab」和「活动已结束错误码」，语义存在歧义。
- **最终决定与理由**：
  1. **活动截止规则**：统一以 **`now >= event.startTime`** 作为预约与候补转正截止点——此后活动 `availabilityStatus` 变为 `CLOSED`，新预约（幂等重放之后校验）返回 `409 EVENT_ENDED`；锁单 `expiresAt` 上限钳制为 `min(now + confirmTimeoutSec, event.startTime)`；活动开始后的过期回收与取消照常释放计数，但**停止触发候补转正**。
  2. **命名去歧义**：将列表/看板的预约终态（`CANCELLED | EXPIRED`）过滤值统一更名为 **`CLOSED`**（替代原 `ENDED`），与 `EVENT_ENDED` 错误码清晰区分；看板候补指标统一以「候补单数 / 候补队列」口径呈现。
- **面试一句话总结**：*“我们以 `now >= startTime` 统一收敛了活动截止、锁单过期钳制和停止转正的边界，并将预约终态过滤重命名为 `CLOSED`，消除了与 `EVENT_ENDED` 的语义混用。”*

---

## 架构评审修订记录（Architecture Review Revision Log）

> **评审基线提交**：`ccf17de`（`docs: add initial architecture, decisions, and database design; rename frontend-demo to demo`）  
> **评审来源**：Keema Architecture Review（`msg_a64df4520ca5`，只读严格评审）  
> **修订结论**：全部 5 项阻塞级（P1）、11 项改进项（P2）与 7 项细节建议（P3）均已逐项收敛落盘，设计文档具备进入 `docs/plan.md` 与编码阶段的条件。

| 编号 | 级别 | 评审发现问题 | 修订方案与决策 | 落盘文档 |
| :--- | :---: | :--- | :--- | :--- |
| **P1-1** | P1 | `/confirm`、`/cancel` 在加锁前读取 `Reservation` 存在 TOCTOU 竞态，可能重复扣减与重复转正 | 写事务硬规则：锁前读仅用于拿 `eventId`，拿到 `Event` 锁并跑完 `releaseExpiredInLock` 后**必须锁内重读 `Reservation`**；补「并发 `cancel × 2`」必过集成测试 | `architecture.md` §4.1/§4.4/§10.3、`database.md` §4.1、`decisions.md` ADR-003 |
| **P1-2** | P1 | 惰性过期在事务内 `throw AppError(409)` 会导致 `$transaction` 回滚，过期与转正丢失 | 明确约定含写操作的业务拒绝在事务内返回判别联合结果对象，严禁抛异常；提交后由外层映射 `409 RESERVATION_EXPIRED`；补落库断言测试 | `architecture.md` §3.2/§4.4/§10.3、`decisions.md` ADR-002/ADR-005 |
| **P1-3** | P1 | `CHECK` 仅校验冗余计数无法防“计数偏低漂移”，原措辞“绝对零超卖”易被答辩质疑 | 精准界定防线边界（行锁 + `applyTransition` 查表为主防线，`CHECK` 防上溢/负值）；`oversold` 改按真实行数计算；每用例跑 `assertEventInvariants` | `architecture.md` §4.2/§4.4/§8.2/§10.3、`database.md` §4.1、`decisions.md` ADR-003 |
| **P1-4** | P1 | 未定义 `pg` Pool 上限、交互式事务超时与 Prisma 错误映射，20 并发易触发 `P2028 -> 500` | 显式配置 `DB_POOL_MAX=30`、`{ maxWait: 10_000, timeout: 10_000 }`、压测上限 `<= pool.max - 5`（默认 25）；补 `P2025 -> 404`、`P2002 -> 200 replay`、`P2028/P2034 -> 503 SERVICE_BUSY` | `architecture.md` §1/§3.2/§4.1/§8.1/§8.2、`database.md` §1、`decisions.md` ADR-002/ADR-007/ADR-009 |
| **P1-5** | P1 | 普通用户取消后响应 `promotedReservation` 会将其他用户的预约信息泄露给 `USER` | `USER` 角色返回 `promotedReservation: null`，仅 `ADMIN` 返回完整转正 DTO；明确 `USER` 视角 `ReservationDetailDto` 不含他人信息 | `architecture.md` §7/§8.2/§10.3、`decisions.md` ADR-006 |
| **P2-1** | P2 | FIFO 依赖时间易受锁前取时与同毫秒并列影响 | 引入 `Reservation.waitlistSeq = lockedEvent.lockVersion`（+ `UNIQUE(event_id, waitlist_seq)`）作为活动内严格单调 FIFO 序号；`now` 统一锁后获取 | `architecture.md` §4.4/§5.1、`database.md` §2/§3.4/§4.2/§4.3、`decisions.md` ADR-010 |
| **P2-2** | P2 | 过期未回收期间新建预约可能误入候补或越过队首插队 | 抽离共享原语 `releaseExpiredInLock` 供 Worker/`create`/`confirm`/`cancel` 锁后统一先执行；名额判定收紧为 `remaining > 0 && waitlistedCount === 0` | `architecture.md` §4.4/§5.1/§6、`database.md` §4.1、`decisions.md` ADR-005 |
| **P2-3** | P2 | 取消已过期 `PENDING_CONFIRM` 的返回语义在文档间不一致 | 统一约定：`confirm` 与 `cancel` 命中已过期锁单均先落库 `EXPIRED`（`SYSTEM_TIMEOUT`）+ 条件转正，提交后统一返回 `409 RESERVATION_EXPIRED` | `architecture.md` §4.4/§5.1/§8.1/§8.2、`decisions.md` ADR-005 |
| **P2-4** | P2 | `EVENT_ENDED` 截止口径与活动开始后转正行为未定义 | 统一按 `now >= startTime` 截止新预约与候补转正；`expiresAt` 钳制至 `startTime`；活动开始后过期/取消只释放计数不转正 | `architecture.md` §4.4/§5.1/§8.1、`database.md` §3.3/§3.4、`decisions.md` ADR-011 |
| **P2-5** | P2 | 幂等检查顺序、重放快照语义、前端 Key 生命周期与跨活动作用域未写全 | 在写事务模板固化顺序（幂等在 `EVENT_ENDED`/`maxPerUser` 之前）；明确重放返回最新状态、前端 Key 生成/复用/作废规则及含 `eventId` 作用域 | `architecture.md` §4.3/§4.4/§9、`decisions.md` ADR-004 |
| **P2-6** | P2 | `reset-seed` 期间等锁并发请求命中被删旧行会触发 `P2025` | 明确 `lockForUpdate` 触发 `P2025` 统一映射 `404 EVENT_NOT_FOUND`，绝不落成 `500` | `architecture.md` §8.1、`database.md` §3.6 |
| **P2-7** | P2 | `packages/shared` 消费模式、Node 26 类型剥离禁忌、Prisma 生成产物与 Docker 运行时 CLI 未明确 | 明确 source-only、禁 TS `enum`（用 `z.enum`/`as const`）、`src/generated/prisma` 进 `.gitignore` 构建期生成、运行镜像保留 `prisma` CLI 与 `tsx` | `architecture.md` §1/§2/§10.2、`database.md` §4.3、`decisions.md` ADR-001 |
| **P2-8** | P2 | 需核实 `node:26.13.1-*` 镜像存在并锁定 pnpm 版本 | 已实测 `docker manifest inspect node:26.13.1-slim` 存在；根 `package.json` + Dockerfile 通过 `packageManager: "pnpm@12.21.0"` + Corepack 锁定 | `architecture.md` §1/§10.2、`decisions.md` ADR-001/ADR-002 |
| **P2-9** | P2 | 测试库隔离、清库 `TRUNCATE` 例外与进程内 HTTP 并发测试基线缺失 | 明确 `DATABASE_URL_TEST`、`fileParallelism: false`、`app.request()` 并发、20 动态用户，并在 `backend/AGENTS.md` 与 `database.md` 写明 DDL/测试清库例外 | `architecture.md` §10.3、`database.md` §1、`backend/AGENTS.md` §2 |
| **P2-10** | P2 | `maxPerUser > 1` 场景缺少明确覆盖方案 | 保持 Seed 对齐 `demo/`（`maxPerUser=1`），支持 Admin 建 `maxPerUser=2` 活动演示多单 UI，并在必过测试矩阵强制纳入 `maxPerUser=2` 专项用例 | `architecture.md` §10.3、`database.md` §5.2、`decisions.md` ADR-006 |
| **P2-11** | P2 | `res-106` 35s 过期窗口过短、`res-106/107` 相对 demo 的因果调整未显式注明 | 将 `evt-2.confirmTimeoutSec` 调至 `120s`（`res-106` 剩余 `110s`），并在 `database.md` §5.3 显式注明两处相对 `demo/app.js` 的有意修订 | `database.md` §5.2/§5.3 |
| **P3-1..7** | P3 | Worker `distinct` 改 `groupBy`、统一锁后 `Clock` 显式写 `createdAt`、`ENDED` 改 `CLOSED`、候补单数口径、`X-User-Id` 非安全边界声明、`availabilityStatus` 补 `CLOSED`、可裁剪优先级 | 全部采纳并同步更新至架构、数据库与决策文档 | `architecture.md` §3.2/§6/§7/§8.2/§10.3、`database.md` §1/§4.1/§4.2、`decisions.md` ADR-002/005/006/011 |
