import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DexieWorkspacePersistencePort, PersistenceService } from '../../services/PersistenceService';
import { thumbnailService } from '../../services/ThumbnailService';
import { heldStore } from '../../stores/heldStore';
import { useBookStore } from '../../stores/bookStore';
import { thumbnailStore } from '../../stores/thumbnailStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import type { WorkspaceSnapshot } from '../../types/domain';
import { windowStore } from '../../stores/windowStore';
import {
  configureWorkspaceStoreDependencies,
  resetWorkspaceStoreDependencies,
  workspaceStore,
} from '../../stores/workspaceStore';

vi.mock('../../services/ThumbnailService', () => ({
  thumbnailService: {
    ensureThumbnail: vi.fn().mockResolvedValue(undefined),
    getThumbnailKey: vi.fn().mockImplementation((pageNumber: number) => `doc_${pageNumber}_240`),
  },
}));

describe('logic store integration', () => {
  const dexiePorts: DexieWorkspacePersistencePort[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    resetWorkspaceStoreDependencies();
    await Promise.all(dexiePorts.splice(0).map((port) => port.deleteDatabase()));
  });

  beforeEach(() => {
    vi.mocked(thumbnailService.ensureThumbnail).mockReset().mockResolvedValue(undefined);
    useBookStore.getState().reset();
    heldStore.getState().reset();
    thumbnailStore.getState().reset();
    windowStore.getState().reset();
    workspaceStore.getState().reset();
    quickFlipStore.getState().reset();
    resetWorkspaceStoreDependencies();
  });

  it('tracks held pages and their linked window ids', async () => {
    await heldStore.getState().holdPage(5);
    heldStore.getState().markHeldPageOpen(5, 'main');
    heldStore.getState().markHeldPageOpen(5, 'secondary');

    expect(heldStore.getState().pages[0]).toMatchObject({
      isOpen: true,
      linkedWindowIds: ['main', 'secondary'],
      pageNumber: 5,
      thumbnailKey: 'doc_5_240',
    });

    heldStore.getState().markHeldPageClosed(5, 'main');
    expect(heldStore.getState().pages[0].isOpen).toBe(true);
    expect(heldStore.getState().pages[0].linkedWindowIds).toEqual(['secondary']);

    heldStore.getState().markHeldPageClosed(5, 'secondary');
    expect(heldStore.getState().pages[0].isOpen).toBe(false);
    expect(heldStore.getState().pages[0].linkedWindowIds).toEqual([]);
  });

  it('deduplicates concurrent holdPage calls for the same page', async () => {
    const ensureThumbnailMock = vi.mocked(thumbnailService.ensureThumbnail);
    let releaseHold!: () => void;
    ensureThumbnailMock.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        releaseHold = () => resolve(undefined);
      }),
    );

    const firstHold = heldStore.getState().holdPage(12);
    const secondHold = heldStore.getState().holdPage(12);
    releaseHold();

    await Promise.all([firstHold, secondHold]);

    expect(heldStore.getState().pages.map((page) => page.pageNumber)).toEqual([12]);
  });

  it('shows held page immediately before thumbnail warmup finishes', async () => {
    const ensureThumbnailMock = vi.mocked(thumbnailService.ensureThumbnail);
    let releaseHold!: () => void;
    ensureThumbnailMock.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        releaseHold = () => resolve(undefined);
      }),
    );

    const holdPromise = heldStore.getState().holdPage(18);

    expect(heldStore.getState().pages.map((page) => page.pageNumber)).toEqual([18]);

    releaseHold();
    await holdPromise;
  });

  it('keeps bookStore currentPage in sync with main window operations', () => {
    useBookStore.getState().setDocumentReady({
      documentId: 'doc-main',
      totalPages: 20,
    });

    const floatingWindowId = windowStore.getState().openInNewWindow(8);
    expect(windowStore.getState().activeWindowId).toBe(floatingWindowId);

    windowStore.getState().openInMain(4);
    expect(useBookStore.getState().currentPage).toBe(4);

    windowStore.getState().swapWithMain(floatingWindowId);
    expect(useBookStore.getState().currentPage).toBe(8);
    expect(windowStore.getState().windows.find((window) => window.id === 'main')?.pageNumber).toBe(8);
  });

  it('persists and restores a workspace snapshot through Dexie-backed workspace store', async () => {
    const dexiePort = new DexieWorkspacePersistencePort(`leafspace-test-${crypto.randomUUID()}`);
    dexiePorts.push(dexiePort);
    const persistenceService = new PersistenceService(dexiePort);
    configureWorkspaceStoreDependencies({ persistenceService });

    useBookStore.getState().setDocumentReady({
      documentId: 'doc-save',
      initialPage: 7,
      scale: 1.5,
      totalPages: 20,
    });
    await heldStore.getState().holdPage(7);
    const splitWindowId = windowStore.getState().openInSplit(9);
    const secondWindowId = windowStore.getState().openInNewWindow(7);
    windowStore.getState().setActiveWindow(splitWindowId);

    await workspaceStore.getState().saveWorkspace('doc-save');

    useBookStore.getState().setCurrentPage(2);
    heldStore.getState().unholdPage(7);
    windowStore.getState().reset();

    await workspaceStore.getState().restoreWorkspace('doc-save');

    expect(useBookStore.getState().currentPage).toBe(7);
    expect(useBookStore.getState().scale).toBe(1.5);
    expect(heldStore.getState().pages.map((page) => page.pageNumber)).toEqual([7]);
    expect(heldStore.getState().pages[0].linkedWindowIds).toContain(secondWindowId);
    expect(windowStore.getState().windows.some((window) => window.id === splitWindowId)).toBe(true);
    expect(workspaceStore.getState().status).toBe('idle');
    expect(workspaceStore.getState().currentSnapshot?.documentId).toBe('doc-save');
  });

  it('keeps held pages when thumbnail generation fails and allows unholding during warmup', async () => {
    vi.mocked(thumbnailService.ensureThumbnail).mockRejectedValueOnce(new Error('Thumbnail unavailable'));
    await expect(heldStore.getState().holdPage(5)).resolves.toBeUndefined();
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([5]);
    let release!: () => void;
    vi.mocked(thumbnailService.ensureThumbnail).mockImplementationOnce(() => new Promise<undefined>(resolve => {
      release = () => resolve(undefined);
    }));
    const pending = heldStore.getState().holdPage(6);
    heldStore.getState().unholdPage(6);
    release();
    await pending;
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([5]);
  });

  it('reorders held pages and ignores invalid reorder indices', async () => {
    await Promise.all([2, 4, 6].map(page => heldStore.getState().holdPage(page)));
    heldStore.getState().reorderHeldPages(0, 2);
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([4, 6, 2]);
    const pages = heldStore.getState().pages;
    heldStore.getState().reorderHeldPages(-1, 0);
    heldStore.getState().reorderHeldPages(0, 3);
    expect(heldStore.getState().pages).toBe(pages);
  });

  it('deduplicates restored held pages and their linked window ids', async () => {
    await heldStore.getState().holdPage(3);
    const page = heldStore.getState().pages[0];
    heldStore.getState().restorePages([
      { ...page, linkedWindowIds: ['main', 'main'] },
      { ...page, linkedWindowIds: ['reference', 'reference'] },
    ]);
    expect(heldStore.getState().pages).toHaveLength(1);
    expect(heldStore.getState().pages[0]).toMatchObject({ isOpen: true, linkedWindowIds: ['reference'] });
  });

  it('synchronizes main-window pages and held links when bookStore navigates directly', async () => {
    useBookStore.getState().setDocumentReady({ documentId: 'main-sync', totalPages: 20 });
    await heldStore.getState().holdPage(4);
    useBookStore.getState().setCurrentPage(4);
    expect(windowStore.getState().windows[0].pageNumber).toBe(4);
    expect(heldStore.getState().pages[0].linkedWindowIds).toContain('main');
    useBookStore.getState().setCurrentPage(5);
    expect(heldStore.getState().pages[0].linkedWindowIds).not.toContain('main');
  });

  it('protects the main window and restores exactly one active window after closing a reference', () => {
    useBookStore.getState().setDocumentReady({ documentId: 'window-close', totalPages: 20 });
    const referenceId = windowStore.getState().openInNewWindow(8);
    windowStore.getState().closeWindow('main');
    expect(windowStore.getState().windows.some(window => window.id === 'main')).toBe(true);
    windowStore.getState().closeWindow(referenceId);
    expect(windowStore.getState().activeWindowId).toBe('main');
    expect(windowStore.getState().windows.filter(window => window.isActive).map(window => window.id)).toEqual(['main']);
    windowStore.getState().setActiveWindow('missing-window');
    expect(windowStore.getState().activeWindowId).toBe('main');
  });

  it('keeps multiple comparison panes visible in a grid with their held-page links', async () => {
    useBookStore.getState().setDocumentReady({ documentId: 'split', totalPages: 20 });
    await Promise.all([4, 8].map(page => heldStore.getState().holdPage(page)));
    const firstId = windowStore.getState().openInSplit(4);
    const secondId = windowStore.getState().openInSplit(8);
    expect(secondId).not.toBe(firstId);
    expect(windowStore.getState().windows.filter(window => window.dockMode === 'grid')).toHaveLength(2);
    expect(heldStore.getState().pages.find(page => page.pageNumber === 4)?.linkedWindowIds).toContain(firstId);
    expect(heldStore.getState().pages.find(page => page.pageNumber === 8)?.linkedWindowIds).toContain(secondId);
  });

  it('closes all references for a page and clears their held-page links', async () => {
    useBookStore.getState().setDocumentReady({ documentId: 'close-page', totalPages: 20 });
    await heldStore.getState().holdPage(8);
    windowStore.getState().openInNewWindow(8);
    windowStore.getState().openInSplit(8);
    windowStore.getState().closeWindowsForPage(8);
    expect(windowStore.getState().windows.map(window => window.id)).toEqual(['main']);
    expect(heldStore.getState().pages[0]).toMatchObject({ isOpen: false, linkedWindowIds: [] });
  });

  it('repairs a restored layout with a missing main window and stale active/link ids', async () => {
    useBookStore.getState().setDocumentReady({ documentId: 'restore-layout', totalPages: 20, initialPage: 7 });
    await heldStore.getState().holdPage(8);
    const id = windowStore.getState().openInNewWindow(8);
    const reference = windowStore.getState().windows.find(window => window.id === id)!;
    heldStore.getState().markHeldPageOpen(8, 'deleted-window');
    windowStore.getState().restoreWindows([reference, reference], 'deleted-window');
    expect(windowStore.getState().windows).toHaveLength(2);
    expect(windowStore.getState().windows.find(window => window.id === 'main')).toMatchObject({
      pageNumber: 7, isActive: true, canClose: false,
    });
    expect(heldStore.getState().pages[0].linkedWindowIds).toEqual([id]);
  });

  it('keeps quick-flip preview separate from book navigation until commit', () => {
    useBookStore.getState().setDocumentReady({ documentId: 'preview', totalPages: 20, initialPage: 7 });
    quickFlipStore.getState().open();
    quickFlipStore.getState().stepSelection(100);
    expect(quickFlipStore.getState().selectedPage).toBe(20);
    expect(useBookStore.getState().currentPage).toBe(7);
    quickFlipStore.getState().setAccelerating(true);
    quickFlipStore.getState().close();
    expect(quickFlipStore.getState()).toMatchObject({ isOpen: false, isAccelerating: false });
    expect(useBookStore.getState().currentPage).toBe(7);
    quickFlipStore.getState().open();
    expect(quickFlipStore.getState().selectedPage).toBe(7);
    quickFlipStore.getState().stepSelection(2);
    quickFlipStore.getState().commitSelection();
    expect(useBookStore.getState().currentPage).toBe(9);
    expect(windowStore.getState().windows[0].pageNumber).toBe(9);
    expect(quickFlipStore.getState().isOpen).toBe(false);
  });

  it('ignores save and restore requests for a different document', async () => {
    const service = new PersistenceService();
    const save = vi.spyOn(service, 'saveWorkspace').mockResolvedValue(undefined);
    const load = vi.spyOn(service, 'loadWorkspace').mockResolvedValue(null);
    configureWorkspaceStoreDependencies({ persistenceService: service });
    useBookStore.getState().setDocumentReady({ documentId: 'current', totalPages: 20 });
    await workspaceStore.getState().saveWorkspace('different');
    await workspaceStore.getState().restoreWorkspace('different');
    expect(save).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(workspaceStore.getState().status).toBe('idle');
  });

  it('discards old-book windows and held pages if restoring the new book fails', async () => {
    const service = new PersistenceService();
    vi.spyOn(service, 'loadWorkspace').mockRejectedValue(new Error('Storage unavailable'));
    configureWorkspaceStoreDependencies({ persistenceService: service });
    useBookStore.getState().setDocumentReady({ documentId: 'new-book', totalPages: 20, initialPage: 3 });
    await heldStore.getState().holdPage(8);
    windowStore.getState().openInNewWindow(8);
    await expect(workspaceStore.getState().restoreWorkspace('new-book')).resolves.toBeUndefined();
    expect(workspaceStore.getState()).toMatchObject({ status: 'error', errorOperation: 'restore', error: 'Storage unavailable' });
    expect(heldStore.getState().pages).toEqual([]);
    expect(windowStore.getState().windows).toHaveLength(1);
    expect(windowStore.getState().windows[0]).toMatchObject({ id: 'main', pageNumber: 3 });
    workspaceStore.getState().clearError();
    expect(workspaceStore.getState()).toMatchObject({ status: 'idle', error: null, errorOperation: null });
  });

  it('surfaces save failure without falsely updating the current snapshot', async () => {
    const service = new PersistenceService();
    vi.spyOn(service, 'saveWorkspace').mockRejectedValue(new Error('Quota exceeded'));
    configureWorkspaceStoreDependencies({ persistenceService: service });
    useBookStore.getState().setDocumentReady({ documentId: 'save-failure', totalPages: 20 });
    await expect(workspaceStore.getState().saveWorkspace('save-failure')).resolves.toBeUndefined();
    expect(workspaceStore.getState()).toMatchObject({
      status: 'error', errorOperation: 'save', error: 'Quota exceeded', currentSnapshot: null,
    });
  });

  it('serializes writes and captures each revision before asynchronous persistence', async () => {
    const service = new PersistenceService();
    let finishFirst!: () => void;
    const save = vi.spyOn(service, 'saveWorkspace')
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(service, 'listRecentBooks').mockResolvedValue([]);
    configureWorkspaceStoreDependencies({ persistenceService: service });
    useBookStore.getState().setDocumentReady({ documentId: 'queued', totalPages: 20, initialPage: 2 });
    const first = workspaceStore.getState().saveWorkspace('queued');
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    useBookStore.getState().setCurrentPage(8);
    const second = workspaceStore.getState().saveWorkspace('queued');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].currentPage).toBe(2);
    finishFirst();
    await Promise.all([first, second]);
    expect(save.mock.calls[1][0].currentPage).toBe(8);
    expect(workspaceStore.getState().currentSnapshot?.currentPage).toBe(8);
    expect(workspaceStore.getState().status).toBe('idle');
  });

  it('ignores a restore that completes after switching to another book', async () => {
    const service = new PersistenceService();
    let finishRestore!: (snapshot: WorkspaceSnapshot | null) => void;
    vi.spyOn(service, 'loadWorkspace').mockImplementation(() => new Promise(resolve => { finishRestore = resolve; }));
    configureWorkspaceStoreDependencies({ persistenceService: service });
    useBookStore.getState().setDocumentReady({ documentId: 'old', totalPages: 20 });
    const restoring = workspaceStore.getState().restoreWorkspace('old');
    useBookStore.getState().setDocumentReady({ documentId: 'new', totalPages: 30, initialPage: 4 });
    workspaceStore.getState().reset();
    finishRestore({
      documentId: 'old', currentPage: 15, scale: 2, activeWindowId: 'main', layoutPreset: 'single',
      heldPages: [], windows: [], savedAt: new Date().toISOString(),
    });
    await restoring;
    expect(useBookStore.getState()).toMatchObject({ documentId: 'new', currentPage: 4, scale: 1 });
    expect(workspaceStore.getState().currentSnapshot).toBeNull();
  });

});

describe('reading capacity and active context', () => {
  beforeEach(() => {
    useBookStore.getState().setDocumentReady({ documentId: 'capacity', totalPages: 30 });
    heldStore.getState().reset(); windowStore.getState().reset();
  });

  it('caps newly held pages at twelve while duplicates consume no extra space', async () => {
    for (let page = 1; page <= 12; page++) await heldStore.getState().holdPage(page);
    await heldStore.getState().holdPage(1);
    expect(heldStore.getState().notice).toBeNull();
    await heldStore.getState().holdPage(13);
    expect(heldStore.getState().pages).toHaveLength(12);
    expect(heldStore.getState().notice).toContain('12');
    heldStore.getState().unholdPage(4);
    await heldStore.getState().holdPage(13);
    expect(heldStore.getState().pages.at(-1)?.pageNumber).toBe(13);
    expect(heldStore.getState().notice).toBeNull();
  });

  it('caps new references without replacing an existing page, then permits one after closing', () => {
    const ids = [2, 3, 4, 5].map(page => windowStore.getState().openInNewWindow(page));
    windowStore.getState().openInNewWindow(6);
    expect(windowStore.getState().windows.map(win => win.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(windowStore.getState().notice).toContain('5');
    windowStore.getState().closeWindow(ids[0]);
    windowStore.getState().openInSplit(6);
    expect(windowStore.getState().windows).toHaveLength(5);
    expect(windowStore.getState().notice).toBeNull();
  });

  it('links newly held pages to already-visible windows immediately', async () => {
    const id = windowStore.getState().openInNewWindow(1);
    await heldStore.getState().holdPage(1);
    expect(heldStore.getState().pages[0].linkedWindowIds).toEqual(['main', id]);
    expect(heldStore.getState().pages[0].isOpen).toBe(true);
  });

  it('navigates only the active reference and resets its offsets for a new page', () => {
    const id = windowStore.getState().openInNewWindow(8);
    windowStore.getState().updateWindow(id, { viewport: { scale: 2, scrollTop: 300, scrollLeft: 90 } });
    windowStore.getState().navigateActive(9);
    expect(useBookStore.getState().currentPage).toBe(1);
    expect(windowStore.getState().windows.find(win => win.id === id)).toMatchObject({ pageNumber: 9, viewport: { scale: 2, scrollTop: 0, scrollLeft: 0 } });
  });

  it('swaps the page viewport with the main window', () => {
    useBookStore.getState().setScale(1.5);
    windowStore.getState().updateWindow('main', { viewport: { scale: 1.5, scrollTop: 140 } });
    const id = windowStore.getState().openInNewWindow(8);
    windowStore.getState().updateWindow(id, { viewport: { scale: 2, scrollTop: 300 } });
    windowStore.getState().swapWithMain(id);
    expect(useBookStore.getState().scale).toBe(2);
    expect(windowStore.getState().windows.find(win => win.id === 'main')?.viewport?.scrollTop).toBe(300);
    expect(windowStore.getState().windows.find(win => win.id === id)?.viewport).toMatchObject({ scale: 1.5, scrollTop: 140 });
  });

  it('preserves legacy panes and selects a retained active window without dropping main', () => {
    const windows = windowStore.getState().windows;
    const legacy = Array.from({ length: 7 }, (_, index) => ({ ...windows[0], id: `legacy-${index}`, type: 'floating' as const, canClose: true, pageNumber: index + 2 }));
    windowStore.getState().restoreWindows([...legacy, windows[0]], 'legacy-6');
    expect(windowStore.getState().windows).toHaveLength(8);
    expect(windowStore.getState().windows[0].id).toBe('main');
    expect(windowStore.getState().windows.filter(win => win.isActive).map(win => win.id)).toEqual(['legacy-6']);
    windowStore.getState().openInNewWindow(20);
    expect(windowStore.getState().windows).toHaveLength(8);
  });
});
