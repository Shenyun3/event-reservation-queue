# Frontend Rules (`frontend/`)

本规则仅在修改前端代码时生效，补充根目录 `AGENTS.md`。

## 1. 技术栈与 UI 复用铁律
- 默认技术栈：`React + TypeScript + Tailwind CSS + shadcn/ui`（若 `docs/architecture.md` 另有约定则以其为准）。
- **禁止重复造轮子**：基础按钮、弹窗、表单、表格、下拉、Toast、Tabs 一律优先使用 `shadcn/ui` 组件（位于 `src/components/ui/`），禁止从零手写基础交互原语。
- **视觉基准**：页面路由跳转、核心布局与操作流程必须严格对齐 `demo/`。

## 2. 目录结构与职责边界
```text
src/
├── components/
│   ├── ui/               # shadcn/ui 基础原语（保持领域无关）
│   └── ...               # 跨模块复用的通用业务无关 UI
├── features/
│   └── <feature>/
│       ├── components/   # 当前业务域专用组件
│       ├── api/          # REST 请求封装与响应校验
│       ├── hooks/        # 状态管理与流程协调
│       └── schema/       # Zod 校验与推导类型
└── lib/                  # 通用工具、API 客户端配置
```
- 公共组件禁止反向导入 `features/` 下的业务服务或状态。
- 路由入口仅负责页面组装，不直接堆砌复杂业务逻辑。

## 3. 状态、契约与校验
- **四态完整**：所有异步加载与提交交互必须显式处理 `loading`、`empty`、`error`、`success` 四态，防止重复点击与静默吞错。
- **前后端契约一致**：接口入参、出参与错误结构使用 Zod 校验或与后端共享类型；权限、状态流转与计算以服务端返回为准。
- **注释规范**：每个新建文件顶部说明组件/模块职责；导出组件、Hook、API 函数必须具备简洁的 Google Style JSDoc（`@param`、`@returns`）。

## 4. 本地验证与日志排障
- 报告完成前必须在 `frontend/` 执行类型检查与构建，确保退出码为 `0`（命令以 `package.json` 实际脚本为准，例如 `pnpm typecheck && pnpm build`）。
- 遇到白屏、编译报错或接口请求异常时，优先读取 `../.logs/frontend.log` 与 `../.logs/backend.log` 末尾排查。
