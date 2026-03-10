import { create } from 'zustand';
import { persistenceService } from '../services/PersistenceService';
import { bookStore } from './bookStore';
import { heldStore } from './heldStore';
import { windowStore } from './windowStore';
import type { RecentBookEntry, WorkspaceSnapshot } from '../types/domain';

interface WorkspaceStoreDependencies {
  persistenceService: typeof persistenceService;
}

const defaultDependencies: WorkspaceStoreDependencies = {
  persistenceService,
};

let dependencies: WorkspaceStoreDependencies = { ...defaultDependencies };

export type WorkspaceStatus = 'idle' | 'saving' | 'restoring' | 'error';

export interface WorkspaceStoreState {
  currentSnapshot: WorkspaceSnapshot | null;
  recentBooks: RecentBookEntry[];
  status: WorkspaceStatus;
  error: string | null;
  hydrateRecentBooks: () => Promise<void>;
  openRecentBook: (documentId: string) => Promise<void>;
  registerCurrentBook: (file: File) => Promise<void>;
  saveWorkspace: (docId: string) => Promise<void>;
  reset: () => void;
  restoreWorkspace: (docId: string) => Promise<void>;
}

function detectLayoutPreset() {
  const windows = windowStore.getState().windows;

  if (windows.some((window) => window.dockMode === 'grid')) {
    return 'grid' as const;
  }

  if (windows.some((window) => window.dockMode !== 'none')) {
    return 'split' as const;
  }

  return 'single' as const;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  currentSnapshot: null,
  recentBooks: [],
  status: 'idle',
  error: null,

  hydrateRecentBooks: async () => {
    const recentBooks = await dependencies.persistenceService.listRecentBooks();
    set({ recentBooks });
  },

  openRecentBook: async (documentId) => {
    set({ status: 'restoring', error: null });

    try {
      const file = await dependencies.persistenceService.loadBookAsset(documentId);

      if (!file) {
        throw new Error('未找到这本书的本地副本');
      }

      await bookStore.getState().loadDocument(file);
      await useWorkspaceStore.getState().restoreWorkspace(documentId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '打开最近书籍失败', status: 'error' });
    }
  },

  registerCurrentBook: async (file) => {
    const bookState = bookStore.getState();

    if (!bookState.documentId) {
      return;
    }

    await dependencies.persistenceService.saveBookAsset({
      documentId: bookState.documentId,
      file,
      fileName: file.name,
      fileSize: file.size,
      totalPages: bookState.totalPages,
    });

    const recentBooks = await dependencies.persistenceService.listRecentBooks();
    set({ recentBooks });
  },

  saveWorkspace: async (docId) => {
    set({ status: 'saving', error: null });

    try {
      const bookState = bookStore.getState();
      const snapshot: WorkspaceSnapshot = {
        documentId: docId,
        currentPage: bookState.currentPage,
        scale: bookState.scale,
        activeWindowId: windowStore.getState().activeWindowId,
        layoutPreset: detectLayoutPreset(),
        heldPages: heldStore.getState().pages,
        windows: windowStore.getState().windows,
        savedAt: new Date().toISOString(),
      };

      await dependencies.persistenceService.saveWorkspace(snapshot);
      const recentBooks = await dependencies.persistenceService.listRecentBooks();
      set({ currentSnapshot: snapshot, recentBooks, status: 'idle' });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '保存现场失败', status: 'error' });
    }
  },

  restoreWorkspace: async (docId) => {
    set({ status: 'restoring' });
    try {
      const snapshot = await dependencies.persistenceService.loadWorkspace(docId);

      if (snapshot) {
        bookStore.getState().setCurrentPage(snapshot.currentPage);
        bookStore.getState().setScale(snapshot.scale);
        heldStore.getState().restorePages(snapshot.heldPages);
        windowStore.getState().restoreWindows(snapshot.windows, snapshot.activeWindowId);
      } else {
        heldStore.getState().reset();
        windowStore.getState().reset();
      }

      const recentBooks = await dependencies.persistenceService.listRecentBooks();
      set({ currentSnapshot: snapshot, recentBooks, status: 'idle', error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '恢复现场失败', status: 'error' });
    }
  },

  reset: () => set({ currentSnapshot: null, recentBooks: [], status: 'idle', error: null }),
}));

export const configureWorkspaceStoreDependencies = (overrides: Partial<WorkspaceStoreDependencies>) => {
  dependencies = { ...dependencies, ...overrides };
};
export const resetWorkspaceStoreDependencies = () => {
  dependencies = { ...defaultDependencies };
};
export const workspaceStore = useWorkspaceStore;
