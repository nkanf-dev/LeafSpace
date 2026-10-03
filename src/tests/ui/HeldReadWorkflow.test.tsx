import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { bookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import { windowStore } from '../../stores/windowStore';
import { workspaceStore, configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies } from '../../stores/workspaceStore';
import { PersistenceService } from '../../services/PersistenceService';

vi.mock('../../components/workspace/WorkspaceCanvas', () => ({ WorkspaceCanvas: () => <div role="region" aria-label="主阅读区" tabIndex={0} /> }));
vi.mock('../../components/quick-flip/QuickFlipOverlay', () => ({ QuickFlipOverlay: () => null }));
vi.mock('../../components/timeline/TimelineBar', () => ({ TimelineBar: () => null }));
vi.mock('../../components/thumbnails/CachedThumbnail', () => ({ CachedThumbnail: () => null }));
vi.mock('../../hooks/useWorkspaceAutoSave', () => ({ useWorkspaceAutoSave: vi.fn() }));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(), ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: (page: number) => `test_${page}` } }));

describe('held-page read intent', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset(); workspaceStore.getState().reset(); quickFlipStore.getState().reset();
    const persistence = new PersistenceService();
    vi.spyOn(persistence, 'listRecentBooks').mockResolvedValue([]);
    configureWorkspaceStoreDependencies({ persistenceService: persistence });
    bookStore.getState().setDocumentReady({ documentId: 'intent', documentUrl: 'blob:intent', totalPages: 20, initialPage: 3, scale: 1.5 });
    await heldStore.getState().holdPage(8);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetWorkspaceStoreDependencies(); });

  it.each(['main', 'reference'])('preserves the %s origin after a recognized slow double click', async origin => {
    const id = origin === 'main' ? 'main' : windowStore.getState().openInNewWindow(5);
    const beforePage = origin === 'main' ? 3 : 5;
    const viewport = { scale: 1.5, mode: 'grab' as const, scrollLeft: 120, scrollTop: 460 };
    windowStore.getState().updateWindow(id, { viewport });
    render(<App />);
    const held = screen.getByRole('button', { name: '阅读第 8 页' });
    fireEvent.click(held, { detail: 1 });
    await act(async () => vi.advanceTimersByTime(221));
    expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(8);
    fireEvent.click(held, { detail: 2 });
    fireEvent.doubleClick(held, { detail: 2 });
    expect(windowStore.getState().windows.find(window => window.id === id)).toMatchObject({ pageNumber: beforePage, viewport });
    expect(windowStore.getState().windows.filter(window => window.canClose && window.id !== id)).toHaveLength(1);
    expect(bookStore.getState().currentPage).toBe(3);
  });

  it('does not read on a fast double click or open duplicate comparisons on a shifted sequence', async () => {
    render(<App />);
    const held = screen.getByRole('button', { name: '阅读第 8 页' });
    fireEvent.click(held, { detail: 1 });
    fireEvent.click(held, { detail: 2 }); fireEvent.doubleClick(held, { detail: 2 });
    await act(async () => vi.advanceTimersByTime(221));
    expect(bookStore.getState().currentPage).toBe(3);
    expect(windowStore.getState().windows).toHaveLength(2);
    fireEvent.click(held, { detail: 1, shiftKey: true });
    fireEvent.click(held, { detail: 2, shiftKey: true }); fireEvent.doubleClick(held, { detail: 2, shiftKey: true });
    expect(windowStore.getState().windows).toHaveLength(3);
  });

  it('discards a delayed read after newer navigation, view changes or compact resizing', async () => {
    render(<App />);
    const held = screen.getByRole('button', { name: '阅读第 8 页' });
    fireEvent.click(held, { detail: 1 });
    act(() => { bookStore.getState().setCurrentPage(6); bookStore.getState().setCurrentPage(3); });
    await act(async () => vi.advanceTimersByTime(221));
    expect(bookStore.getState().currentPage).toBe(3);
    fireEvent.click(held, { detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    await act(async () => vi.advanceTimersByTime(221));
    expect(bookStore.getState().currentPage).toBe(3);
    act(() => quickFlipStore.getState().reset());
    fireEvent.click(held, { detail: 1 });
    vi.stubGlobal('innerWidth', 390); fireEvent(window, new Event('resize'));
    await act(async () => vi.advanceTimersByTime(221));
    expect(bookStore.getState().currentPage).toBe(3);
  });

  it('reads immediately in a compact drawer and closes it without waiting for a double tap', () => {
    vi.stubGlobal('innerWidth', 390);
    render(<App />);
    const toggle = screen.getByRole('button', { name: '夹页 1' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '阅读第 8 页' }), { detail: 1 });
    expect(bookStore.getState().currentPage).toBe(8);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(windowStore.getState().windows).toHaveLength(1);
  });

  it('uses immediate read for desktop touch and keyboard activation without duplicate comparisons', () => {
    render(<App />);
    const held = screen.getByRole('button', { name: '阅读第 8 页' });
    const touch = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    fireEvent(held, touch); fireEvent.click(held, { detail: 1 });
    expect(bookStore.getState().currentPage).toBe(8);
    fireEvent.doubleClick(held, { detail: 2 });
    expect(windowStore.getState().windows).toHaveLength(1);
    act(() => bookStore.getState().setCurrentPage(3));
    fireEvent.click(held, { detail: 0 });
    expect(bookStore.getState().currentPage).toBe(8);
  });

  it('disposes delayed intent when an overlay interrupts it', async () => {
    render(<App />);
    const held = screen.getByRole('button', { name: '阅读第 8 页' });
    fireEvent.click(held, { detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: /速翻/ }));
    await act(async () => vi.advanceTimersByTime(221));
    expect(bookStore.getState().currentPage).toBe(3);
  });
});
