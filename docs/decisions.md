# Architecture Decision Records (`docs/decisions.md`)

本文档集中记录本项目的所有关键技术与架构决策（ADR）。每条决策均按「**背景 → 备选方案对比 → 最终决定与理由 → 权衡与演进 → 面试一句话总结**」组织，便于开发对齐、项目复盘与面试表达。

---

## ADR-001：采用 `pnpm workspace` 单仓与 `packages/shared` 共享契约

- **背景**：项目为前后端分离的全栈 TypeScript 应用，涉及较多的状态枚举（5 种预约状态、3 种审计触发源）、错误码以及前后端接口 DTO。如何在 3 小时内避免前后端字段漂移、降低联调成本？
- **备选方案对比**：
  - **方案 A（独立 `backend/` + `frontend/` 无共享包）**：零根配置成本，但 Zod Schema 和类型需两边手写维护，改字段容易漏同步。
  - **方案 B（`pnpm workspace` + `packages/shared`）**：共享 Zod Schema、Enum、ErrorCode 与统一信封定义，两端编译期强一致。
  - **方案 C（Hono RPC `hc<AppType>` 跨目录引用）**：无需共享包，但前端源码强依赖后端目录路径，容器分离构建与多 Worktree 容易踩路径坑。
- **最终决定与理由**：选择 **方案 B**。建立极轻量的 `packages/shared` 包，将前后端单一真实契约（Single Source of Truth）沉淀在共享 Zod Schema 中，既保证类型与运行时校验双端一致，又保持 `backend` 与 `frontend` 源码解耦。
- **权衡与演进**：Docker 构建时需同步拷贝 `packages/shared`；在 3 小时原型中仅多出极少配置，换来联调零字段对齐 bug。
- **面试一句话总结**：*“我们通过 pnpm workspace 抽离了轻量的 `packages/shared`，前后端复用同一套 Zod Schema 与状态枚举，从编译期和运行时双重消灭了接口契约漂移。”*

---

## ADR-002：后端采用 Node.js 26.13.1 + Hono + Prisma 7+，并用 `TransactionManager` 守住 Clean Architecture

- **背景**：系统要求 Clean Architecture 分层（`routes -> services -> repositories -> prisma`），同时单个预约/取消/过期操作需要跨多张表（`Event`、`Reservation`、`ReservationAuditLog`）原子提交。
- **备选方案对比**：
  - **方案 A（抽象 `TransactionManager` 回调式 Unit of Work）**：Service 仅依赖 `TransactionManager` 与 Repository 接口，通过 `txManager.run(async (repos) => ...)` 编排跨表事务。
  - **方案 B（Service 直接注入 `PrismaClient`）**：少写一层适配器，但 Service 强耦合 Prisma 具体实现，破坏分层边界且难以单测。
- **最终决定与理由**：选择 **方案 A**，运行时锁定 **Node.js 26.13.1 + Hono + Prisma 7+（`prisma.config.ts` + `@prisma/adapter-pg`）**。仅需 ~30 行 `PrismaTransactionManager` 适配代码，就能同时满足「严格依赖反转」与「多表强事务原子性」。
- **权衡与演进**：增加极少量接口样板代码；未来即便替换 ORM 或增加读写分离，Service 层业务逻辑零改动。
- **面试一句话总结**：*“在 Clean Architecture 中通过轻量 `TransactionManager`（Unit of Work）抽象管理事务，让 Usecase 层在完全不依赖 Prisma 的前提下，依然能把锁名额、改状态、候补转正和写审计日志放进同一个 ACID 事务。”*

---

## ADR-003：高并发防超卖采用「`Event` 行级排他锁串行化 + 冗余计数 + DB `CHECK` 约束」双重防线

- **背景**：核心压测要求 20 个并发请求同毫秒抢 5 个名额，绝对不允许出现超卖（`confirmed + pending > capacity`），同时工程规范要求运行时 **ORM Only（禁止散落手写裸 SQL）**。
- **备选方案对比**：
  - **方案 A（事务首行 `tx.event.update` 行锁 + 实时聚合）**：100% 纯 Prisma ORM、无重试风暴、不同活动互不阻塞，但缺少数据库单行物理兜底约束。
  - **方案 B（`Serializable` 隔离级别 + `P2034` 退避重试）**：热点抢购下冲突率高，产生大量重试与延迟抖动。
  - **方案 C（乐观锁 `version` CAS + 应用层重试）**：同样不适合高冲突热点写场景，20 并发退化为重试风暴。
  - **方案 D（`Event` 行锁串行化 + `Event` 冗余计数字段 + PostgreSQL `CHECK` 物理约束）**：结合方案 A 的零重试行锁优势与数据库物理硬防线。
- **最终决定与理由**：选择 **方案 D**。
  1. 任何影响活动名额的写事务，第一步均通过纯 Prisma 执行 `tx.event.update({ where: { id }, data: { lockVersion: { increment: 1 } } })`，利用 PostgreSQL `UPDATE` 自动获取该活动行的排他锁，使同活动写请求自然串行排队、不同活动完全并发。
  2. 所有写事务固定加锁顺序 `Event -> Reservation -> AuditLog`，彻底杜绝死锁。
  3. 同步维护 `Event.confirmedCount` / `Event.pendingCount`，并在 Migration DDL 中添加 `CHECK (confirmed_count + pending_count <= capacity)` 物理约束作为终极兜底。
- **权衡与演进**：状态流转时需维护计数字段（集中在单一 Service 内且有集成测试校验一致性）；未来若单活动瞬时 QPS 达万级，可在前置引入 Redis Lua 令牌预扣削峰，DB 双防线继续兜底最终一致性。
- **面试一句话总结**：*“在纯 ORM 约束下，我们没有用容易重试风暴的乐观锁，而是利用事务首行更新 `Event.lockVersion` 触发 PostgreSQL 行级排他锁实现单活动串行化，再叠加 `Event` 冗余计数与数据库 `CHECK` 物理约束，形成应用层与引擎层的双重防超卖防线。”*

---

## ADR-004：发起预约强制校验 `Idempotency-Key`（严格模式）

- **背景**：前端弱网重试或用户快速连击容易产生重复预约请求，导致误报限购或产生脏数据。
- **备选方案对比**：
  - **方案 A（严格模式）**：`POST /api/events/:eventId/reservations` 强制要求请求头携带 `Idempotency-Key`，缺失返回 `400 VALIDATION_ERROR`；以 `(eventId, userId, idempotencyKey)` 建立数据库唯一索引，命中重放直接返回原预约单（HTTP `200` + `meta.idempotentReplay = true`）。
  - **方案 B（宽松模式）**：缺失时后端自动生成随机 UUID 兜底。
- **最终决定与理由**：选择 **方案 A**。宽容缺失会让前端漏传幂等键的缺陷被静默掩盖；强制契约配合前端 `apiClient` 自动生成/重试复用，配合数据库唯一约束兜底，能彻底根治并发双击脏写。
- **权衡与演进**：调用方（前端、curl、集成测试）都必须显式传 Header；若未来需要跨资源幂等，可扩展独立 `idempotency_keys` 通用幂等表。
- **面试一句话总结**：*“我们将 `Idempotency-Key` 设为强制请求头，并在行锁查询与数据库联合唯一索引两层做幂等兜底，确保并发双击时既不重复扣名额，也不误伤用户触发限购报错。”*

---

## ADR-005：内嵌 10 秒超时巡检 Worker + 确认/取消时惰性超时校验

- **背景**：待确认锁单超时后必须自动置为 `EXPIRED` 并触发 FIFO 候补转正；但 10 秒轮询存在最多 10 秒的临界时间窗口。
- **备选方案对比**：
  - **Worker 部署**：方案 A（后端进程内嵌 `setInterval` + 防重入 + 优雅停机 + 环境变量开关）vs 方案 B（独立 Worker 容器）。
  - **临界窗口处理**：仅靠定时任务 vs 定时任务 + 业务操作时惰性校验 `now > expiresAt`。
- **最终决定与理由**：选择 **内嵌解耦 Worker（方案 A）+ 惰性超时校验**。
  1. Worker 按 `eventId` 逐个复用与用户操作相同的 `Event` 行锁事务，天然避免 Worker 与用户确认/取消发生竞态。
  2. 用户在过期后、Worker 尚未扫描到的窗口点击「确认」时，Service 直接在锁内判定 `now > expiresAt`，同步完成过期与候补转正并拒绝确认（`409 RESERVATION_EXPIRED`），绝不允许「过期订单被误确认」。
  3. Worker 模块与 HTTP 路由完全解耦，且通过 `ENABLE_EXPIRATION_WORKER=false` 支持集成测试精准可控地触发巡检。
- **权衡与演进**：MVP 减少了一个容器维护成本；生产规模扩大时可直接将该模块打包为独立 Worker 容器运行，无需改写业务逻辑。
- **面试一句话总结**：*“除了每 10 秒运行的后台巡检 Worker，我们还在确认接口做了惰性过期校验，并让 Worker 与用户操作共用同一把活动行锁，彻底消除了定时任务扫描间隙的并发竞态与过期误确认。”*

---

## ADR-006：后端强执行 RBAC 字段裁剪与关键业务边界（对齐 `demo/`）

- **背景**：静态原型 [demo/](file:///home/shenyun/dev/queue-reservation/demo) 明确区分了 C 端普通用户与 Admin 运营管理员的视野与权限。
- **最终决定与理由**：
  1. **真后端 RBAC 裁剪**：普通用户请求活动列表/详情时，后端直接裁剪 `capacity`、`confirmedCount`、`pendingCount`、`waitlistedCount`、`confirmTimeoutSec` 等运营敏感指标，仅下发 `availabilityStatus` 与用户自己的预约，而非“接口全返回、前端隐藏 DOM”。
  2. **Admin 职能边界**：禁止 Admin 自己作为 C 端下单（`403 FORBIDDEN`），但允许 Admin 对任意预约执行**代确认 / 强制取消**及查看全量审计日志，并在 `AuditLog.actorId` 中真实记录操作人以保证可追溯性。
  3. **压测虚拟用户隔离**：`User` 表增加 `isSimulated` 布尔标识，压测自动生成的用户标记为 `true`，既满足数据库外键约束，又不污染顶部常规 6 账号切换器（5 User + 1 Admin）。
  4. **多份限购（`maxPerUser > 1`）体验修正**：正式版前端按 `myActiveReservations.length < event.maxPerUser` 控制预约入口并渲染全部活跃单，避免 Demo 中 `.find()` 只能看到第一条的限制。
- **面试一句话总结**：*“我们把 C 端和运营端的权限隔离真正下沉到了后端 DTO 裁剪与用例鉴权层，同时在审计日志中区分操作人与系统触发源，保证了数据安全与操作可追溯。”*

---

## ADR-007：统一 API 响应信封 `{ data, meta? }` 与稳定错误体 `{ error }`

- **背景**：接口既需要返回业务数据，也需要承载 `requestId`、`serverTime`（校准前端倒计时）、`idempotentReplay`、`lastWorkerRunAt` 等跨接口元信息。
- **备选方案对比**：
  - **风格 1（直接返回 DTO）**：响应扁平，但难以统一扩展全局元信息。
  - **风格 2（统一 `{ data, meta? }` 信封 + `{ error: { code, message, details? } }`）**：格式完全一致，扩展性强。
- **最终决定与理由**：选择 **风格 2（统一信封）**。前后端在 `packages/shared` 定义泛型信封 Schema，前端在 `apiClient` 统一解包 `data` 并透传 `meta`，兼顾高可扩展性与组件层调用简洁度。
- **面试一句话总结**：*“所有成功接口统一使用 `{ data, meta }` 信封，配合 `meta.serverTime` 解决客户端时钟偏差导致的倒计时不准问题，同时通过 `meta.idempotentReplay` 清晰区分首次创建与幂等重放。”*

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
  - **方案 B（后端提供专用 `POST /api/events/:eventId/simulate-burst` 压测接口）**：后端在 Node 内无连接限制地通过 `Promise.all` 同毫秒并发触发 20 次真实预约用例，并直接返回每笔耗时、结果、顺位与防超卖校验战报。
- **最终决定与理由**：按 **P0 先跑通完整核心闭环 → P1 交付压测能力** 的节奏推进；P1 采用 **方案 B**，使演示时真正制造出 20 路并发撞击 PostgreSQL 行锁的真实压力，同时在 Vitest 集成测试中额外直接用 Node 并发打 20 次真实 HTTP `POST /api/events/:eventId/reservations` 入口，证明网络入口层同样零超卖。
- **面试一句话总结**：*“浏览器同域 HTTP/1.1 有 6 并发连接限制，因此我们把 20 人并发压测放到后端专用接口用 `Promise.all` 真并发撞库，再配合 Vitest 对真实 HTTP 接口的 20 路并发集成测试，既保证前端演示真实性，又验证了端到端并发安全。”*
