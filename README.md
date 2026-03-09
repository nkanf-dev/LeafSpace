# LeafSpace (页境)

> **"Read like paper, efficient like a workstation."**
> 让线性翻页，升级为空间化研读。

LeafSpace 是一款专为扫描版 PDF 打造的「纸感工作区」阅读器。它打破了传统 PDF 阅读器线性的翻页限制，引入了「阅览态-导航态-工作区」三态协同的交互模型，致力于为学术研读、深度学习和复杂文档处理提供极致的效率体验。

## 🌟 核心理念

- **纸感优先**：不追求炫技，而是通过 3D 翻页动画和自然的阴影模拟，建立书籍的位置感与厚度感。
- **空间记忆**：利用速翻、夹页和窗口化布局，帮助用户在大脑中构建文档的「知识地图」。
- **低切换成本**：通过手势与快捷键，在微调、跳转与对比之间无缝切换。

## 🛠️ 核心功能

- 📖 **基础阅览 (M1)**：支持双页展开、平滑缩放与 3D 仿真翻页。
- ⚡ **速翻模式 (Quick Flip, M2)**：Space 键激活，全局缩略图实时预览，建立文档全局观。
- 📎 **夹页系统 (Page Holding, M3)**：临时保存感兴趣的页面，支持命名与快速回溯。
- 🖥️ **工作区画布 (Workspace, M4)**：窗口化多页对照，支持贴边分屏与自定义布局。
- ⏳ **时间轴导航 (Timeline, M2)**：直观展示文档骨架、目录、夹页与主窗口位置。

## 🚀 技术架构

- **Frontend**: React 19 + TypeScript + Vite
- **State Management**: Zustand
- **PDF Engine**: PDF.js (via react-pdf)
- **Persistence**: IndexedDB (via Dexie.js)
- **Icons**: Lucide React
- **Worker**: Web Worker (用于异步缩略图生成)

## 🗺️ 项目路线图 (Roadmap)

- [x] **Phase 1: Alpha 1 (基础阅览)**
  - [x] 核心渲染引擎搭建
  - [x] 仿真双页翻页实现
  - [x] 缩放与基本缓存策略
- [x] **Phase 2: Alpha 2 (导航系统)**
  - [x] Quick Flip 速翻覆盖层
  - [x] Timeline 时间轴组件
  - [x] Web Worker 异步缩略图生成
- [ ] **Phase 3: Beta 1 (夹页与持久化)** - *In Progress*
  - [x] 夹页 UI 与 逻辑实现
  - [ ] 基于 Dexie 的文档状态持久化
  - [ ] 夹页命名与备注功能
- [ ] **Phase 4: Beta 2 (工作区系统)** - *In Progress*
  - [x] 窗口化画布基础
  - [ ] 窗口拖拽、缩放与贴边分屏
  - [ ] 布局快照保存与恢复
- [ ] **Phase 5: Release Candidate (移动端与优化)**
  - [ ] 底部 Sheet 交互适配
  - [ ] 性能预算与首屏秒开优化
  - [ ] 1.0 正式版发布

## 💻 快速开始

### 开发环境
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 测试
```bash
# 运行单元测试
npm run test:unit

# 运行 UI 测试
npm run test:ui

# 运行 E2E 测试
npm run test:e2e
```

---

*页境：既是页与页之间的空间，也是用户建立知识地图的阅读环境。*
