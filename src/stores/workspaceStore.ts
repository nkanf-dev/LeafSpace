import { create } from 'zustand';
import { persistenceService } from '../services/PersistenceService';
import { bookStore } from './bookStore';
import { heldStore } from './heldStore';
import { windowStore } from './windowStore';
import { quickFlipStore } from './quickFlipStore';
import type { RecentBookEntry, WorkspaceSnapshot } from '../types/domain';

interface WorkspaceStoreDependencies {
  persistenceService: typeof persistenceService;
}
const defaultDependencies: WorkspaceStoreDependencies = { persistenceService };
let dependencies: WorkspaceStoreDependencies = { ...defaultDependencies };
let operationGeneration = 0;
let saveQueue: Promise<void> = Promise.resolve();

export type WorkspaceStatus = 'idle' | 'saving' | 'restoring' | 'error';
export type WorkspaceErrorOperation = 'recent' | 'open' | 'register' | 'save' | 'restore';

export interface WorkspaceStoreState {
  currentSnapshot: WorkspaceSnapshot | null;
  recentBooks: RecentBookEntry[];
  status: WorkspaceStatus;
  error: string | null;
  errorOperation: WorkspaceErrorOperation | null;
  clearError: () => void;
  hydrateRecentBooks: () => Promise<void>;
  openRecentBook: (documentId: string) => Promise<void>;
  registerCurrentBook: (file: File) => Promise<void>;
  saveWorkspace: (docId: string) => Promise<void>;
  reset: () => void;
  restoreWorkspace: (docId: string) => Promise<void>;
}

function detectLayoutPreset(): WorkspaceSnapshot['layoutPreset'] {
  const windows = windowStore.getState().windows;
  if (windows.some((window) => window.dockMode === 'grid')) return 'grid';
  if (windows.some((window) => window.dockMode !== 'none')) return 'split';
  return 'single';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  currentSnapshot: null,
  recentBooks: [],
  status: 'idle',
  error: null,
  errorOperation: null,

  clearError: () => set({ error: null, errorOperation: null, status: 'idle' }),

  hydrateRecentBooks: async () => {
    const generation = operationGeneration;
    try {
      const recentBooks = await dependencies.persistenceService.listRecentBooks();
      if (generation !== operationGeneration) return;
      // Do not clear an unrelated import, save, or restore failure.
      set(get().errorOperation === 'recent'
        ? { recentBooks, error: null, errorOperation: null, status: 'idle' }
        : { recentBooks });
    } catch (error) {
      if (generation === operationGeneration && !get().error) {
        set({ error: errorMessage(error, '无法读取最近书籍，请检查浏览器存储后重试'), errorOperation: 'recent', status: 'error' });
      }
    }
  },

  openRecentBook: async (documentId) => {
    if (get().status === 'restoring' || bookStore.getState().status === 'loading') return;
    const generation = ++operationGeneration;
    set({ status: 'restoring', error: null, errorOperation: null });
    try {
      const file = await dependencies.persistenceService.loadBookAsset(documentId);
      if (generation !== operationGeneration) return;
      if (!file) throw new Error('未找到这本书的本地副本，请重新导入原 PDF');
      quickFlipStore.getState().reset();
      heldStore.getState().reset();
      windowStore.getState().reset();
      await bookStore.getState().loadDocument(file);
      if (generation !== operationGeneration) return;
      // The parsed fingerprint is authoritative, even for an older imported record.
      const loadedId = bookStore.getState().documentId;
      if (loadedId) await get().restoreWorkspace(loadedId);
    } catch (error) {
      if (generation === operationGeneration) {
        set({ error: errorMessage(error, '打开最近书籍失败'), errorOperation: 'open', status: 'error' });
      }
    }
  },

  registerCurrentBook: async (file) => {
    const bookState = bookStore.getState();
    if (!bookState.documentId || bookState.status !== 'ready') return;
    const documentId = bookState.documentId;
    const generation = operationGeneration;
    try {
      await dependencies.persistenceService.saveBookAsset({
        documentId, file, fileName: file.name, fileSize: file.size, totalPages: bookState.totalPages,
      });
      if (generation !== operationGeneration || bookStore.getState().documentId !== documentId) return;
      if (get().errorOperation === 'register') set({ error: null, errorOperation: null, status: 'idle' });
      await get().hydrateRecentBooks();
    } catch (error) {
      if (generation === operationGeneration && bookStore.getState().documentId === documentId) {
        set({ error: errorMessage(error, '无法保存 PDF 的本地副本，请检查浏览器存储后重试'), errorOperation: 'register', status: 'error' });
      }
    }
  },

  saveWorkspace: async (docId) => {
    const bookState = bookStore.getState();
    if (bookState.documentId !== docId || bookState.status !== 'ready' || get().status === 'restoring') return;
    const generation = ++operationGeneration;
    const snapshot: WorkspaceSnapshot = {
      documentId: docId,
      currentPage: bookState.currentPage,
      scale: bookState.scale,
      activeWindowId: windowStore.getState().activeWindowId,
      layoutPreset: detectLayoutPreset(),
      heldPages: heldStore.getState().pages.map((page) => ({ ...page, linkedWindowIds: [...page.linkedWindowIds] })),
      windows: windowStore.getState().windows.map((window) => ({ ...window, viewport: window.viewport ? { ...window.viewport } : undefined })),
      savedAt: new Date().toISOString(),
    };
    const persistence = dependencies.persistenceService;
    set({ status: 'saving', error: null, errorOperation: null });
    // Serialize writes so a slower earlier save cannot overwrite a newer snapshot.
    const pendingSave = saveQueue.then(() => persistence.saveWorkspace(snapshot));
    saveQueue = pendingSave.catch(() => undefined);
    try {
      await pendingSave;
      if (generation !== operationGeneration || bookStore.getState().documentId !== docId) return;
      set({ currentSnapshot: snapshot, status: 'idle' });
      await get().hydrateRecentBooks();
    } catch (error) {
      if (generation === operationGeneration && bookStore.getState().documentId === docId) {
        set({ error: errorMessage(error, '保存现场失败，请检查浏览器存储后重试'), errorOperation: 'save', status: 'error' });
      }
    }
  },

  restoreWorkspace: async (docId) => {
    if (bookStore.getState().documentId !== docId || bookStore.getState().status !== 'ready') return;
    const generation = ++operationGeneration;
    set({ status: 'restoring', currentSnapshot: null, error: null, errorOperation: null });
    // Never display one book's held pages or windows on another PDF, including
    // while IndexedDB is unavailable or its snapshot is malformed.
    heldStore.getState().reset();
    windowStore.getState().reset();
    quickFlipStore.getState().reset();
    try {
      const snapshot = await dependencies.persistenceService.loadWorkspace(docId);
      if (generation !== operationGeneration || bookStore.getState().documentId !== docId) return;
      if (snapshot) {
        if (snapshot.documentId !== docId || !Array.isArray(snapshot.heldPages) || !Array.isArray(snapshot.windows)) {
          throw new Error('保存的阅读现场无法恢复，请重新打开或保存当前现场');
        }
        bookStore.getState().setCurrentPage(snapshot.currentPage);
        bookStore.getState().setScale(snapshot.scale);
        heldStore.getState().restorePages(snapshot.heldPages);
        windowStore.getState().restoreWindows(snapshot.windows, snapshot.activeWindowId);
      }
      set({ currentSnapshot: snapshot, status: 'idle', error: null, errorOperation: null });
      await get().hydrateRecentBooks();
    } catch (error) {
      if (generation === operationGeneration && bookStore.getState().documentId === docId) {
        heldStore.getState().reset();
        windowStore.getState().reset();
        set({ error: errorMessage(error, '恢复现场失败，可重试或继续阅读'), errorOperation: 'restore', status: 'error' });
      }
    }
  },

  reset: () => {
    operationGeneration += 1;
    set({ currentSnapshot: null, recentBooks: [], status: 'idle', error: null, errorOperation: null });
  },
}));

export const configureWorkspaceStoreDependencies = (overrides: Partial<WorkspaceStoreDependencies>) => {
  dependencies = { ...dependencies, ...overrides };
};
export const resetWorkspaceStoreDependencies = () => { dependencies = { ...defaultDependencies }; };
export const workspaceStore = useWorkspaceStore;
