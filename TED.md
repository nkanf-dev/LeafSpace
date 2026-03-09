# LeafSpace - 技术设计文档 (TED)

**版本**: vFinal  
**日期**: 2026-03-09  
**对应产品文档**: `PRD.md`  
**状态**: 可进入工程实施

---

## 1. 设计目标

LeafSpace 的技术设计目标不是堆砌能力，而是稳定支持以下核心链路：

1. 加载扫描版 PDF
2. 高性能翻页与缩放
3. 快速生成/缓存缩略图
4. 速翻快速定位
5. 夹页与窗口化工作区
6. 持久化恢复用户现场

技术上优先保证：
- 可交付
- 可维护
- 性能稳定
- 后续可扩展到 OCR / AI / 云同步 / 3D 模式

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | 组件化 + 类型安全 |
| 构建工具 | Vite | 快速开发与构建 |
| 状态管理 | Zustand | 多 Store、低心智负担 |
| PDF 渲染 | PDF.js | 主渲染引擎 |
| 手势/输入 | Pointer Events + 少量手势封装 | 优先原生，必要时补充手势层 |
| 本地存储 | IndexedDB + Dexie | 持久化工作区与缓存元数据 |
| 轻配置存储 | LocalStorage | UI 偏好 |
| 样式 | CSS Modules + 少量全局 Tokens | 隔离样式，便于维护 |
| 缩略图生成 | Canvas + Web Worker | 避免阻塞主线程 |

### 2.1 暂不作为 v1.0 必选依赖
- StPageFlip（作为后续 3D 模式扩展）
- react-rnd（如原生实现窗口拖拽足够，则不强依赖）
- 复杂自动布局引擎
- OCR / AI SDK

---

## 3. 系统架构

```text
┌────────────────────────────────────────────────────────────┐
│                         React 视图层                        │
├────────────────────────────────────────────────────────────┤
│ ReaderShell                                                │
│ ├── MainReaderViewport                                     │
│ ├── QuickFlipOverlay                                       │
│ ├── TimelineBar                                            │
│ ├── HeldPagesPanel                                         │
│ ├── WorkspaceCanvas                                        │
│ │   ├── MainWindow                                         │
│ │   ├── FloatingWindow(s)                                  │
│ │   └── DockedWindow(s)                                    │
│ └── MobileWorkspaceSheet                                   │
├────────────────────────────────────────────────────────────┤
│                       Zustand 状态层                        │
│ bookStore / quickFlipStore / heldStore / windowStore       │
│ workspaceStore / thumbnailStore / uiStore                  │
├────────────────────────────────────────────────────────────┤
│                          服务层                             │
│ PDFService / ThumbnailService / WorkspaceService           │
│ LayoutService / PersistenceService / InputService          │
├────────────────────────────────────────────────────────────┤
│                         Worker 层                           │
│ Thumbnail Worker / optional prefetch worker                │
├────────────────────────────────────────────────────────────┤
│                         存储层                              │
│ IndexedDB (workspace, cache metadata) / LocalStorage       │
└────────────────────────────────────────────────────────────┘
```

---

## 4. 模块划分

### 4.1 ReaderShell
应用顶层容器，负责：
- 文档加载生命周期
- 全局快捷键注册
- 主布局装配
- 错误边界与恢复

### 4.2 MainReaderViewport
负责：
- 当前页渲染
- 缩放
- 翻页
- 视口状态同步

### 4.3 QuickFlipOverlay
负责：
- 胶片式缩略图带
- 当前选中页高亮
- 键盘导航
- 夹页/打开/新窗等行为

### 4.4 HeldPagesPanel
负责：
- 夹页列表展示
- 缩略图
- 排序
- 页面打开状态标识

### 4.5 WorkspaceCanvas
负责：
- 主窗与浮动窗的容器管理
- z-index 管理
- 基础吸附布局
- 桌面端窗口行为

### 4.6 TimelineBar
负责：
- 显示总页进度
- 当前页位置
- 夹页标记
- 目录标记
- 点击/拖拽跳转

### 4.7 MobileWorkspaceSheet
移动端工作区降级表达层：
- 已打开页面列表
- 快速切换
- 已夹页浏览
- 简单对比入口

---

## 5. 状态管理设计

为降低复杂度，采用多 Store，而不是单一大 Store。

### 5.1 `bookStore`
```ts
interface BookState {
  documentId: string | null;
  fileName: string;
  pdfDocument: PDFDocumentProxy | null;
  totalPages: number;
  currentPage: number;
  scale: number;
  toc: TOCItem[];
  isLoaded: boolean;
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  errorMessage?: string;
}
```

职责：
- 文档加载
- 页码与缩放
- 文档元信息

### 5.2 `quickFlipStore`
```ts
interface QuickFlipState {
  isOpen: boolean;
  selectedPage: number;
  viewportCenterPage: number;
  holdDirection: 'idle' | 'prev' | 'next';
  accelerationTier: 0 | 1 | 2 | 3;
}
```

职责：
- 速翻打开/关闭
- 当前选中页
- 长按加速状态

### 5.3 `heldStore`
```ts
interface HeldPage {
  id: string;
  pageNumber: number;
  thumbnailKey?: string;
  defaultName: string;
  customName?: string;
  note?: string;
  color?: string;
  createdAt: string;
  isOpen: boolean;
  linkedWindowIds: string[];
}
```

职责：
- 夹页增删改查
- 与窗口状态关联

### 5.4 `windowStore`
```ts
type WindowType = 'main' | 'floating' | 'docked';

type DockMode = 'none' | 'left-half' | 'right-half' | 'grid';

interface ReaderWindow {
  id: string;
  type: WindowType;
  pageNumber: number;
  title: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  dockMode: DockMode;
  zIndex: number;
  isActive: boolean;
  canClose: boolean;
}
```

职责：
- 主窗/浮动窗/吸附窗管理
- 激活切换
- 关闭与交换主窗

### 5.5 `workspaceStore`
```ts
interface WorkspaceState {
  documentId: string | null;
  activeWindowId: string | null;
  lastSavedAt?: string;
  layoutPreset: 'single' | 'split' | 'grid';
  restoreStatus: 'idle' | 'restoring' | 'done' | 'failed';
}
```

职责：
- 工作区级别元状态
- 保存/恢复编排

### 5.6 `thumbnailStore`
```ts
interface ThumbnailEntry {
  key: string;
  pageNumber: number;
  width: number;
  height: number;
  blobUrl?: string;
  status: 'idle' | 'queued' | 'rendering' | 'ready' | 'error';
  lastAccessedAt: number;
}
```

职责：
- 缩略图缓存索引
- 渲染队列状态
- LRU 淘汰

### 5.7 `uiStore`
```ts
interface UIState {
  isLeftPanelOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  isMobileSheetOpen: boolean;
  toastQueue: string[];
}
```

---

## 6. 数据模型与持久化

### 6.1 IndexedDB 表设计（建议）

#### `documents`
- `id`
- `fileName`
- `fingerprint`
- `totalPages`
- `lastOpenedAt`

#### `workspaces`
- `documentId`
- `payload`（JSON）
- `updatedAt`

#### `held_pages`
- `id`
- `documentId`
- `pageNumber`
- `defaultName`
- `customName`
- `note`
- `color`
- `createdAt`

#### `thumbnails`
- `key`
- `documentId`
- `pageNumber`
- `size`
- `blob`
- `updatedAt`
- `lastAccessedAt`

### 6.2 LocalStorage
仅存：
- 面板开关状态
- 最近主题
- 是否展示新手提示
- 默认窗口打开方式

---

## 7. 服务层设计

### 7.1 `PDFService`
职责：
- 加载 PDF 文档
- 获取页面对象
- 管理预加载范围
- 暴露页尺寸与渲染能力

建议接口：
```ts
interface PDFService {
  load(fileOrUrl: File | string): Promise<PDFDocumentProxy>;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  renderPage(params: RenderPageParams): Promise<RenderResult>;
  destroy(): Promise<void>;
}
```

### 7.2 `ThumbnailService`
职责：
- 向 Worker 投递缩略图任务
- 查询缓存
- 优先渲染：当前页、夹页、速翻视口附近页面

### 7.3 `LayoutService`
职责：
- 生成基础布局预设
- 左右分屏 / 网格布局计算
- 窗口交换主窗逻辑

### 7.4 `WorkspaceService`
职责：
- 将当前状态序列化为工作区
- 从工作区恢复窗口与夹页
- 失败时降级到单窗模式

### 7.5 `InputService`
职责：
- 统一键盘与指针事件映射
- 桌面与移动端差异收口

---

## 8. 缩略图与预加载策略

### 8.1 缩略图策略
- 默认先生成中尺寸缩略图
- 优先级：
  1. 当前页
  2. 已夹页
  3. 速翻可视范围内页面
  4. 当前页邻近页面
- 后台 Worker 渲染
- 采用 LRU，默认上限 100 张

### 8.2 PDF 预加载策略
- 主阅读态：当前页 ±3
- 速翻态：围绕当前选中页加大预取范围
- 大文档降级：优先当前页和相邻页，不做激进预热

---

## 9. 窗口系统实现策略

### 9.1 v1.0 原则
只实现“足够好用”的窗口工作区，不实现完整桌面系统。

### 9.2 能力清单
- 主窗不可关闭
- 浮动窗可关闭
- 支持激活窗口
- 支持将某窗设为主窗
- 支持基础拖动定位（桌面端）
- 支持左右分屏和简单网格预设

### 9.3 限制
- 同时最多 5 个阅读窗口
- 不做复杂吸附动画
- 不做最小化任务栏体系
- 不做多显示器、多工作区同步

---

## 10. 速翻模式实现策略

### 10.1 打开流程
1. 冻结当前阅读上下文
2. 确定速翻起始页 = 当前页
3. 请求可视范围缩略图
4. 显示 Overlay 和 Timeline

### 10.2 导航策略
- 短按单步
- 长按分层加速
- 松手后立即停止或轻微惯性（实现可简化）

### 10.3 退出策略
退出速翻时需要明确目标：
- 跳转阅读
- 加入夹页
- 在新窗打开
- 对比打开

---

## 11. 移动端适配策略

### 11.1 原则
移动端不照搬桌面多窗口，而采用 **阅读主视图 + bottom sheet 工作区**。

### 11.2 表达方式
- 主视图：当前阅读页
- 底部工作区：已夹页 / 已打开页 / 快速切换
- 对比阅读：优先使用切换式或简单双页对比，而不是自由拖拽浮窗

---

## 12. 性能目标

- 常规 PDF 首次进入可阅读 < 3 秒
- 阅读 / 速翻 / 拖动主流程目标 60fps
- 支持 100MB 级 PDF 的可用性
- 缩略图渲染不得阻塞主线程交互

### 12.1 性能手段
- Worker 异步缩略图
- 分页惰性渲染
- 可见区域优先
- IndexedDB 缓存缩略图结果
- LRU 淘汰机制
- 大 PDF 降级策略

---

## 13. 错误处理与降级

### 13.1 文档级错误
- 加载失败：展示重试
- 部分页面失败：允许跳过并继续阅读

### 13.2 缩略图错误
- 缩略图失败时回退为页码卡片

### 13.3 工作区恢复错误
- 恢复失败时自动降级到：
  - 单窗
  - 当前页 = 上次主窗页
  - 保留夹页列表

### 13.4 大文档降级
- 降低预加载范围
- 限制并发缩略图任务数
- 限制同时打开窗口数

---

## 14. 代码目录建议

```text
src/
  app/
  components/
    reader/
    quick-flip/
    held-pages/
    timeline/
    workspace/
    mobile/
  stores/
    bookStore.ts
    quickFlipStore.ts
    heldStore.ts
    windowStore.ts
    workspaceStore.ts
    thumbnailStore.ts
    uiStore.ts
  services/
    PDFService.ts
    ThumbnailService.ts
    LayoutService.ts
    WorkspaceService.ts
    InputService.ts
  workers/
    thumbnail.worker.ts
  types/
  utils/
```

---

## 15. 里程碑与实施顺序

### Phase 1：阅读底座
- PDF.js 接入
- BookStore
- 单页渲染
- 缩放 / 翻页

### Phase 2：缩略图与速翻
- Thumbnail Worker
- QuickFlipOverlay
- Timeline 基础版

### Phase 3：夹页系统
- HeldStore
- HeldPagesPanel
- 夹页与缩略图关联

### Phase 4：工作区系统
- WindowStore
- WorkspaceCanvas
- 主窗 / 浮动窗 / 分屏预设

### Phase 5：持久化与移动端
- WorkspaceService
- IndexedDB
- MobileWorkspaceSheet
- 性能优化与错误恢复

---

## 16. 结论

LeafSpace v1.0 的技术路线应以 **PDF.js + Zustand + Worker + IndexedDB** 为稳定核心，围绕“速翻、夹页、Timeline、工作区”搭建一个可持续迭代的阅读平台。

3D、OCR、AI、云同步都可以是后续增量，但不应破坏首版的工程收敛性。

