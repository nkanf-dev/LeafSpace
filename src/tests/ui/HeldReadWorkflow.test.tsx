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
  it('saves metadata without changing the active reference, reading viewports, or PDF source', async () => {
    const id = windowStore.getState().openInNewWindow(5);
    windowStore.getState().updateWindow(id, { viewport: { scale: 1.7, mode: 'grab', scrollLeft: 21, scrollTop: 140 } });
    const before = { book: bookStore.getState(), windows: windowStore.getState().windows };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '编辑第 8 页名称和备注' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '图示' } });
    fireEvent.change(screen.getByRole('textbox', { name: '备注' }), { target: { value: '对照定义' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(heldStore.getState().pages[0]).toMatchObject({ customName: '图示', note: '对照定义' });
    expect(screen.getByRole('button', { name: '阅读第 8 页' })).toHaveAccessibleDescription('图示 对照定义');
    expect(windowStore.getState().windows).toBe(before.windows);
    expect(windowStore.getState().activeWindowId).toBe(id);
    expect(bookStore.getState()).toBe(before.book);
  });

  it.each(['desktop', 'compact'])('gives editor Escape priority over the %s reference/drawer', async layout => {
    if (layout === 'compact') vi.stubGlobal('innerWidth', 390);
    const id = windowStore.getState().openInNewWindow(5);
    render(<App />);
    if (layout === 'compact') fireEvent.click(screen.getByRole('button', { name: '夹页 1' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑第 8 页名称和备注' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: '名称' }), { key: 'Escape', isComposing: true, keyCode: 229 });
    expect(screen.getByRole('textbox', { name: '名称' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '名称' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: '名称' })).not.toBeInTheDocument();
    expect(windowStore.getState().windows.some(window => window.id === id)).toBe(true);
    if (layout === 'compact') expect(screen.getByRole('button', { name: '夹页 1' })).toHaveAttribute('aria-expanded', 'true');
    await act(async () => vi.advanceTimersByTime(20));
    expect(screen.getByRole('button', { name: '编辑第 8 页名称和备注' })).toHaveFocus();
  });

  it.each(['book', 'same-book-reopen', 'restore', 'remove', 'quick-flip'])('retires editor metadata on %s changes', async change => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '编辑第 8 页名称和备注' }));
    const staleForm = screen.getByRole('form', { name: '编辑第 8 页名称和备注' });
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '旧草稿' } });
    act(() => {
      if (change === 'book' || change === 'same-book-reopen') bookStore.getState().setDocumentReady({ documentId: change === 'book' ? 'other' : 'intent', totalPages: 20 });
      if (change === 'restore') heldStore.getState().restorePages(heldStore.getState().pages);
      if (change === 'remove') heldStore.getState().unholdPage(8);
      if (change === 'quick-flip') quickFlipStore.getState().open(3);
    });
    expect(screen.queryByRole('textbox', { name: '名称' })).not.toBeInTheDocument();
    fireEvent.submit(staleForm);
    expect(heldStore.getState().pages.every(page => !page.customName && !page.note)).toBe(true);
  });

  it('claims a pending mouse read on editor pointerdown before its delayed click can commit', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '阅读第 8 页' }), { detail: 1 });
    await act(async () => vi.advanceTimersByTime(210));
    const edit = screen.getByRole('button', { name: '编辑第 8 页名称和备注' });
    pointer(edit, 'pointerdown', { pointerType: 'mouse' });
    await act(async () => vi.advanceTimersByTime(100));
    fireEvent.click(edit);
    expect(bookStore.getState().currentPage).toBe(3);
    expect(windowStore.getState().windows).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '名称' })).toHaveFocus();
  });

  it.each(['compact', 'desktop'])('cancels a draft and recovers visible focus on a move to %s layout', async destination => {
    vi.stubGlobal('innerWidth', destination === 'compact' ? 1440 : 390);
    render(<App />);
    const toggle = screen.getByRole('button', { name: '夹页 1' });
    if (destination === 'desktop') fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '编辑第 8 页名称和备注' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '未保存' } });
    vi.stubGlobal('innerWidth', destination === 'compact' ? 390 : 1440);
    fireEvent(window, new Event('resize'));
    await act(async () => vi.advanceTimersByTime(20));
    expect(screen.queryByRole('textbox', { name: '名称' })).not.toBeInTheDocument();
    expect(destination === 'compact' ? toggle : screen.getByRole('button', { name: '编辑第 8 页名称和备注' })).toHaveFocus();
    expect(heldStore.getState().pages[0].customName).toBeUndefined();
  });

  it('retains a held-page draft while the reader changes pages or focus windows', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '编辑第 8 页名称和备注' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '正在查阅的证明' } });
    fireEvent.change(screen.getByRole('textbox', { name: '备注' }), { target: { value: '切换阅读页后继续补充' } });
    act(() => bookStore.getState().setCurrentPage(6));
    expect(screen.getByRole('textbox', { name: '名称' })).toHaveValue('正在查阅的证明');
    expect(screen.getByRole('textbox', { name: '名称' })).toHaveFocus();
    act(() => windowStore.getState().openInNewWindow(11));
    expect(screen.getByRole('textbox', { name: '备注' })).toHaveValue('切换阅读页后继续补充');
    const windows = windowStore.getState().windows;
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(heldStore.getState().pages[0]).toMatchObject({ customName: '正在查阅的证明', note: '切换阅读页后继续补充' });
    expect(bookStore.getState().currentPage).toBe(6);
    expect(windowStore.getState().windows).toBe(windows);
  });

  it.each(['read', 'reference', 'double-click', 'reorder', 'remove-other'])('retains a live held draft through another card action: %s', async action => {
    await heldStore.getState().holdPage(12);
    if (action === 'remove-other') windowStore.getState().openInNewWindow(12);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '编辑第 8 页名称和备注' }));
    fireEvent.change(screen.getByRole('textbox', { name: '备注' }), { target: { value: '查阅其他夹页时保留的草稿' } });
    if (action === 'read') fireEvent.click(screen.getByRole('button', { name: '阅读第 12 页' }), { detail: 0 });
    if (action === 'reference') fireEvent.click(screen.getByRole('button', { name: '打开第 12 页参考窗口' }));
    if (action === 'double-click') {
      const other = screen.getByRole('button', { name: '阅读第 12 页' }); fireEvent.click(other, { detail: 1 });
      await act(async () => vi.advanceTimersByTime(221)); fireEvent.doubleClick(other, { detail: 2 });
    }
    if (action === 'reorder') fireEvent.click(screen.getByRole('button', { name: '上移第 12 页夹页' }));
    if (action === 'remove-other') {
      const inertRead = screen.getByRole('button', { name: '阅读第 8 页', hidden: true });
      const focus = vi.spyOn(inertRead, 'focus');
      fireEvent.click(screen.getByRole('button', { name: '移除第 12 页夹页' }));
      fireEvent.click(screen.getByRole('button', { name: '保留窗口' }));
      await act(async () => vi.advanceTimersByTime(20));
      expect(screen.getByRole('textbox', { name: '名称' })).toHaveFocus(); expect(focus).not.toHaveBeenCalled();
    }
    expect(screen.getByRole('textbox', { name: '备注' })).toHaveValue('查阅其他夹页时保留的草稿');
    const scene = windowStore.getState().windows;
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(heldStore.getState().pages.find(page => page.pageNumber === 8)?.note).toBe('查阅其他夹页时保留的草稿');
    expect(windowStore.getState().windows).toBe(scene);
  });

});
