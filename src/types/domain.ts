/**
 * LeafSpace 核心领域模型与共享类型定义
 * 
 * 本文件由 Agent 0 (Architect) 维护，作为系统的唯一真相来源 (SSOT)。
 */

export interface TOCItem {
  id: string;
  title: string;
  page: number;
  level: number;
}

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
  linkedWindowIds: string[]; // 追踪该页面在哪些窗口中被打开
}

export interface ViewportState {
  mode?: 'grab' | 'pointer';
  scale?: number;
  scrollLeft?: number;
  scrollTop?: number;
}

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
  splitRatio?: number;
  viewport?: ViewportState;
}

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

export interface RecentBookEntry {
  documentId: string;
  fileName: string;
  totalPages: number;
  fileSize: number;
  lastOpenedAt: string;
  lastSavedAt?: string;
}

export interface ThumbnailEntry {
  key: string;
  pageNumber: number;
  width: number;
  height: number;
  blobUrl?: string;
  status: 'idle' | 'queued' | 'rendering' | 'ready' | 'error';
  lastAccessedAt: number;
}
