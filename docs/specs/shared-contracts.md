# LeafSpace 共享契约与跨模块接口规范

本文件是多 agent 并行开发时的最高优先级工程契约之一。

---

## 1. 架构原则

1. `bookStore.currentPage` 是主窗口阅读位置的唯一真源；参考窗口页码保存在各自的 `ReaderWindow.pageNumber`。全局导航通过 `windowStore.navigateActive` 跟随活动窗口。
2. `heldStore` 只保存“夹页引用与元数据”，不保存窗口布局。
3. `windowStore` 只保存“窗口展示状态”，不复制完整夹页数据。
4. `workspaceStore` 只保存工作区级别元状态与快照恢复流程状态。
5. 缩略图通过 `thumbnailStore + ThumbnailService` 管理，禁止各模块私自缓存重复 blob URL。
6. 任何 UI 组件都不应绕过 store 直接持久化 IndexedDB。

---

## 2. 推荐目录结构

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
  services/
  workers/
  types/
  utils/
```

---

## 3. 共享核心类型

建议统一放在：
- `src/types/domain.ts`
- `src/types/workspace.ts`
- `src/types/ui.ts`

### 3.1 TOCItem
```ts
export interface TOCItem {
  id: string;
  title: string;
  page: number;
  level: number;
}
```

### 3.2 HeldPage
```ts
export interface HeldPage {
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

### 3.3 ReaderWindow
```ts
export type WindowType = 'main' | 'floating' | 'docked';
export type DockMode = 'none' | 'left-half' | 'right-half' | 'grid';

export interface ReaderWindow {
  id: string;
  type: WindowType;
  pageNumber: number;
  title: string;
  dockMode: DockMode;
  zIndex: number;
  isActive: boolean;
  canClose: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
```

### 3.4 WorkspaceSnapshot
```ts
export interface WorkspaceSnapshot {
  documentId: string;
  currentPage: number;
  scale: number;
  activeWindowId: string | null;
  layoutPreset: 'single' | 'split' | 'grid';
  heldPages: HeldPage[];
  windows: ReaderWindow[];
  savedAt: string;
}
```

### 3.5 ThumbnailEntry
```ts
export interface ThumbnailEntry {
  key: string;
  pageNumber: number;
  width: number;
  height: number;
  blobUrl?: string;
  status: 'idle' | 'queued' | 'rendering' | 'ready' | 'error';
  lastAccessedAt: number;
}
```

---

## 4. Store 边界

### `bookStore`
负责：
- PDF 文档加载状态
- `currentPage`
- `scale`
- `toc`
- 基础翻页方法

不得负责：
- 夹页
- 窗口布局
- 持久化快照

### `quickFlipStore`
负责：
- 速翻开关
- 当前选中页
- 长按加速状态

### `heldStore`
负责：
- 夹页列表
- 夹页排序
- 页面是否已被窗口打开的映射状态

### `windowStore`
负责：
- 所有窗口实例
- 活动窗口
- 打开 / 关闭 / 置顶 / 设为主窗

### `workspaceStore`
负责：
- 当前工作区元状态
- 保存/恢复流程状态

### `thumbnailStore`
负责：
- 缩略图状态机
- 缓存索引
- LRU 元数据

---

## 5. 跨模块调用接口约定

### 5.1 PDFService
```ts
load(fileOrUrl: File | string): Promise<PDFDocumentProxy>
getPage(pageNumber: number): Promise<PDFPageProxy>
renderPage(params): Promise<RenderResult>
destroy(): Promise<void>
```

### 5.2 ThumbnailService
```ts
ensureThumbnail(pageNumber: number): Promise<string | undefined>
ensureThumbnails(pageNumbers: number[]): Promise<void>
releaseThumbnail(key: string): void
```

### 5.3 Held actions
```ts
holdPage(pageNumber: number): Promise<void>
unholdPage(pageNumber: number): void
reorderHeldPages(fromIndex: number, toIndex: number): void
markHeldPageOpen(pageNumber: number, windowId: string): void
markHeldPageClosed(pageNumber: number, windowId: string): void
```

### 5.4 Window actions
```ts
openInMain(pageNumber: number): void
openInNewWindow(pageNumber: number): string
openInSplit(pageNumber: number): string
closeWindow(windowId: string): void
setActiveWindow(windowId: string): void
navigateActive(pageNumber: number): void
setLayout(layout: 'floating' | 'split' | 'grid'): void
swapWithMain(windowId: string): void
```

### 5.5 Workspace actions
```ts
saveWorkspace(documentId: string): Promise<void>
restoreWorkspace(documentId: string): Promise<void>
clearWorkspace(documentId: string): Promise<void>
```

---

## 6. 事件语义约定

即使不实现全局事件总线，也要在命名和日志上统一：

- `PAGE_CHANGED`
- `PAGE_HELD`
- `PAGE_UNHELD`
- `QUICK_FLIP_OPENED`
- `QUICK_FLIP_CLOSED`
- `WINDOW_OPENED`
- `WINDOW_CLOSED`
- `WINDOW_ACTIVATED`
- `WORKSPACE_SAVED`
- `WORKSPACE_RESTORED`

---

## 7. UI 行为一致性

1. 夹页单击：在当前焦点上下文打开。
2. 夹页双击：优先进入对比打开。
3. `Space` 只控制速翻，不要绑定其他含义。
4. `Esc` 优先关闭最上层临时 UI。
5. 主窗不可关闭。
6. 新建窗口上限为 5（含主窗），新增夹页上限为 12；恢复旧现场不截断既有页面。
7. 速翻会冻结进入时的窗口上下文，确认跳页回到该窗口；打开新窗口则激活并聚焦新窗。
8. 小屏通过页面标签切换活动窗口，隐藏窗口不得把其滚动偏移覆盖为零。

---

## 8. 不允许的做法

- 不允许在多个地方重复定义 `HeldPage` / `ReaderWindow`。
- 不允许组件内部直接写 IndexedDB。
- 不允许一个 agent 为了省事改其他模块核心类型而不说明。
- 不允许把速翻的当前页做成独立于 `bookStore.currentPage` 的长期真源。


## Reader touch and timeline transactions

- Reader touch ownership is per surface/window. Fit-width grab mode reserves horizontal swipes; overflow uses native two-axis panning. Vertical scrolling remains native. Two contacts must start in the same surface; a third/foreign contact, cancellation, blur, context change or temporary-layer key discards the gesture.
- Pinch preview transforms pixels locally; release commits one clamped reader scale with the original paper point anchored to the ending midpoint. It never changes another window or the browser viewport scale. Existing 10–400% stored scale compatibility is retained.
- Timeline pointer preview is transient and never enters book/window stores or autosave. A normal release commits once to the originating active window. Moving more than56px vertically from the starting track position marks release as cancel; moving back resumes preview. Escape/Space, lost capture, pointercancel, blur, book/window/overlay change cancel. Native range keyboard and independent change input remain available.
- Chromium CDP native touch input and cross-engine DOM TouchEvent contracts are separate evidence categories. iPhone-sized WebKit emulation is not physical iOS testing.
