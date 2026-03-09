/**
 * LeafSpace 核心领域模型与共享类型定义
 * 
 * 本文件由 Agent 0 (Architect) 维护，作为 Agent 1 (Frontend) 与 Agent 2 (Logic) 的开发契约。
 * 遵循 PRD 与 TED 中定义的空间化阅读模型。
 */

/**
 * 目录项模型 (Table of Contents)
 */
export interface TOCItem {
  id: string;
  title: string;
  page: number;
  level: number;
}

/**
 * 夹页 (Held Page) 模型
 * 核心 UX：像手指夹住页面一样保留关键页引用
 */
export interface HeldPage {
  id: string;             // 唯一标识 (UUID)
  pageNumber: number;     // PDF 对应页码 (1-based)
  thumbnailKey?: string;  // 关联缩略图的存储键
  defaultName: string;    // 默认名称 (如 "第 12 页")
  customName?: string;    // 用户自定义名称
  note?: string;          // 用户备注
  color?: string;         // 颜色标签 (用于分类)
  createdAt: string;      // 创建时间 (ISO)
  isOpen: boolean;        // 标识当前是否已在窗口中展示
}

/**
 * 窗口类型定义
 */
export type WindowType = 'main' | 'floating' | 'docked';

/**
 * 窗口吸附布局模式
 */
export type DockMode = 'none' | 'left-half' | 'right-half' | 'grid';

/**
 * 阅读窗口 (Reader Window) 模型
 * 核心 UX：支持并行对比阅读的空间容器
 */
export interface ReaderWindow {
  id: string;             // 窗口 ID
  type: WindowType;       // 窗口类型 (主窗/浮窗/吸附窗)
  pageNumber: number;     // 窗口当前加载的页码
  title: string;          // 窗口显示标题
  dockMode: DockMode;     // 当前吸附状态
  zIndex: number;         // 层级顺序
  isActive: boolean;      // 是否为焦点窗口
  canClose: boolean;      // 是否允许关闭 (主窗不可关闭)
  // 坐标与尺寸 (针对浮动窗口)
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * 工作区快照 (Workspace Snapshot)
 * 用于 IndexedDB 持久化，恢复用户的“阅读现场”
 */
export interface WorkspaceSnapshot {
  documentId: string;     // PDF 唯一指纹
  currentPage: number;    // 主窗最后阅读位置
  scale: number;          // 主窗缩放比例
  activeWindowId: string | null; // 最后的焦点窗口
  layoutPreset: 'single' | 'split' | 'grid'; // 布局预设
  heldPages: HeldPage[];  // 夹页列表快照
  windows: ReaderWindow[]; // 窗口实例快照
  savedAt: string;        // 保存时间戳
}

/**
 * 缩略图条目模型
 * 由 Logic 层的 ThumbnailService 管理
 */
export interface ThumbnailEntry {
  key: string;            // 缓存键 (docId_page_size)
  pageNumber: number;
  width: number;
  height: number;
  blobUrl?: string;       // 内存中的 Blob URL
  status: 'idle' | 'queued' | 'rendering' | 'ready' | 'error';
  lastAccessedAt: number; // 用于 LRU 淘汰策略
}
