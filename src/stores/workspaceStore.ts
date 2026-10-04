import { create } from 'zustand';
import { persistenceService, WorkspaceConflictError, workspaceVersion, type WorkspaceVersion } from '../services/PersistenceService';
import { notifyReaderNavigation } from '../services/readerNavigationIntent';
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
type BookAssetInput = Parameters<typeof persistenceService.saveBookAsset>[0];
interface PendingBookAsset { input: BookAssetInput; saved: boolean; sessionId: number }
// Keep the source until its own write succeeds. A small workspace snapshot can
// fit when a PDF cannot, so snapshot success alone must never imply durability.
let pendingBookAsset: PendingBookAsset | null = null;

async function persistBookAsset(asset: PendingBookAsset, persistence: typeof persistenceService) {
  if (!asset.saved) {
    await persistence.saveBookAsset(asset.input);
    asset.saved = true;
  }
  if (pendingBookAsset === asset) {
    pendingBookAsset = null;
    // Asset identity, not request generation, owns this completion: a newer
    // snapshot may already be waiting for this exact source write to finish.
    const pending = useWorkspaceStore.getState().pendingPdf;
    if (pending?.documentId === asset.input.documentId && pending.sessionId === asset.sessionId) {
      useWorkspaceStore.setState({ pendingPdf: null });
    }
  }
}

interface ExitSessionOwner { documentId: string; sessionId: number }
interface ExitBaseline extends ExitSessionOwner { signature: string }
interface WorkspaceOwnership extends ExitSessionOwner {
  version: WorkspaceVersion | undefined;
  conflict: WorkspaceConflictError | null;
}
export interface WorkspaceConflict extends ExitSessionOwner {
  version: WorkspaceVersion;
  savedAt: string | null;
  currentPage: number | null;
}
let workspaceOwnership: WorkspaceOwnership | null = null;
function ownershipFor(owner: ExitSessionOwner): WorkspaceOwnership {
  if (!workspaceOwnership || workspaceOwnership.documentId !== owner.documentId || workspaceOwnership.sessionId !== owner.sessionId) {
    workspaceOwnership = { ...owner, version: null, conflict: null };
  }
  return workspaceOwnership;
}
function conflictState(owner: ExitSessionOwner, conflict: WorkspaceConflictError): WorkspaceConflict {
  return { ...owner, version: conflict.version, savedAt: conflict.current?.savedAt ?? null,
    currentPage: Number.isInteger(conflict.current?.currentPage) ? conflict.current!.currentPage : null };
}
type ReadingState = Pick<WorkspaceSnapshot, 'currentPage' | 'scale' | 'heldPages' | 'windows' | 'activeWindowId'>;

function readingSignature(state: ReadingState): string {
  return JSON.stringify([state.currentPage, state.scale, state.heldPages, state.windows, state.activeWindowId]);
}
function liveReadingState(): ReadingState {
  return { currentPage: bookStore.getState().currentPage, scale: bookStore.getState().scale,
    heldPages: heldStore.getState().pages, windows: windowStore.getState().windows,
    activeWindowId: windowStore.getState().activeWindowId };
}
function activeSession(owner: ExitSessionOwner): boolean {
  const book = bookStore.getState();
  return book.status === 'ready' && book.documentId === owner.documentId && book.sessionId === owner.sessionId;
}
function exitBaseline(owner: ExitSessionOwner, reading = liveReadingState()): ExitBaseline {
  // An immutable projection, independent of the saved/error UI and savedAt.
  return { ...owner, signature: readingSignature(reading) };
}

export type WorkspaceStatus = 'idle' | 'saving' | 'restoring' | 'error';
export type WorkspaceErrorOperation = 'recent' | 'open' | 'register' | 'save' | 'restore' | 'conflict';

export interface WorkspaceStoreState {
  exitBaseline: ExitBaseline | null;
  unconfirmedSave: (ExitSessionOwner & { requestId: number }) | null;
  pendingPdf: ExitSessionOwner | null;
  currentSnapshot: WorkspaceSnapshot | null;
  conflict: WorkspaceConflict | null;
  recentBooks: RecentBookEntry[];
  status: WorkspaceStatus;
  error: string | null;
  errorOperation: WorkspaceErrorOperation | null;
  unrestoredDocumentId: string | null;
  clearError: () => void;
  hydrateRecentBooks: () => Promise<void>;
  openRecentBook: (documentId: string) => Promise<void>;
  registerCurrentBook: (file: File) => Promise<void>;
  saveWorkspace: (docId: string, options?: { replaceUnrestored?: boolean; replaceConflict?: WorkspaceVersion }) => Promise<void>;
  resolveWorkspaceConflict: (docId: string, action: 'reload' | 'overwrite', expectedVersion: WorkspaceVersion) => Promise<void>;
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
  exitBaseline: null,
  unconfirmedSave: null,
  pendingPdf: null,
  currentSnapshot: null,
  conflict: null,
  recentBooks: [],
  status: 'idle',
  error: null,
  errorOperation: null,
  unrestoredDocumentId: null,

  clearError: () => { if (!get().conflict) set({ error: null, errorOperation: null, status: 'idle' }); },

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
    const asset: PendingBookAsset = { input: {
      documentId, file, fileName: file.name, fileSize: file.size, totalPages: bookState.totalPages,
    }, saved: false, sessionId: bookState.sessionId };
    pendingBookAsset = asset;
    set({ pendingPdf: { documentId, sessionId: asset.sessionId } });
    const persistence = dependencies.persistenceService;
    const registration = saveQueue.then(() => persistBookAsset(asset, persistence));
    saveQueue = registration.catch(() => undefined);
    try {
      await registration;
      if (generation !== operationGeneration || bookStore.getState().documentId !== documentId) return;
      if (get().errorOperation === 'register') set({ error: null, errorOperation: null, status: 'idle' });
      await get().hydrateRecentBooks();
    } catch (error) {
      if (generation === operationGeneration && bookStore.getState().documentId === documentId) {
        set({ error: errorMessage(error, '无法保存 PDF 的本地副本，请检查浏览器存储后重试'), errorOperation: 'register', status: 'error' });
      }
    }
  },

  saveWorkspace: async (docId, options) => {
    const bookState = bookStore.getState();
    if (bookState.documentId !== docId || bookState.status !== 'ready' || get().status === 'restoring') return;
    if (get().unrestoredDocumentId === docId && !options?.replaceUnrestored) {
      set({ status: 'error', errorOperation: 'restore', error: '上次阅读现场尚未恢复，已暂停保存和切换。请先重试恢复，或点击「保存现场」确认替换。' });
      return;
    }
    const owner = { documentId: docId, sessionId: bookState.sessionId };
    const ownership = ownershipFor(owner);
    const replacementVersion = options?.replaceConflict;
    const replacingConflict = replacementVersion !== undefined;
    if (ownership.conflict && (!replacingConflict || replacementVersion !== ownership.conflict.version)) {
      set({ status: 'error', errorOperation: 'conflict', error: ownership.conflict.message, conflict: conflictState(owner, ownership.conflict) });
      return;
    }
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
    const asset = pendingBookAsset?.input.documentId === docId ? pendingBookAsset : null;
    let errorOperation: WorkspaceErrorOperation = asset ? 'register' : 'save';
    set({ status: 'saving', error: null, errorOperation: null, unconfirmedSave: { ...owner, requestId: generation } });
    // Serialize writes so a slower earlier save cannot overwrite a newer snapshot.
    let savedSnapshot = snapshot;
    const pendingSave = saveQueue.then(async () => {
      // An earlier queued request can discover a conflict after this one was
      // captured. It must stop every later automatic/manual queued write too.
      if (ownership.conflict && !replacingConflict) throw ownership.conflict;
      if (asset) await persistBookAsset(asset, persistence);
      errorOperation = 'save';
      if (ownership.version === undefined) {
        // Only explicit failed-restore replacement reaches this path. Read a
        // comparison baseline, then still compare atomically before replacing.
        ownership.version = workspaceVersion(await persistence.loadWorkspace(docId));
      }
      savedSnapshot = await persistence.saveWorkspace(snapshot, replacementVersion !== undefined ? replacementVersion : ownership.version);
      ownership.version = workspaceVersion(savedSnapshot);
      ownership.conflict = null;
      if (activeSession(owner) && workspaceOwnership === ownership) {
        // Every successful serialized write changes what is durable, even when
        // a later request owns the status UI. Never bless newer live edits here.
        set({ exitBaseline: exitBaseline(owner, snapshot),
          ...(get().unconfirmedSave?.requestId === generation ? { unconfirmedSave: null } : {}) });
      }
    }).catch(error => {
      if (error instanceof WorkspaceConflictError) {
        ownership.conflict = error;
        if (activeSession(owner) && workspaceOwnership === ownership) {
          set({ conflict: conflictState(owner, error), status: 'error', errorOperation: 'conflict', error: error.message });
        }
      }
      throw error;
    });
    saveQueue = pendingSave.catch(() => undefined);
    try {
      await pendingSave;
      if (generation !== operationGeneration || !activeSession(owner) || workspaceOwnership !== ownership) return;
      set({ currentSnapshot: savedSnapshot, conflict: null, status: 'idle', error: null, errorOperation: null, unrestoredDocumentId: null });
      await get().hydrateRecentBooks();
    } catch (error) {
      if (generation === operationGeneration && activeSession(owner) && workspaceOwnership === ownership) {
        set({ error: errorMessage(error, '保存到本机失败，请检查浏览器存储后重试'), errorOperation: ownership.conflict ? 'conflict' : errorOperation, status: 'error' });
      }
    }
  },

  restoreWorkspace: async (docId) => {
    if (bookStore.getState().documentId !== docId || bookStore.getState().status !== 'ready') return;
    if (get().conflict?.documentId === docId) return;
    const generation = ++operationGeneration;
    const owner = { documentId: docId, sessionId: bookStore.getState().sessionId };
    const ownership = ownershipFor(owner);
    ownership.version = undefined;
    set({ status: 'restoring', currentSnapshot: null, error: null, errorOperation: null, unrestoredDocumentId: docId });
    // Never display one book's held pages or windows on another PDF, including
    // while IndexedDB is unavailable or its snapshot is malformed.
    heldStore.getState().reset();
    windowStore.getState().reset();
    quickFlipStore.getState().reset();
    try {
      const snapshot = await dependencies.persistenceService.loadWorkspace(docId);
      if (generation !== operationGeneration || !activeSession(owner) || workspaceOwnership !== ownership) return;
      ownership.version = workspaceVersion(snapshot);
      if (snapshot) {
        if (snapshot.documentId !== docId || !Array.isArray(snapshot.heldPages) || !Array.isArray(snapshot.windows)) {
          throw new Error('保存的阅读现场无法恢复，请重新打开或保存当前现场');
        }
        bookStore.getState().setCurrentPage(snapshot.currentPage);
        bookStore.getState().setScale(snapshot.scale);
        heldStore.getState().restorePages(snapshot.heldPages);
        windowStore.getState().restoreWindows(snapshot.windows, snapshot.activeWindowId);
      }
      // A null read confirms absence, not durability of edits made since an
      // earlier failed attempt. Only an applied snapshot may replace that baseline.
      const baseline = get().exitBaseline;
      const initial = !baseline || baseline.sessionId !== owner.sessionId || baseline.documentId !== docId;
      set({ currentSnapshot: snapshot, status: 'idle', error: null, errorOperation: null, unrestoredDocumentId: null,
        ...(activeSession(owner) && (snapshot || initial) ? { exitBaseline: exitBaseline(owner) } : {}),
        ...(activeSession(owner) && snapshot ? { unconfirmedSave: null } : {}) });
      await get().hydrateRecentBooks();
    } catch (error) {
      if (generation === operationGeneration && activeSession(owner) && workspaceOwnership === ownership) {
        heldStore.getState().reset();
        windowStore.getState().reset();
        const baseline = get().exitBaseline;
        const initial = !baseline || baseline.sessionId !== owner.sessionId || baseline.documentId !== docId;
        // Establish the initial comparison after cleanup, including a restore
        // that partially applied page/scale before malformed saved data failed.
        set({ error: errorMessage(error, '恢复现场失败，可重试或继续阅读'), errorOperation: 'restore', status: 'error',
          ...(activeSession(owner) && initial ? { exitBaseline: exitBaseline(owner) } : {}) });
      }
    }
  },

  resolveWorkspaceConflict: async (docId, action, expectedVersion) => {
    const conflict = get().conflict;
    if (!conflict || conflict.documentId !== docId || !activeSession(conflict)
      || conflict.version !== expectedVersion || get().status === 'restoring' || get().status === 'saving') return;
    if (action === 'overwrite') {
      await get().saveWorkspace(docId, { replaceConflict: expectedVersion, replaceUnrestored: true });
      return;
    }
    const generation = ++operationGeneration;
    const ownership = ownershipFor(conflict);
    // The confirmed choice supersedes deferred navigation immediately, including
    // while the storage read is pending or ultimately fails without applying it.
    for (const window of windowStore.getState().windows) notifyReaderNavigation(window.id);
    set({ status: 'restoring' });
    let rollback: (() => void) | null = null;
    try {
      const snapshot = await dependencies.persistenceService.loadWorkspace(docId);
      if (generation !== operationGeneration || !activeSession(conflict)) return;
      // A failed read/validation leaves every live page, held page and window
      // untouched. Even a partially applied malformed legacy layout rolls back.
      ownership.conflict = new WorkspaceConflictError(snapshot);
      set({ conflict: conflictState(conflict, ownership.conflict) });
      // Consent names the detected version, for reload as well as overwrite.
      // A later third-tab save requires a fresh decision before losing live work.
      if (ownership.conflict.version !== expectedVersion) throw ownership.conflict;
      if (!snapshot) throw new Error('已存现场已被移除，无法载入。此页更改仍保留；可选择用此页覆盖。');
      if (snapshot.documentId !== docId || !Array.isArray(snapshot.heldPages) || !Array.isArray(snapshot.windows)) {
        throw new Error('保存的阅读现场无法恢复。此页更改仍保留；可选择用此页覆盖。');
      }
      const previousBook = bookStore.getState(), previousHeld = heldStore.getState(), previousWindows = windowStore.getState();
      rollback = () => {
        bookStore.setState({ currentPage: previousBook.currentPage, scale: previousBook.scale });
        // Restore content, never revive pre-replacement metadata capabilities.
        heldStore.setState({ ...previousHeld, metadataGeneration: Math.max(previousHeld.metadataGeneration, heldStore.getState().metadataGeneration) + 1 });
        windowStore.setState(previousWindows);
      };
      bookStore.getState().setCurrentPage(snapshot.currentPage);
      bookStore.getState().setScale(snapshot.scale);
      heldStore.getState().restorePages(snapshot.heldPages);
      windowStore.getState().restoreWindows(snapshot.windows, snapshot.activeWindowId);
      quickFlipStore.getState().reset();
      ownership.version = workspaceVersion(snapshot);
      ownership.conflict = null;
      set({ currentSnapshot: snapshot, conflict: null, status: 'idle', error: null, errorOperation: null,
        unrestoredDocumentId: null, exitBaseline: exitBaseline(conflict), unconfirmedSave: null });
      rollback = null;
      await get().hydrateRecentBooks();
    } catch (error) {
      if (generation !== operationGeneration || !activeSession(conflict)) return;
      rollback?.();
      set({ status: 'error', errorOperation: 'conflict', error: errorMessage(error, '载入已存现场失败，此页更改仍保留。请重试。') });
    }
  },

  reset: () => {
    operationGeneration += 1;
    workspaceOwnership = null;
    pendingBookAsset = null;
    set({ exitBaseline: null, unconfirmedSave: null, pendingPdf: null, currentSnapshot: null, conflict: null, recentBooks: [], status: 'idle', error: null, errorOperation: null, unrestoredDocumentId: null });
  },
}));

export const configureWorkspaceStoreDependencies = (overrides: Partial<WorkspaceStoreDependencies>) => {
  dependencies = { ...dependencies, ...overrides };
};
export const resetWorkspaceStoreDependencies = () => { dependencies = { ...defaultDependencies }; };
export const workspaceStore = useWorkspaceStore;

// Session changes retire only guard metadata. Existing queued I/O and source
// lifecycle retain their own ownership rules; this does not cancel disk writes.
bookStore.subscribe((book, previous) => {
  if (book.sessionId !== previous.sessionId) {
    workspaceOwnership = null;
    useWorkspaceStore.setState({ exitBaseline: null, unconfirmedSave: null, pendingPdf: null, conflict: null });
  }
});

export function hasUnsavedWorkspace(): boolean {
  const book = bookStore.getState();
  if (book.status !== 'ready' || !book.documentId) return false;
  const state = useWorkspaceStore.getState();
  if (state.conflict && activeSession(state.conflict)) return true;
  if ((state.pendingPdf && activeSession(state.pendingPdf)) || (state.unconfirmedSave && activeSession(state.unconfirmedSave))) return true;
  return !!state.exitBaseline && activeSession(state.exitBaseline) && state.exitBaseline.signature !== readingSignature(liveReadingState());
}
