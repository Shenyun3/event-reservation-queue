# Project Engineering Rules (Rapid Prototype)

本文件为全局铁律（严格精简，仅保留所有 Agent 必须遵守的通用红线）。领域细节按需阅读子目录规则与本地 Skill。

## 1. 最高基准与真相源（Truth Anchors）

任何设计与编码必须对齐以下 4 个项目内锚点，禁止脱离基准自由发挥：
- `demo/`：静态 HTML 原型，是**页面跳转逻辑与核心交互的最高视觉基准**。
- `docs/architecture.md`：仓库目录边界、技术栈选型与 Clean Architecture 分层约束。
- `docs/database.md`：数据模型、约束、状态枚举与 Seed 初始化契约。
- `docs/plan.md`：Phase 拆解、并行子任务与验收标准。

## 2. 架构与契约红线

- **严格分层（Clean Architecture）**：遵循 `Handler / Route -> Service / Usecase -> Repository`。路由层严禁直接操作 Prisma/数据库或编写核心业务流程；业务逻辑禁止耦合 HTTP 上下文。
- **ORM 与存储隔离**：数据库访问统一走 ORM（如 Prisma），禁止散落手写裸 SQL。文件上传通过统一 `Storage` 接口映射本地目录（如 `./storage/`），数据库只存元数据。
- **单一真实契约**：前后端共享 Zod Schema / DTO 契约。原型开发无需历史兼容，禁止保留多套兼容路径或把本应接通 API 的功能偷偷降级回 Mock 假数据。
- **AI 输出不可信**：若涉及 LLM/Agent 调用，模型输出必须先经过 Zod 等结构化校验再入库或渲染，核心业务规则与权限判断不得隐藏在 Prompt 中。

## 3. 代码注释规范（Google Style）

- **文件头注释**：每个新建或核心业务文件顶部必须用简短注释说明模块职责。
- **导出符号文档注释**：所有导出函数、类、Service 方法必须遵循 **Google Style 注释规范**（TypeScript 使用 JSDoc `/** ... */` 风格标注用途、参数 `@param`、返回值 `@returns` 与关键异常/边界；Go 使用标准符号名开头注释）。
- 内部私有逻辑仅在存在非显然状态转换、事务边界或外部调用假设时添加简短意图注释，不逐行复述代码。

## 4. Worktree 隔离与看板所有权

- **1 写代码 Agent = 1 独立 Worktree**：并发子 Agent 仅修改各自任务归属的目录与文件，严禁跨任务顺手重构无关文件。
- **`docs/plan.md` 独占规则**：**子 Agent 严禁修改 `docs/plan.md` 的 `- [ ]` / `- [x]` 勾选状态**。所有子任务勾选统一由**主 Orchestrator Agent** 在验证并合并对应 Worktree 后集中更新，避免并发合并冲突。
- **共享契约文件保护**：`prisma/schema.prisma`、`package.json` 等全局共享文件在并发编码阶段原则上保持冻结，确需变更时由主 Agent 串行处理。

## 5. 确定性验证与日志自愈（完成前必做）

- **退出码 0 门禁**：任何编码 Agent 在报告任务完成前，**必须亲自执行对应验证命令**（如 `typecheck`、`build`、单测或接口冒烟检查，确保退出码为 `0`）。未运行命令不得声称“已完成”或“已通过”。
- **日志自愈闭环**：启动脚本会将服务日志实时写入 `.logs/backend.log` 与 `.logs/frontend.log`。遇到构建报错、500 异常或前后端联调失败时，**必须第一时间读取 `.logs/*.log` 末尾日志定位根因并自行修复**，禁止把报错留给人类排查。

## 6. 按需加载指引（Progressive Disclosure）

- **前端任务**：开始前必读 `frontend/AGENTS.md`。
- **后端任务**：开始前必读 `backend/AGENTS.md`。
- **数据库建模与独立审查**：读取 `.agents/skills/database-design/SKILL.md`（若工具链使用 `.claude/skills/` 则读对应目录）。
- **Phase 合并后双重盲审**：由无历史对话污染的只读审查 Agent 读取 `.agents/skills/phase-review/SKILL.md` 执行。
