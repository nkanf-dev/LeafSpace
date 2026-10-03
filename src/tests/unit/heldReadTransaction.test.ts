import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareHeldRead } from '../../services/HeldReadTransaction';
import { bookStore } from '../../stores/bookStore';
import { windowStore } from '../../stores/windowStore';
import { heldStore } from '../../stores/heldStore';

vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(), ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: (page: number) => `test_${page}` } }));
const viewport = { mode: 'grab' as const, scale: 1.4, scrollLeft: 120, scrollTop: 320 };

describe('prepared held-page reads', () => {
  beforeEach(() => {
    bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset();
    bookStore.getState().setDocumentReady({ documentId: 'held-intent', documentUrl: 'blob:held-intent', totalPages: 20, initialPage: 3, scale: 1.4 });
    windowStore.getState().updateWindow('main', { viewport });
  });

  it.each(['main', 'reference'])('restores only the %s page and exact independent viewport', origin => {
    const id = origin === 'main' ? 'main' : windowStore.getState().openInNewWindow(5);
    windowStore.getState().updateWindow(id, { viewport });
    const original = windowStore.getState().windows.find(window => window.id === id)!;
    const read = prepareHeldRead(8);
    expect(read.commit()).toBe(true);
    expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(8);
    windowStore.getState().updateWindow(id, { x: 260, width: 480 });
    expect(read.rollback()).toBe(true);
    expect(windowStore.getState().windows.find(window => window.id === id)).toMatchObject({ pageNumber: original.pageNumber, viewport, x: 260, width: 480 });
    expect(bookStore.getState()).toMatchObject({ currentPage: 3, scale: 1.4 });
    expect(read.rollback()).toBe(false);
  });

  for (const stage of ['pending', 'committed'] as const) {
    it.each(['page', 'active-window', 'scale', 'mode', 'scroll', 'document'])(`permanently invalidates ${stage} intent after %s changes away and back`, change => {
      const read = prepareHeldRead(8);
      if (stage === 'committed') expect(read.commit()).toBe(true);
      const expectedPage = stage === 'pending' ? 3 : 8;
      const original = { ...windowStore.getState().windows[0].viewport };
      if (change === 'page') {
        bookStore.getState().setCurrentPage(9); bookStore.getState().setCurrentPage(expectedPage);
      } else if (change === 'active-window') {
        const reference = windowStore.getState().openInNewWindow(5);
        windowStore.getState().setActiveWindow('main'); windowStore.getState().closeWindow(reference);
      } else if (change === 'scale') {
        bookStore.getState().setScale(2); bookStore.getState().setScale(1.4);
      } else if (change === 'document') {
        bookStore.getState().startLoading();
        bookStore.getState().setDocumentReady({ documentId: 'held-intent', documentUrl: 'blob:held-intent', totalPages: 20, currentPage: expectedPage, scale: 1.4 });
      } else {
        windowStore.getState().updateWindow('main', { viewport: { ...original, ...(change === 'mode' ? { mode: 'pointer' } : { scrollTop: 90 }) } });
        windowStore.getState().updateWindow('main', { viewport: original });
      }
      if (stage === 'pending') expect(read.commit()).toBe(false);
      else expect(read.rollback()).toBe(false);
      expect(bookStore.getState().currentPage).toBe(expectedPage);
    });
  }

  it('ignores no-op viewport writes and independent changes in another reader', () => {
    const other = windowStore.getState().openInNewWindow(5);
    windowStore.getState().setActiveWindow('main');
    const read = prepareHeldRead(8);
    windowStore.getState().updateWindow('main', { viewport: { ...viewport } });
    windowStore.getState().updateWindow(other, { pageNumber: 12 });
    expect(read.commit()).toBe(true);
    expect(read.rollback()).toBe(true);
    expect(windowStore.getState().windows.find(window => window.id === other)?.pageNumber).toBe(12);
  });

  it('makes same-page reads no-ops and disposal never restores a committed read', () => {
    const samePage = prepareHeldRead(3);
    expect(samePage.commit()).toBe(true);
    expect(samePage.rollback()).toBe(false);
    expect(windowStore.getState().windows[0].viewport).toEqual(viewport);
    const read = prepareHeldRead(8);
    expect(read.commit()).toBe(true);
    read.dispose();
    expect(read.rollback()).toBe(false);
    expect(bookStore.getState().currentPage).toBe(8);
  });

  it('cannot revive an intent after its reference closes', () => {
    const reference = windowStore.getState().openInNewWindow(5);
    const before = windowStore.getState().windows;
    const read = prepareHeldRead(8);
    windowStore.getState().closeWindow(reference);
    windowStore.getState().restoreWindows(before, reference);
    expect(read.commit()).toBe(false);
    expect(windowStore.getState().windows.find(window => window.id === reference)?.pageNumber).toBe(5);
  });
});
