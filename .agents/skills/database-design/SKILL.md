---
name: database-design
description: 面向快速原型开发的数据模型设计与专项审查 Skill。支持两种模式：Design Mode（基于 demo/ 与 docs/architecture.md 在 20 分钟内产出 docs/database.md）和 Review Mode（独立无污染审查 docs/database.md 的范式、覆盖度、约束、索引与并发安全）。
---

# 数据库设计与专项审查（Rapid Prototype）

本 Skill 服务于快速原型开发流程中的数据库建模与独立审查，确保在 20 分钟内产出可直接落地的 `docs/database.md`，并通过 10 分钟独立审查消除返工隐患。

## 模式识别

根据用户指令或当前任务阶段自动进入对应模式；若不明确，先说明当前处于哪个模式再执行：

- **Design Mode（设计模式）**：要求“设计数据库 / 生成 `docs/database.md`”时启用。
- **Review Mode（审查模式）**：要求“审查 `docs/database.md` / 数据库 Review”时启用。**默认只报告问题与修改建议，不直接改写业务代码或 Schema**（除非用户明确要求同时修订文档）。

---

## Mode 1: Design Mode（产出 `docs/database.md`）

### 1. 先读锚点再建模
开始写文档前，必须先检查：
1. `demo/`：梳理所有页面展示、列表筛选/排序、详情字段、创建/编辑表单及状态流转。**Demo 中未出现且非鉴权/审计必需的表，不要提前过度设计。**
2. `docs/architecture.md`：确认数据库引擎（如 PostgreSQL / SQLite）、ORM（如 Prisma）、鉴权主体及文件存储降级方案。

### 2. 核心设计铁律
- **范式化为主，谨慎使用 JSONB**：核心业务实体、外键关联、状态枚举、筛选字段必须建为正规列与关联表；仅纯展示快照、AI 原始结构化输出负载或扩展元数据允许使用 JSON/JSONB。禁止把多个外键 ID 拼接成逗号字符串或数组代替关联表。
- **对象存储本地映射**：上传文件/图片/音视频在数据库只保存元数据（`storageKey`、`originalName`、`mimeType`、`sizeBytes`），严禁存二进制 BLOB；底层通过统一 Storage 接口映射到本地目录（如 `./storage/`）。
- **明确数据所有权与事实层级**：
  - 每张业务资源表标明归属字段（如 `ownerId`、`workspaceId`）。
  - 区分**权威业务事实**（如 `Task`、`Order`）与**AI 草稿/分析产物**（如 `Draft`、`Suggestion`），避免 AI 中间态直接污染主状态。
- **仓储模式与 ORM 隔离**：模型设计须能直接映射到 Prisma Schema，并由 Repository 接口封装，不让 ORM 细节渗透到 Service/Usecase 层。

### 3. `docs/database.md` 输出结构

文档应紧凑、可操作，包含以下 5 个部分：

```markdown
# Database Design

## 1. 存储选型与降级策略
- 主库与 ORM：（如 PostgreSQL + Prisma）
- 对象存储降级：（如 Storage 接口 -> 本地 `./storage/`，表内仅存 `storageKey` 等元数据）

## 2. ER 关系图（Mermaid）
```mermaid
erDiagram
  ...
```

## 3. 核心表结构与约束
对每张表用紧凑表格列出：字段、类型、可空、约束/默认值（PK / FK / UNIQUE / INDEX）、业务说明。
明确写出外键删除策略（`Cascade` / `Restrict` / `SetNull`）。

## 4. 状态机与核心查询索引
- 核心状态枚举流转（如 `PENDING -> PROCESSING -> READY | FAILED`）
- 对应 `demo/` 列表/详情的高频查询及索引设计

## 5. Seed 初始化契约
- `prisma/seed` 需预置的数据清单（必须覆盖 `demo/` 首屏与关键交互，确保启动即可演示）
```

---

## Mode 2: Review Mode（10 分钟专项审查）

以全新视角对照 `demo/`、`docs/architecture.md` 和 `docs/database.md` 进行只读审查，不默认原设计正确。

### 审查清单

1. **Demo 需求覆盖度（最常见漏项）**
   - `demo/` 中出现的每一项列表字段、筛选条件、排序维度、状态徽章、关联计数，在 `docs/database.md` 中是否都有对应字段、关系或索引支撑？
   - `Seed 初始化契约` 是否足以支撑阶段 1/2 启动后直接跑通核心页面？

2. **范式与字段建模缺陷**
   - 是否存在用字符串/JSON 塞入多对多 ID 或核心可查询状态的反范式设计？
   - 是否把应该独立成表的时间线/子项/版本历史揉进主表，导致无法追踪或更新覆盖？
   - 是否存在与当前业务无关的“未来占位表/冗余字段”？

3. **约束、级联与并发一致性**
   - **唯一约束**：需要防重或幂等的业务键（如邮箱、slug、外部任务号、同一父级下的同名/同序记录）是否加了 `UNIQUE` 或复合唯一约束？
   - **级联风险**：删除父记录时，`Cascade` 会不会误删审计/计费/关联历史？`Restrict` 会不会导致正常业务删除报错？
   - **并发与状态流转**：多步写入或异步任务更新状态时，是否缺少乐观锁版本号（`version`）、幂等键（`idempotencyKey`）或明确的状态流转约束？
   - **字段精度与时区**：金额/评分精度是否合理（避免浮点误差），时间戳是否统一 UTC（`createdAt` / `updatedAt`）？

4. **索引、性能与安全边界**
   - 所有外键、高频 `WHERE` 过滤字段、复合查询条件（如 `(workspaceId, status, createdAt)`）是否建立了索引？
   - 列表与详情接口关联查询是否存在明显的 N+1 风险？
   - 敏感字段（密码哈希、API Key、私有存储路径）是否与对外展示模型做了区分？

5. **ORM 与分层落地性**
   - `docs/database.md` 的命名、枚举和表结构是否能无歧义翻译为 `schema.prisma`（或对应 ORM 模型）？
   - 是否有逻辑暗示要在 Service/Handler 中手写复杂裸 SQL 才能查出数据？若有，应调整表结构或补充物化/关联字段。

### 审查报告格式

按严重程度输出，只列真实问题与缺失项：

1. **阻塞级问题 [P0/P1]**：会导致功能缺失、数据损坏、级联误删或无法落地到 ORM 的设计缺陷。
2. **结构与性能建议 [P2/P3]**：索引补充、字段命名一致性、冗余字段精简。
3. **每项必须包含**：对应表/字段、具体违反点或缺失的 Demo 场景、潜在后果、最小修改建议。
4. **未覆盖 / 需确认项**：如果 `demo/` 或需求文档中存在歧义，明确列出待确认的业务假设。
