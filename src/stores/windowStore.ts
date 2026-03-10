import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

import { bookStore } from './bookStore';
import { heldStore } from './heldStore';
import type { ReaderWindow } from '../types/domain';

export interface WindowStoreState {
  activeWindowId: string | null;
  closeWindow: (windowId: string) => void;
  closeWindowsForPage: (pageNumber: number) => void;
  openInMain: (pageNumber: number) => void;
  openInNewWindow: (pageNumber: number) => string;
  openInSplit: (pageNumber: number) => string;
  reset: () => void;
  restoreWindows: (windows: ReaderWindow[], activeWindowId?: string | null) => void;
  setActiveWindow: (windowId: string) => void;
  swapWithMain: (windowId: string) => void;
  updateWindow: (windowId: string, partial: Partial<ReaderWindow>) => void;
  windows: ReaderWindow[];
}

function createWindowTitle(pageNumber: number): string {
  return `Page ${pageNumber}`;
}

function createMainWindow(pageNumber = 1): ReaderWindow {
  return {
    canClose: false,
    dockMode: 'none',
    id: 'main',
    isActive: true,
    pageNumber,
    title: createWindowTitle(pageNumber),
    type: 'main',
    viewport: {
      mode: 'grab',
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    },
    zIndex: 1,
  };
}

/**
 * 核心同步逻辑：计算窗口变动导致的页面占用差异，更新 heldPages 的 linkedWindowIds
 */
function markHeldDiff(previousWindows: ReaderWindow[], nextWindows: ReaderWindow[]): void {
  const previousMap = new Map<string, number>();
  previousWindows.forEach(w => previousMap.set(w.id, w.pageNumber));
  
  const nextMap = new Map<string, number>();
  nextWindows.forEach(w => nextMap.set(w.id, w.pageNumber));

  // 处理关闭或页码变更的窗口
  previousWindows.forEach(w => {
    const nextPn = nextMap.get(w.id);
    if (nextPn === undefined) {
      // 窗口被关闭
      heldStore.getState().markHeldPageClosed(w.pageNumber, w.id);
    } else if (nextPn !== w.pageNumber) {
      // 窗口内页码变了
      heldStore.getState().markHeldPageClosed(w.pageNumber, w.id);
      heldStore.getState().markHeldPageOpen(nextPn, w.id);
    }
  });

  // 处理新增窗口
  nextWindows.forEach(w => {
    if (!previousMap.has(w.id)) {
      heldStore.getState().markHeldPageOpen(w.pageNumber, w.id);
    }
  });
}

const initialWindows = [createMainWindow()];

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  activeWindowId: 'main',
  windows: initialWindows,

  closeWindow: (windowId) => {
    const { windows, activeWindowId } = get();
    const target = windows.find(w => w.id === windowId);
    if (!target || !target.canClose) return;

    const nextWindows = windows.filter(w => w.id !== windowId);
    markHeldDiff(windows, nextWindows);

    set({
      windows: nextWindows,
      activeWindowId: activeWindowId === windowId ? 'main' : activeWindowId
    });
  },

  closeWindowsForPage: (pageNumber) => {
    const { windows, activeWindowId } = get();
    const closableIds = windows.filter((window) => window.canClose && window.pageNumber === pageNumber).map((window) => window.id);

    if (closableIds.length === 0) {
      return;
    }

    const nextWindows = windows.filter((window) => !closableIds.includes(window.id));
    markHeldDiff(windows, nextWindows);

    set({
      activeWindowId: activeWindowId && closableIds.includes(activeWindowId) ? 'main' : activeWindowId,
      windows: nextWindows,
    });
  },

  openInMain: (pageNumber) => {
    const { windows } = get();
    const nextWindows = windows.map(w => 
      w.id === 'main' 
        ? { ...w, pageNumber, title: createWindowTitle(pageNumber), isActive: true } 
        : { ...w, isActive: false }
    );
    markHeldDiff(windows, nextWindows);
    bookStore.getState().setCurrentPage(pageNumber);
    set({ windows: nextWindows, activeWindowId: 'main' });
  },

  openInNewWindow: (pageNumber) => {
    const { windows } = get();
    const id = uuidv4();
    const nextWindows = [...windows.map(w => ({ ...w, isActive: false })), {
      id,
      type: 'floating' as const,
      pageNumber,
      title: createWindowTitle(pageNumber),
      dockMode: 'none' as const,
      zIndex: Math.max(...windows.map(w => w.zIndex), 0) + 1,
      isActive: true,
      canClose: true,
      x: 150,
      y: 150,
      width: 450,
      height: 600,
      viewport: {
        mode: 'grab' as const,
        scale: 1,
        scrollLeft: 0,
        scrollTop: 0,
      },
    }];
    markHeldDiff(windows, nextWindows);
    set({ windows: nextWindows, activeWindowId: id });
    return id;
  },

  openInSplit: (pageNumber) => {
    const { windows } = get();
    const id = uuidv4();
    const nextWindows = [...windows.map(w => ({ ...w, isActive: false })), {
      id,
      type: 'docked' as const,
      pageNumber,
      title: createWindowTitle(pageNumber),
      dockMode: 'right-half' as const,
      zIndex: Math.max(...windows.map(w => w.zIndex), 0) + 1,
      isActive: true,
      canClose: true,
      splitRatio: 0.64,
      viewport: {
        mode: 'grab' as const,
        scale: 1,
        scrollLeft: 0,
        scrollTop: 0,
      },
    }];
    markHeldDiff(windows, nextWindows);
    set({ windows: nextWindows, activeWindowId: id });
    return id;
  },

  setActiveWindow: (windowId) => {
    const { windows } = get();
    set({
      activeWindowId: windowId,
      windows: windows.map(w => ({ ...w, isActive: w.id === windowId }))
    });
  },

  swapWithMain: (windowId) => {
    const { windows } = get();
    const mainWindow = windows.find(w => w.id === 'main');
    const targetWindow = windows.find(w => w.id === windowId);
    if (!mainWindow || !targetWindow || windowId === 'main') return;

    const nextWindows = windows.map(w => {
      if (w.id === 'main') return { ...w, pageNumber: targetWindow.pageNumber, title: targetWindow.title };
      if (w.id === windowId) return { ...w, pageNumber: mainWindow.pageNumber, title: mainWindow.title };
      return w;
    });

    markHeldDiff(windows, nextWindows);
    bookStore.getState().setCurrentPage(targetWindow.pageNumber);
    set({ windows: nextWindows, activeWindowId: 'main' });
  },

  updateWindow: (windowId, partial) => {
    const { windows } = get();
    const nextWindows = windows.map(w => w.id === windowId ? { ...w, ...partial } : w);
    // 如果页码变了，也需要同步标记
    if (partial.pageNumber !== undefined) {
      markHeldDiff(windows, nextWindows);
    }
    set({ windows: nextWindows });
  },

  reset: () => set({ windows: [createMainWindow()], activeWindowId: 'main' }),
  restoreWindows: (windows, activeWindowId) => set({ windows: windows.length > 0 ? windows : [createMainWindow()], activeWindowId: activeWindowId || 'main' }),
}));

export const windowStore = useWindowStore;
