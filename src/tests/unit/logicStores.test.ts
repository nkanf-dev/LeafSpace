import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DexieWorkspacePersistencePort, PersistenceService } from '../../services/PersistenceService';
import { heldStore } from '../../stores/heldStore';
import { useBookStore } from '../../stores/bookStore';
import { thumbnailStore } from '../../stores/thumbnailStore';
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
    await Promise.all(dexiePorts.splice(0).map((port) => port.deleteDatabase()));
  });

  beforeEach(() => {
    useBookStore.getState().reset();
    heldStore.getState().reset();
    thumbnailStore.getState().reset();
    windowStore.getState().reset();
    workspaceStore.getState().reset();
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
});
