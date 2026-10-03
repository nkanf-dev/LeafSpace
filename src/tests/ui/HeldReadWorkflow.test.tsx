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

  it('opens touch thumbnail actions without changing the reading context', async () => {
    render(<App />);
    const held = screen.getByRole('button', { name: '阅读第 8 页' });
    const down = new Event('pointerdown', { bubbles: true });
    Object.assign(down, { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: 20, clientY: 20 });
    fireEvent(held, down);
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('dialog', { name: '第 8 页操作' })).toBeInTheDocument();
    expect(bookStore.getState().currentPage).toBe(3);
    expect(bookStore.getState().scale).toBe(1.5);
    expect(windowStore.getState().windows).toHaveLength(1);
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([8]);
  });

  function pointer(target: Element | Window, type: string, overrides = {}) {
    fireEvent(target, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: 20, clientY: 20 }, overrides));
  }
  async function openActions() {
    const held = screen.getByRole('button', { name: '阅读第 8 页' });
    pointer(held, 'pointerdown');
    await act(async () => vi.advanceTimersByTime(500));
    return held;
  }
  it('does not open a pending hold after Escape in the main-only desktop workspace', async () => {
    render(<App />);
    pointer(screen.getByRole('button', { name: '阅读第 8 页' }), 'pointerdown');
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => vi.advanceTimersByTime(600));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bookStore.getState().currentPage).toBe(3);
    expect(windowStore.getState().windows).toHaveLength(1);
  });
  it.each(['blur', 'hidden'])('does not recover resize focus after %s interrupts the queued frame', async interruption => {
    render(<App />); const held = await openActions(); pointer(window, 'pointerup');
    vi.spyOn(held, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 50, 50)] as unknown as DOMRectList);
    const focus = vi.spyOn(held, 'focus');
    fireEvent(window, new Event('resize'));
    if (interruption === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      fireEvent(document, new Event('visibilitychange'));
    } else fireEvent(window, new Event('blur'));
    await act(async () => vi.advanceTimersByTime(40));
    expect(focus).not.toHaveBeenCalled();
  });
  it('keeps the original release out of action buttons and restores focus on first Escape', async () => {
    vi.stubGlobal('innerWidth', 390); render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '夹页 1' }));
    const held = await openActions();
    expect(screen.getByRole('button', { name: '阅读此页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    pointer(window, 'pointerup');
    fireEvent.click(screen.getByRole('button', { name: '阅读此页' }), { detail: 1, clientX: 20, clientY: 20 });
    expect(screen.getByRole('dialog', { name: '第 8 页操作' })).toBeInTheDocument();
    expect(bookStore.getState().currentPage).toBe(3);
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => vi.advanceTimersByTime(20));
    expect(screen.queryByRole('dialog', { name: '第 8 页操作' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '夹页 1' })).toHaveAttribute('aria-expanded', 'true');
    expect(held).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '夹页 1' })).toHaveAttribute('aria-expanded', 'false');
  });
  it.each(['阅读此页', '打开参考窗'])('delegates held %s only after a fresh activation', async action => {
    render(<App />); await openActions(); pointer(window, 'pointerup');
    fireEvent.click(screen.getByRole('button', { name: action }));
    await act(async () => vi.advanceTimersByTime(20));
    expect(screen.queryByRole('dialog', { name: '第 8 页操作' })).not.toBeInTheDocument();
    expect(bookStore.getState().currentPage).toBe(action === '阅读此页' ? 8 : 3);
    expect(windowStore.getState().windows).toHaveLength(action === '阅读此页' ? 1 : 2);
  });
  it('reuses linked-window removal choices instead of silently closing references', async () => {
    const id = windowStore.getState().openInNewWindow(8);
    render(<App />); await openActions(); pointer(window, 'pointerup');
    fireEvent.click(screen.getByRole('button', { name: '移除夹页' }));
    await act(async () => vi.advanceTimersByTime(20));
    expect(screen.getByRole('group', { name: '移除第 8 页夹页选项' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保留窗口' }));
    expect(heldStore.getState().pages).toHaveLength(0);
    expect(windowStore.getState().windows.some(window => window.id === id)).toBe(true);
  });

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
