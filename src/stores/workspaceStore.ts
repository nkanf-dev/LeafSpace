import { create } from 'zustand';

import { persistenceService } from '../services/PersistenceService';
import type { PersistenceService } from '../services/PersistenceService';
import type { WorkspaceSnapshot } from '../types/domain';
import { bookStore } from './bookStore';
import { heldStore } from './heldStore';
import { windowStore } from './windowStore';

export type WorkspaceStatus = 'idle' | 'saving' | 'restoring' | 'error';

interface WorkspaceStoreDependencies {
  persistenceService: PersistenceService;
}

export interface WorkspaceStoreState {
  clearWorkspace: (documentId: string) => Promise<void>;
  currentSnapshot: WorkspaceSnapshot | null;
  error: string | null;
  lastSavedAt: string | null;
  reset: () => void;
  restoreWorkspace: (documentId: string) => Promise<void>;
  saveWorkspace: (documentId: string) => Promise<void>;
  status: WorkspaceStatus;
}

const initialState = {
  currentSnapshot: null,
  error: null,
  lastSavedAt: null,
  status: 'idle' as const,
};

let dependencies: WorkspaceStoreDependencies = {
  persistenceService,
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown workspace error';
}

function deriveLayoutPreset(windowCount: number): WorkspaceSnapshot['layoutPreset'] {
  if (windowCount <= 1) {
    return 'single';
  }

  if (windowCount === 2) {
    return 'split';
  }

  return 'grid';
}

function syncMainWindowPage(windows: WorkspaceSnapshot['windows'], currentPage: number): WorkspaceSnapshot['windows'] {
  return windows.map((window) =>
    window.id === 'main'
      ? {
          ...window,
          pageNumber: currentPage,
          title: `Page ${currentPage}`,
        }
      : window,
  );
}

function syncHeldPagesWithWindows(
  heldPages: WorkspaceSnapshot['heldPages'],
  windows: WorkspaceSnapshot['windows'],
): WorkspaceSnapshot['heldPages'] {
  const windowIdsByPage = windows.reduce<Record<number, string[]>>((accumulator, window) => {
    accumulator[window.pageNumber] = [...(accumulator[window.pageNumber] ?? []), window.id];
    return accumulator;
  }, {});

  return heldPages.map((page) => {
    const linkedWindowIds = Array.from(new Set(windowIdsByPage[page.pageNumber] ?? page.linkedWindowIds ?? []));

    return {
      ...page,
      isOpen: linkedWindowIds.length > 0,
      linkedWindowIds,
    };
  });
}

export function configureWorkspaceStoreDependencies(nextDependencies: Partial<WorkspaceStoreDependencies>): void {
  dependencies = {
    ...dependencies,
    ...nextDependencies,
  };
}

export function resetWorkspaceStoreDependencies(): void {
  dependencies = {
    persistenceService,
  };
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  ...initialState,
  clearWorkspace: async (documentId) => {
    await dependencies.persistenceService.clearWorkspace(documentId);

    set((state) => ({
      ...state,
      currentSnapshot: state.currentSnapshot?.documentId === documentId ? null : state.currentSnapshot,
      error: null,
    }));
  },
  reset: () => {
    set(() => ({
      ...initialState,
    }));
  },
  restoreWorkspace: async (documentId) => {
    set((state) => ({
      ...state,
      error: null,
      status: 'restoring',
    }));

    try {
      const snapshot = await dependencies.persistenceService.restoreWorkspace(documentId);

      if (!snapshot) {
        throw new Error(`No workspace snapshot found for ${documentId}.`);
      }

      const currentDocumentId = bookStore.getState().documentId;
      const currentTotalPages = bookStore.getState().totalPages;

      if (currentDocumentId && currentDocumentId !== documentId) {
        throw new Error('Load the matching PDF document before restoring this workspace.');
      }

      if (!currentDocumentId && currentTotalPages === 0) {
        throw new Error('Restore requires the matching PDF document to be loaded first.');
      }

      const syncedWindows = syncMainWindowPage(snapshot.windows, snapshot.currentPage);
      const syncedHeldPages = syncHeldPagesWithWindows(snapshot.heldPages, syncedWindows);

      bookStore.getState().setDocumentReady({
        documentId,
        initialPage: snapshot.currentPage,
        scale: snapshot.scale,
        totalPages: Math.max(currentTotalPages, snapshot.currentPage),
      });
      heldStore.getState().restorePages(syncedHeldPages);
      windowStore.getState().restoreWindows(syncedWindows, snapshot.activeWindowId);

      set(() => ({
        currentSnapshot: {
          ...snapshot,
          heldPages: syncedHeldPages,
          windows: syncedWindows,
        },
        error: null,
        lastSavedAt: snapshot.savedAt,
        status: 'idle',
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        error: normalizeErrorMessage(error),
        status: 'error',
      }));

      throw error;
    }
  },
  saveWorkspace: async (documentId) => {
    set((state) => ({
      ...state,
      error: null,
      status: 'saving',
    }));

    try {
      const bookState = bookStore.getState();
      const heldState = heldStore.getState();
      const windowState = windowStore.getState();
      const savedAt = new Date().toISOString();
      const syncedWindows = syncMainWindowPage(windowState.windows, bookState.currentPage);
      const syncedHeldPages = syncHeldPagesWithWindows(heldState.pages, syncedWindows);
      const snapshot: WorkspaceSnapshot = {
        activeWindowId: windowState.activeWindowId,
        currentPage: bookState.currentPage,
        documentId,
        heldPages: syncedHeldPages,
        layoutPreset: deriveLayoutPreset(windowState.windows.length),
        savedAt,
        scale: bookState.scale,
        windows: syncedWindows,
      };

      await dependencies.persistenceService.saveWorkspace(snapshot);

      set(() => ({
        currentSnapshot: snapshot,
        error: null,
        lastSavedAt: savedAt,
        status: 'idle',
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        error: normalizeErrorMessage(error),
        status: 'error',
      }));

      throw error;
    }
  },
  status: 'idle',
}));

export const workspaceStore = useWorkspaceStore;
