# Git 协同工作与提交规范指南

为了支持 Architect, Frontend, Logic 三个 Agent 高效并行，本项目严格执行以下 Git 准则。

## 1. 分支命名规范 (Branch Naming)

**所有开发分支必须以 `dev/` 开头。** 严禁直接在 `main` 或非 `dev/` 前缀分支提交代码。

| 类别 | 命名模板 | 示例 |
| :--- | :--- | :--- |
| 架构/基础设施 | `dev/arch-[feature]` | `dev/arch-setup-vitest` |
| 前端 UI/UX | `dev/ui-[component]` | `dev/ui-timeline-bar` |
| 逻辑/引擎 | `dev/engine-[logic]` | `dev/engine-indexeddb` |

## 2. 提交规范 (Commit Best Practices)

采用 **Conventional Commits** 标准。每个提交应为原子的（Atomic），即一个提交只做一件事。

### 格式
`<type>: <description>`

### 常用类型
- `feat`: 引入新功能。
- `fix`: 修复 bug。
- `docs`: 仅修改文档。
- `style`: 不影响代码含义的格式改动（空格、格式化等）。
- `refactor`: 既不修复 bug 也不添加功能的代码重构。
- `test`: 添加缺失的测试或更正现有的测试。
- `chore`: 修改构建过程或辅助工具（如依赖更新）。

### 示例
- `feat: implement async thumbnail worker`
- `fix: resolve window z-index collision in split-screen`
- `refactor: simplify held-pages store logic`

## 3. Worktree 物理隔离方案

- **Agent 0 (Architect)**: `./` (Branch: `main` 或 `dev/arch-*`)
- **Agent 1 (Frontend)**: `../leafspace-ui/` (Branch: `dev/ui-*`)
- **Agent 2 (Logic)**: `../leafspace-engine/` (Branch: `dev/engine-*`)

## 4. 冲突解决与合并协议

1. **变基 (Rebase)**: 各 Agent 需频繁从 `main` 变基以获取最新的 `src/types/`：
   ```bash
   git fetch origin
   git rebase origin/main
   ```
2. **Pull Request**: 开发完成后，必须通过 PR 合并至 `main`。
3. **Squash Merge**: 合并时建议使用 Squash Merge，保持 `main` 分支历史整洁。
