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
  return `第 ${pageNumber} 页`;
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

function normalizePage(pageNumber: number): number {
  const page = Number.isFinite(pageNumber) ? Math.max(1, Math.round(pageNumber)) : 1;
  const totalPages = bookStore.getState().totalPages;
  return totalPages > 0 ? Math.min(page, totalPages) : page;
}

function activate(windows: ReaderWindow[], activeWindowId: string): ReaderWindow[] {
  return windows.map((window) => ({ ...window, isActive: window.id === activeWindowId }));
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

    const nextActiveId = activeWindowId === windowId ? 'main' : activeWindowId ?? 'main';
    set({ windows: activate(nextWindows, nextActiveId), activeWindowId: nextActiveId });
  },

  closeWindowsForPage: (pageNumber) => {
    const { windows, activeWindowId } = get();
    const closableIds = windows.filter((window) => window.canClose && window.pageNumber === pageNumber).map((window) => window.id);

    if (closableIds.length === 0) {
      return;
    }

    const nextWindows = windows.filter((window) => !closableIds.includes(window.id));
    markHeldDiff(windows, nextWindows);

    const nextActiveId = activeWindowId && !closableIds.includes(activeWindowId) ? activeWindowId : 'main';
    set({ activeWindowId: nextActiveId, windows: activate(nextWindows, nextActiveId) });
  },

  openInMain: (pageNumber) => {
    bookStore.getState().setCurrentPage(pageNumber);
    pageNumber = bookStore.getState().currentPage;
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
    pageNumber = normalizePage(pageNumber);
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
    pageNumber = normalizePage(pageNumber);
    const { windows } = get();
    const existing = windows.find((window) => window.type === 'docked' && window.dockMode !== 'none');
    if (existing) {
      get().updateWindow(existing.id, { pageNumber, title: createWindowTitle(pageNumber) });
      get().setActiveWindow(existing.id);
      return existing.id;
    }
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
    if (!windows.some((window) => window.id === windowId)) return;
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
    set({ windows: activate(nextWindows, 'main'), activeWindowId: 'main' });
  },

  updateWindow: (windowId, partial) => {
    const { windows } = get();
    if (!windows.some((window) => window.id === windowId)) return;
    if (partial.pageNumber !== undefined) {
      const pageNumber = normalizePage(partial.pageNumber);
      partial = { ...partial, pageNumber, title: partial.title ?? createWindowTitle(pageNumber) };
      if (windowId === 'main') bookStore.getState().setCurrentPage(pageNumber);
    }
    const activeWindowId = partial.isActive ? windowId : get().activeWindowId ?? 'main';
    const nextWindows = activate(windows.map((window) => {
      if (window.id !== windowId) return window;
      const updated = { ...window, ...partial, id: window.id };
      return window.id === 'main'
        ? { ...updated, type: 'main' as const, canClose: false, pageNumber: bookStore.getState().currentPage }
        : updated;
    }), activeWindowId);
    markHeldDiff(windows, nextWindows);
    set({ windows: nextWindows, activeWindowId });
  },

  reset: () => {
    const windows = [createMainWindow(bookStore.getState().currentPage)];
    markHeldDiff(get().windows, windows);
    set({ windows, activeWindowId: 'main' });
  },
  restoreWindows: (windows, activeWindowId) => {
    const seen = new Set<string>();
    let hasDockedWindow = false;
    const normalized = windows.filter((window) => {
      if (!window.id || seen.has(window.id)) return false;
      seen.add(window.id);
      return true;
    }).map((window): ReaderWindow => {
      const pageNumber = window.id === 'main' ? bookStore.getState().currentPage : normalizePage(window.pageNumber);
      const title = !window.title || /^Page \d+$/.test(window.title) ? createWindowTitle(pageNumber) : window.title;
      if (window.id === 'main') return { ...window, pageNumber, title: createWindowTitle(pageNumber), canClose: false, type: 'main' };
      // The canvas supports one comparison pane. Preserve extra legacy panes as floating windows.
      if (window.type === 'docked' && window.dockMode !== 'none') {
        if (hasDockedWindow) return { ...window, pageNumber, title, type: 'floating', dockMode: 'none', canClose: true };
        hasDockedWindow = true;
      }
      return { ...window, pageNumber, title, canClose: true, type: window.type === 'main' ? 'floating' : window.type };
    });
    if (!seen.has('main')) normalized.unshift(createMainWindow(bookStore.getState().currentPage));
    const nextActiveId = normalized.some((window) => window.id === activeWindowId) ? activeWindowId! : 'main';
    const nextWindows = activate(normalized, nextActiveId);
    heldStore.getState().restorePages(heldStore.getState().pages.map((page) => ({
      ...page, linkedWindowIds: nextWindows.filter((window) => window.pageNumber === page.pageNumber).map((window) => window.id),
    })));
    set({ windows: nextWindows, activeWindowId: nextActiveId });
  },
}));

export const windowStore = useWindowStore;

// The book's currentPage is the only reading-position source of truth, including
// keyboard, quick-flip and restored navigation that bypasses window actions.
bookStore.subscribe((state, previous) => {
  if (state.currentPage === previous.currentPage) return;
  const windows = windowStore.getState().windows;
  const nextWindows = windows.map((window) => window.id === 'main'
    ? { ...window, pageNumber: state.currentPage, title: createWindowTitle(state.currentPage) }
    : window);
  markHeldDiff(windows, nextWindows);
  windowStore.setState({ windows: nextWindows });
});
