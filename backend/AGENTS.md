# Backend Rules (`backend/`)

本规则仅在修改后端代码时生效，补充根目录 `AGENTS.md`。

## 1. 技术栈与目录结构
- MVP 默认技术栈：`TypeScript + Hono/Express + Zod + Prisma`（若 `docs/architecture.md` 指定 Go 等栈，遵循其对应目录约定）。
- **Clean Architecture 分层**：
```text
src/
├── routes/ (handlers)    # 参数校验(Zod)、鉴权提取、调用 service、映射 HTTP 响应
├── services/ (usecases)  # 核心业务规则、状态流转、事务编排（依赖仓储接口）
├── repositories/         # Repository 接口与 Prisma 实现（隔离 ORM 细节）
├── storage/              # 统一文件存储接口（MVP 映射本地 ./storage/）
├── schemas/              # 请求/响应 Zod Schema 与 DTO
└── lib/                  # Prisma 客户端、错误基类、日志与配置
```
- **依赖方向**：`routes -> services -> repositories -> prisma`。严禁在 `routes` 中直接调用 `prisma`，严禁把 HTTP `Request/Response` 对象传入 `services` 或 `repositories`。

## 2. 数据访问、事务与错误契约
- **ORM Only**：运行时业务代码（`src/**`）所有数据库读写通过 Prisma Client 完成，禁止拼接或执行裸 SQL；仅允许两类非运行时例外：(1) 受版本控制的 Prisma Migration DDL（如 `CHECK` 约束）；(2) 集成测试夹具（`tests/**`）在独立测试库 `DATABASE_URL_TEST` 上执行 `TRUNCATE ... RESTART IDENTITY CASCADE` 清库。
- **事务原子性**：涉及多表或状态与关联记录同时更新的写操作，必须在 Service 编排下通过 `prisma.$transaction` 保证原子性；慢速外部/AI 模型调用必须放在数据库事务之外。
- **统一错误响应**：定义稳定的业务错误码与统一 JSON 错误体（如 `{ error: { code, message, details? } }`）；500 未知异常记录完整堆栈到日志，严禁向前端透出数据库内部报错或堆栈。
- **对象存储降级**：文件持久化走 `storage/` 接口，数据库仅存 `storageKey`、`mimeType`、`sizeBytes` 等元数据。

## 3. 注释、可观测性与本地验证
- **注释规范**：每个文件顶部标明职责；所有导出函数、Service 类与公开方法必须包含 Google Style 文档注释（说明意图、参数、返回值与抛出的业务异常）。
- **日志落盘**：服务日志统一输出至 `stdout`/`stderr`，由启动脚本重定向写入 `../.logs/backend.log`；关键请求入口、外部调用与异常必须打印结构化上下文（脱敏，禁打凭证）。
- **退出码 0 门禁**：报告完成前必须在 `backend/` 执行类型检查、构建与测试（如 `pnpm typecheck && pnpm test`），并在服务报错时自行检查 `../.logs/backend.log` 修复。
