import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

import { bookStore } from './bookStore';
import { heldStore } from './heldStore';
import type { ReaderWindow } from '../types/domain';

export interface WindowStoreState {
  activeWindowId: string | null;
  closeWindow: (windowId: string) => void;
  openInMain: (pageNumber: number) => void;
  openInNewWindow: (pageNumber: number) => string;
  openInSplit: (pageNumber: number) => string;
  reset: () => void;
  restoreWindows: (windows: ReaderWindow[], activeWindowId?: string | null) => void;
  setActiveWindow: (windowId: string) => void;
  swapWithMain: (windowId: string) => void;
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
    zIndex: 1,
  };
}

function markHeldDiff(previousWindows: ReaderWindow[], nextWindows: ReaderWindow[]): void {
  const previousMap = new Map<string, { pageNumber: number; windowId: string }>();
  const nextMap = new Map<string, { pageNumber: number; windowId: string }>();

  for (const window of previousWindows) {
    previousMap.set(window.id, { pageNumber: window.pageNumber, windowId: window.id });
  }

  for (const window of nextWindows) {
    nextMap.set(window.id, { pageNumber: window.pageNumber, windowId: window.id });
  }

  for (const [windowId, previous] of previousMap.entries()) {
    const next = nextMap.get(windowId);

    if (!next) {
      heldStore.getState().markHeldPageClosed(previous.pageNumber, windowId);
      continue;
    }

    if (next.pageNumber !== previous.pageNumber) {
      heldStore.getState().markHeldPageClosed(previous.pageNumber, windowId);
      heldStore.getState().markHeldPageOpen(next.pageNumber, windowId);
    }
  }

  for (const [windowId, next] of nextMap.entries()) {
    if (!previousMap.has(windowId)) {
      heldStore.getState().markHeldPageOpen(next.pageNumber, windowId);
    }
  }
}

function buildRestoredWindows(windows: ReaderWindow[]): ReaderWindow[] {
  if (windows.length === 0) {
    return [createMainWindow(bookStore.getState().currentPage)];
  }

  if (windows.some((window) => window.id === 'main')) {
    return windows;
  }

  return [createMainWindow(bookStore.getState().currentPage), ...windows];
}

const initialWindows = [createMainWindow()];

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  activeWindowId: 'main',
  closeWindow: (windowId) => {
    const state = get();
    const target = state.windows.find((window) => window.id === windowId);

    if (!target || !target.canClose) {
      return;
    }

    const nextWindows = state.windows
      .filter((window) => window.id !== windowId)
      .map((window) => ({
        ...window,
        isActive: state.activeWindowId === windowId ? window.id === 'main' : window.isActive,
      }));

    markHeldDiff(state.windows, nextWindows);

    set(() => ({
      activeWindowId: state.activeWindowId === windowId ? 'main' : state.activeWindowId,
      windows: nextWindows,
    }));
  },
  openInMain: (pageNumber) => {
    const state = get();
    const nextWindows = state.windows.map((window) =>
      window.id === 'main'
        ? {
            ...window,
            isActive: true,
            pageNumber,
            title: createWindowTitle(pageNumber),
          }
        : {
            ...window,
            isActive: false,
          },
    );

    markHeldDiff(state.windows, nextWindows);
    bookStore.getState().setCurrentPage(pageNumber);

    set(() => ({
      activeWindowId: 'main',
      windows: nextWindows,
    }));
  },
  openInNewWindow: (pageNumber) => {
    const state = get();
    const nextWindowId = uuidv4();
    const nextZIndex = state.windows.reduce((maxZIndex, window) => Math.max(maxZIndex, window.zIndex), 0) + 1;
    const nextWindow: ReaderWindow = {
      canClose: true,
      dockMode: 'none',
      id: nextWindowId,
      isActive: true,
      pageNumber,
      title: createWindowTitle(pageNumber),
      type: 'floating',
      zIndex: nextZIndex,
    };
    const nextWindows = [...state.windows.map((window) => ({ ...window, isActive: false })), nextWindow];

    markHeldDiff(state.windows, nextWindows);

    set(() => ({
      activeWindowId: nextWindowId,
      windows: nextWindows,
    }));

    return nextWindowId;
  },
  openInSplit: (pageNumber) => {
    const state = get();
    const nextWindowId = uuidv4();
    const nextZIndex = state.windows.reduce((maxZIndex, window) => Math.max(maxZIndex, window.zIndex), 0) + 1;
    const nextWindow: ReaderWindow = {
      canClose: true,
      dockMode: 'right-half',
      id: nextWindowId,
      isActive: true,
      pageNumber,
      title: createWindowTitle(pageNumber),
      type: 'docked',
      zIndex: nextZIndex,
    };
    const nextWindows = [...state.windows.map((window) => ({ ...window, isActive: false })), nextWindow];

    markHeldDiff(state.windows, nextWindows);

    set(() => ({
      activeWindowId: nextWindowId,
      windows: nextWindows,
    }));

    return nextWindowId;
  },
  reset: () => {
    const nextWindows = [createMainWindow(bookStore.getState().currentPage)];
    markHeldDiff(get().windows, nextWindows);

    set(() => ({
      activeWindowId: 'main',
      windows: nextWindows,
    }));
  },
  restoreWindows: (windows, activeWindowId = 'main') => {
    const state = get();
    const nextWindows = buildRestoredWindows(windows).map((window) => ({
      ...window,
      isActive: window.id === (activeWindowId ?? 'main'),
    }));

    markHeldDiff(state.windows, nextWindows);

    const mainWindow = nextWindows.find((window) => window.id === 'main');

    if (mainWindow) {
      bookStore.getState().setCurrentPage(mainWindow.pageNumber);
    }

    set(() => ({
      activeWindowId: activeWindowId ?? 'main',
      windows: nextWindows,
    }));
  },
  setActiveWindow: (windowId) => {
    const state = get();

    if (!state.windows.some((window) => window.id === windowId)) {
      return;
    }

    set(() => ({
      activeWindowId: windowId,
      windows: state.windows.map((window) => ({
        ...window,
        isActive: window.id === windowId,
      })),
    }));
  },
  swapWithMain: (windowId) => {
    const state = get();
    const mainWindow = state.windows.find((window) => window.id === 'main');
    const targetWindow = state.windows.find((window) => window.id === windowId);

    if (!mainWindow || !targetWindow || windowId === 'main') {
      return;
    }

    const nextWindows = state.windows.map((window) => {
      if (window.id === 'main') {
        return {
          ...window,
          pageNumber: targetWindow.pageNumber,
          title: targetWindow.title,
        };
      }

      if (window.id === windowId) {
        return {
          ...window,
          pageNumber: mainWindow.pageNumber,
          title: mainWindow.title,
        };
      }

      return window;
    });

    markHeldDiff(state.windows, nextWindows);
    bookStore.getState().setCurrentPage(targetWindow.pageNumber);

    set(() => ({
      activeWindowId: 'main',
      windows: nextWindows.map((window) => ({
        ...window,
        isActive: window.id === 'main',
      })),
    }));
  },
  windows: initialWindows,
}));

export const windowStore = useWindowStore;
