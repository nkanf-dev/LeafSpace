# LeafSpace 三 Agent 目录 Ownership 规范

本文件以 [docs/agents/README.md](../agents/README.md) 中定义的三 Agent 协作模型为准。
旧的 6 Agent 细分版本已废止，不再作为目录分工依据。

## 1. 总原则

每个 Agent 优先修改自己的模块目录。跨边界修改必须：
- 在提交说明中写明原因
- 尽量只改类型声明、接口适配或轻量接线
- 不重构其他 Agent 的主实现

---

## 2. Ownership 划分

### Agent 0 - Architect
主要 ownership：
- `src/types/`
- `src/app/`
- `src/main.tsx`
- 工程配置文件
- CI / lint / format 配置
- `src/tests/e2e/`
- 跨模块共享契约文档

职责重点：
- 定义领域模型、共享类型与模块边界
- 维护应用入口、集成接线与 E2E 验收链路
- 审核共享文件的合并方式，避免前端层与逻辑层产生耦合漂移

### Agent 1 - Frontend
主要 ownership：
- `src/components/`
- `src/styles/`
- `src/index.css`
- `src/assets/`（视觉资源）
- `src/tests/ui/`

职责重点：
- 实现 UI/UX、交互流程、组件结构与视觉样式
- 维护界面层自动化验证
- 不在组件内部直接实现持久化、worker 调度或 PDF 底层逻辑

### Agent 2 - Logic
主要 ownership：
- `src/services/`
- `src/stores/`
- `src/workers/`
- `src/tests/unit/`

职责重点：
- 实现 PDF、Store、Worker、Persistence 等核心业务逻辑
- 保持逻辑层无 UI 依赖
- 为前端层提供稳定的状态接口与服务边界

---

## 3. 共享文件修改规则

以下文件视为共享文件：
- `src/types/*`
- `src/app/*`
- `src/main.tsx`
- `src/index.css`
- `docs/specs/shared-contracts.md`

共享文件建议由 Agent 0 (Architect) 统筹合并；其他 Agent 如需改动，应尽量最小化，并在 PR 或提交说明中注明影响范围。

## 4. 协作约束

- Agent 1 需要新增状态字段或服务接口时，先与 Agent 2 对齐，再落到 `src/types/`。
- Agent 2 不直接定义 UI 展示结构；如需新增展示态字段，应通过共享类型声明暴露。
- Agent 0 可以为集成目的修改任一层的轻量接线，但不应替代 Agent 1/2 持续维护其主实现。
