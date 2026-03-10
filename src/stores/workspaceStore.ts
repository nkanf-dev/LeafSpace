import { create } from 'zustand';
import { persistenceService as defaultPersistenceService } from '../services/PersistenceService';
import type { PersistenceService } from '../services/PersistenceService';
import { bookStore } from './bookStore';
import { heldStore } from './heldStore';
import { windowStore } from './windowStore';
import type { WorkspaceSnapshot } from '../types/domain';

export type WorkspaceStatus = 'idle' | 'saving' | 'restoring' | 'error';

export interface WorkspaceStoreState {
  status: WorkspaceStatus;
  error: string | null;
  currentSnapshot: WorkspaceSnapshot | null;
  saveWorkspace: (docId: string) => Promise<void>;
  restoreWorkspace: (docId: string) => Promise<void>;
  reset: () => void;
}

let persistenceServiceDep: PersistenceService = defaultPersistenceService;

export function configureWorkspaceStoreDependencies(deps: { persistenceService: PersistenceService }) {
  persistenceServiceDep = deps.persistenceService;
}

export function resetWorkspaceStoreDependencies() {
  persistenceServiceDep = defaultPersistenceService;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  status: 'idle',
  error: null,
  currentSnapshot: null,

  saveWorkspace: async (docId) => {
    set({ status: 'saving', error: null });
    try {
      const { currentPage, scale } = bookStore.getState();
      const { pages: heldPages } = heldStore.getState();
      const { windows, activeWindowId } = windowStore.getState();

      const snapshot: WorkspaceSnapshot = {
        documentId: docId,
        currentPage,
        scale,
        activeWindowId,
        layoutPreset: 'single',
        heldPages,
        windows,
        savedAt: new Date().toISOString(),
      };

      await persistenceServiceDep.saveWorkspace(snapshot);
      set({ status: 'idle', currentSnapshot: snapshot });
    } catch (err: any) {
      set({ status: 'error', error: err.message ?? String(err) });
    }
  },

  restoreWorkspace: async (docId) => {
    set({ status: 'restoring', error: null });
    try {
      const snapshot = await persistenceServiceDep.loadWorkspace(docId);
      if (snapshot) {
        bookStore.getState().setCurrentPage(snapshot.currentPage);
        bookStore.getState().setScale(snapshot.scale);
        heldStore.getState().restorePages(snapshot.heldPages);
        windowStore.getState().restoreWindows(snapshot.windows, snapshot.activeWindowId);
        set({ status: 'idle', currentSnapshot: snapshot });
      } else {
        set({ status: 'idle' });
      }
    } catch (err: any) {
      set({ status: 'error', error: err.message ?? String(err) });
    }
  },

  reset: () => set({ status: 'idle', error: null, currentSnapshot: null }),
}));

export const workspaceStore = useWorkspaceStore;
