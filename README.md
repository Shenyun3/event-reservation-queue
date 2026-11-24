# 高并发活动预约与排队候补系统（Queue & Reservation Service）

一个面向高并发抢票与预约场景的全栈 TypeScript 原型系统，完整实现**强一致防超卖**、**确认超时自动释放**、**严格单调 FIFO 候补自动转正**、**严格请求幂等**、**全链路状态审计日志**、**C 端 / 运营端 RBAC 视野隔离**以及 **20 路同毫秒并发压测实验室**。

---

## 1. 一键启动（Docker Compose）

确保本机已安装 Docker（支持 `docker compose` v2），在仓库根目录执行：

```bash
docker compose up --build -d
```

启动完成后访问：
- **Web 前端（Nginx 托管 SPA + `/api/*` 反向代理）**：<http://localhost:5173>
- **后端健康检查（Hono + PostgreSQL 17 + 10s 超时巡检 Worker）**：<http://localhost:3000/api/health>

容器启动时后端会自动执行 `prisma migrate deploy` 与幂等 `prisma db seed`（首次启动灌入 6 个演示账号、2 场活动、7 条初始预约单与 11 条审计日志；重启不覆盖运行中数据）。

快速冒烟检查：

```bash
# 健康检查
curl -sf http://localhost:3000/api/health

# C 端普通用户视野（后端自动裁剪 capacity / stats / confirmTimeoutSec 等敏感运营字段）
curl -sf -H "X-User-Id: u1" http://localhost:5173/api/events

# 运营管理员视野（完整规则、实时计数与基于真实行数的 oversold 校验）
curl -sf -H "X-User-Id: admin" http://localhost:5173/api/events
```

停止并清理容器（保留数据卷）：

```bash
docker compose down
# 若需连同数据库卷一起清空重建：
docker compose down -v
```

---

## 2. 技术栈与核心一致性架构

- **Monorepo**：`pnpm@12.21.0` Workspace（`packages/shared` + `backend` + `frontend`）
- **共享契约（Single Source of Truth）**：`packages/shared` 导出前后端共用的 Zod Schema、稳定错误码与响应信封（纯 `.ts` 源码，严禁 TS `enum` 以兼容 Node 26 原生类型擦除）
- **后端**：Node `26.13.1` + Hono + Prisma 7（`@prisma/adapter-pg` + `pg.Pool` `max=30`）+ PostgreSQL 17
- **前端**：React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui + React Router v7 + TanStack Query v5（3 秒短轮询 + 写操作即时刷新）

### 核心一致性与并发设计
1. **单行排他锁 + 集中状态跃迁 + 物理 `CHECK` 多层防线**：
   - 所有修改活动占座/候补的写事务首行通过递增 `Event.lockVersion` 获取 PostgreSQL `FOR NO KEY UPDATE` 行锁，将同一活动的并发写串行化；全部计数变更集中通过单一 `applyTransition` 查表驱动，配合基于 `Reservation` 真实行数的 `oversold` 校验与集成测试 `assertEventInvariants` 保障账实守恒。
   - 数据库迁移文件附带物理 `CHECK` 约束：`confirmed_count + pending_count <= capacity`、`pending_count >= 0`、`confirmed_count >= 0`、`PENDING_CONFIRM` 与 `expires_at` 互斥不变量，作为计数字段上溢/负值及状态互斥字段的底层物理防线。
2. **统一惰性超时回收 + 10 秒后台巡检 Worker**：
   - 统一采用半开过期边界：`expiresAt <= now` 视为已过期，有效确认/取消要求 `now < expiresAt`。
   - `create` / `confirm` / `cancel` 与后台 10 秒 Worker 共享同一锁内原语 `releaseExpiredInLock`；对已过期锁单执行确认或取消时，事务内先完成过期落库与条件 FIFO 转正并**正常提交**，再由事务外层映射为 `409 RESERVATION_EXPIRED`。
3. **严格单调 FIFO 候补顺位**：
   - 进入候补时记录 `waitlistSeq = lockedEvent.lockVersion`（受 `UNIQUE(event_id, waitlist_seq)` 保护），彻底消除同毫秒时间戳并列问题；前端展示的 `waitlistRank` 基于 `waitlistSeq ASC` 实时批量计算（零 N+1）。
4. **严格幂等与精确 `P2002` 兜底**：
   - 预约接口强制要求 `Idempotency-Key` Header，结合数据库唯一约束 `UNIQUE(event_id, user_id, idempotency_key)` 并在 `txManager.run` 外部仅针对该幂等约束重放 `200 + meta.idempotentReplay = true`（不误吞 `waitlist_seq` 或 `users.email` 冲突）。
5. **RBAC 后端强裁剪**：
   - `USER` 无法查看活动容量/候补数等运营数据；`USER` 取消预约触发他人候补转正时，后端强制返回 `promotedReservation: null` 防止泄露他人信息；`ADMIN` 禁止作为 C 端下单（`403 FORBIDDEN`）。

---

## 3. 本地开发与集成测试指南

### 3.1 环境准备（Node 26.13.1 + pnpm 12.21.0 + PostgreSQL 17）

```bash
cp .env.example .env
pnpm install

# 启动本地 PostgreSQL（若尚未启动），并创建开发库 queue_reservation 与隔离测试库 queue_reservation_test
pnpm --filter @queue-reservation/backend db:generate
pnpm --filter @queue-reservation/backend db:migrate
pnpm --filter @queue-reservation/backend db:seed
```

启动本地前后端热重载服务（日志实时落盘至 `.logs/backend.log` 与 `.logs/frontend.log`）：

```bash
pnpm dev
```

### 3.2 类型检查、构建与真实 PostgreSQL 集成测试

> 集成测试运行在独立测试库 `DATABASE_URL_TEST`（见 `.env.example`），需先确保该库已执行过迁移：
> `DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter @queue-reservation/backend db:migrate`

```bash
# 全仓类型检查
pnpm typecheck

# 全仓构建
pnpm build

# 运行全部 5 个测试文件 / 20 条真实 PostgreSQL 集成测试（每条用例均断言 4 条数据库不变量）
pnpm --filter @queue-reservation/backend test
```

集成测试覆盖：
- **基础与物理约束**（`health.test.ts`）：`/api/health` + `FakeClock`、Seed 四条不变量、PostgreSQL 物理 `CHECK` 拦截、Prisma 7 `P2002` 幂等键 vs `waitlist_seq` / `users.email` 正反例区分。
- **高并发与幂等**（`concurrency.test.ts`）：#1 20 路并发抢 5 席零超卖与严格递增 `waitlistSeq`、#4 同一确认单并发 `cancel × 2` 防 TOCTOU、#5 严格幂等双击与状态变更后重放返回最新状态。
- **状态机与边界**（`lifecycle.test.ts`）：#2 取消 `CONFIRMED`/`PENDING_CONFIRM` FIFO 转正 + `USER` 裁剪 `promotedReservation: null` vs `ADMIN` 完整 DTO、#3 `FakeClock` 惰性过期落库 + `409 RESERVATION_EXPIRED`（confirm 与 cancel）、#6 `maxPerUser = 2` 多单流转、#7 `EVENT_ENDED`（`now >= startTime`）截止与停止转正。
- **RBAC 与后台巡检**（`rbac-and-worker.test.ts`）：#8 `401/403` 鉴权与字段裁剪、多活动 `POST /api/admin/worker/expire`、`reset-seed` 原子重建、`ExpirationWorker` 防重入与优雅停机。
- **P1 并发压测**（`stress.test.ts`）：`DELETE /api/events/:eventId/reservations`、`POST /api/events/:eventId/simulate-burst`（20 路并发抢 5 席、`DB_POOL_MAX - 5` 动态限流、虚拟用户 `isSimulated=true` 不污染 `/api/users`）。

---

## 4. 功能演示脚本（推荐走查路径）

1. **C 端预约、倒计时与幂等体验**：
   - 默认以 **Alice (`u1`)** 身份进入首页「活动大厅」（`/`），进入 `evt-1` 点击「发起预约」，获得 `PENDING_CONFIRM` 倒计时锁单；
   - 点击「确认预约」转为 `CONFIRMED`，打开「查看进度」抽屉查看完整审计时间线；
   - 在顶部切换为 **Charlie (`u3`)**，进入「我的预约」（`/my-reservations`），观察 `evt-2` 的 `res-106` 倒计时（初始剩余 110 秒）或直接点击取消，再切换为 **Diana (`u4`)** 观察其原本排在 `#1` 的候补单（`res-107`）自动转正为 `PENDING_CONFIRM`！
2. **多单限购（`maxPerUser = 2`）交互演示**：
   - 在顶部身份下拉切换为 **Admin（运营管理员）**，进入「运营管理台」（`/admin`），创建一场 `capacity = 1, maxPerUser = 2, confirmTimeoutSec = 120` 的新活动；
   - 切回 **Alice (`u1`)** 进入该活动详情页，可连续发起 2 笔预约（第 1 笔 `PENDING_CONFIRM`、第 2 笔 `WAITLISTED`），详情页完整展示本人的全部活跃预约列表，并支持每笔独立确认、取消与查看审计。
3. **20 人同毫秒并发压测实验室**：
   - 切换为 **Admin** 进入「20 人并发压测」（`/stress-test`），选择 `evt-1`（容量 5），先点击「清空该活动预约」，再以默认并发数 `20` 点击「发起并发抢购」；
   - 战报将实时展示 `5 锁定待确认 + 15 有序候补 + 0 失败 + 强一致无超卖`，点击任意明细行可打开审计抽屉；顶部账号下拉仍保持 6 个常规账号，不被压测虚拟用户污染。
4. **重置演示数据与倒计时重放**：
   - 若演示首屏 `evt-2` 的 110 秒倒计时已经自然过期被后台 10 秒 Worker 自动回收转正，随时可切到 **Admin** 点击顶部「重置演示数据」按钮一键恢复全新的初始相对时间轴。

---

## 5. 已知原型边界与取舍说明

- **模拟身份头（`X-User-Id`）与 CORS 非生产安全边界**：本项目通过请求头 `X-User-Id` 支持演示期在顶部一键切换 5 位普通用户与 1 位管理员，所有角色校验与字段裁剪均在后端 Service 层严格执行；后端默认启用宽松 `cors()` 便于本地开发联调，因未引入真实登录与签名令牌，任何客户端均可构造 `X-User-Id: admin`。生产部署时只需在 `backend/src/routes/context.ts` 替换为 JWT / OAuth2 验签中间件，并在 Nginx 同源代理下收紧或移除 CORS 即可。
- **「重置演示数据」权限有意收敛为 `ADMIN` 专属**：静态线框 `demo/` 中所有角色均可见重置按钮以便离线演示；正式实现中收敛为仅 `ADMIN` 可见且后端强校验 `403 FORBIDDEN`，符合最小权限原则。
- **临近开场时 `expiresAt` 钳制行为**：确认截止时间统一计算为 `min(now + confirmTimeoutSec, event.startTime)`，保证不会出现活动开始后仍有效锁单的情况；因此在临近 `startTime` 时新下单或刚转正的确认窗口可能短于 `confirmTimeoutSec`。
- **活动开始后的存量候补单**：当 `now >= event.startTime` 后，系统停止新预约与候补转正，不再新增状态边变更既有 `WAITLISTED` 记录；前端在「活动详情」与「我的预约」中会明确展示「活动已开始，候补未转正」，同时保留「退出候补」按钮允许用户主动清理（与后端 `WAITLISTED -> CANCELLED` 规则一致）。
- **压测并发上限与容器运行形态取舍**：`POST /api/events/:eventId/simulate-burst` 对**单个请求**限流 `min(25, DB_POOL_MAX - 5)`（默认 `DB_POOL_MAX = 30`，单次上限 25 路并发）以预留连接池余量（若多标签页同时并发压测，依赖事务 `maxWait: 10s` 排队或返回 `503 SERVICE_BUSY`）；后端容器镜像面向原型快速启动采用 `tsx` 直接运行 TypeScript 并在启动期执行幂等迁移/Seed，生产化时可切换为独立编译产物、非 root 用户运行与独立迁移 Job。

---

## 6. 核心目录结构

```text
├── packages/shared/       # 前后端共享 Zod Schema、枚举、错误码与响应信封
├── backend/               # Hono + Clean Architecture (routes -> services -> repositories -> Prisma 7)
│   ├── prisma/            # schema.prisma、含物理 CHECK 约束的 migration.sql、幂等 seed
│   ├── src/worker/        # 10s 防重入超时巡检 Worker
│   └── tests/integration/ # 5 组真实 PostgreSQL 并发/状态机/RBAC/压测集成测试
├── frontend/              # React 19 + Vite + Tailwind CSS v4 + shadcn/ui + TanStack Query
│   ├── src/components/ui/ # 领域无关 shadcn/ui 基础原语
│   ├── src/components/layout/ # Topbar、AuditDrawer、CountdownBadge、权限守卫
│   └── src/features/      # events / reservations / admin / stress-test 业务模块
├── compose.yaml           # PostgreSQL 17 + Backend + Frontend 一键容器编排
└── docs/                  # architecture.md / database.md / decisions.md / plan.md
```
