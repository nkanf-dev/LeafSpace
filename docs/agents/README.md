# LeafSpace 三 Agent 协作规范 (Git Worktree 版)

本规范定义了三个核心 Agent 的分工、协同路径及质量保障体系。

## 1. 角色定义与测试矩阵

| 角色 | 核心领域 | 测试策略 | Git 分支规范 |
| :--- | :--- | :--- | :--- |
| **Agent 0: Architect** | 架构/集成/类型/E2E | **E2E Tests** | `dev/arch-*` |
| **Agent 1: Frontend** | UI/UX/组件/交互 | **UI/UX Automation** | `dev/ui-*` |
| **Agent 2: Logic** | PDF/Store/Worker/DB | **Unit Tests** | `dev/engine-*` |

## 2. Git 最佳实践 (强制要求)

### A. 分支命名
所有开发分支必须以 **`dev/`** 为前缀：
- 格式: `dev/[模块名]-[功能名]`
- 示例: `dev/ui-held-pages`, `dev/engine-pdf-service`

### B. Commit Message 规范
采用 **Conventional Commits** 格式：
- `feat: ...` (新功能)
- `fix: ...` (修复 Bug)
- `refactor: ...` (重构)
- `test: ...` (增加测试)
- `chore: ...` (构建/配置变动)
- **要求**: 语义清晰，禁止使用 "update", "fix" 等模糊词汇。

## 3. Git Worktree 协同流程

为了避免文件锁冲突，每个 Agent 建议在独立的 Worktree 中工作：
```bash
# 示例：Agent 1 增加 UI 工作区
git worktree add ../leafspace-ui -b dev/ui-init
```

## 4. 交付检查清单 (Integration Checklist)

- [ ] 分支是否以 `dev/` 开头？
- [ ] Commit Message 是否符合 Conventional Commits 规范？
- [ ] Agent 2: 单元测试覆盖率 > 80%。
- [ ] Agent 1: 视觉交互自测通过。
- [ ] Agent 0: E2E 集成测试通过。
