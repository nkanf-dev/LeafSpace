import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { bookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import { windowStore } from '../../stores/windowStore';
import { workspaceStore, configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies } from '../../stores/workspaceStore';
import { PersistenceService } from '../../services/PersistenceService';

vi.mock('../../components/workspace/WorkspaceCanvas', () => ({ WorkspaceCanvas: () => <div role="region" aria-label="主阅读区" tabIndex={0} /> }));
vi.mock('../../components/timeline/TimelineBar', () => ({ TimelineBar: () => null }));
vi.mock('../../components/thumbnails/CachedThumbnail', () => ({ CachedThumbnail: () => null }));
vi.mock('../../hooks/useWorkspaceAutoSave', () => ({ useWorkspaceAutoSave: vi.fn() }));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(), ensureThumbnail: vi.fn().mockResolvedValue(undefined), ensureThumbnails: vi.fn().mockResolvedValue(undefined), getThumbnailKey: (page: number) => `test_${page}` } }));

describe('Quick Flip thumbnail actions', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset(); workspaceStore.getState().reset(); quickFlipStore.getState().reset();
    const persistence = new PersistenceService(); vi.spyOn(persistence, 'listRecentBooks').mockResolvedValue([]);
    configureWorkspaceStoreDependencies({ persistenceService: persistence });
    bookStore.getState().setDocumentReady({ documentId: 'actions', documentUrl: 'blob:actions', totalPages: 20, initialPage: 3, scale: 1.5 });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetWorkspaceStoreDependencies(); });
  function pointer(target: Element | Window, type: string, overrides = {}) {
    fireEvent(target, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: 20, clientY: 20 }, overrides));
  }
  async function openActions(page = 4) {
    const opener = screen.getByRole('button', { name: `选择第 ${page} 页` });
    pointer(opener, 'pointerdown'); await act(async () => vi.advanceTimersByTime(500));
    pointer(window, 'pointerup');
    expect(screen.getByRole('dialog', { name: `第 ${page} 页操作` })).toBeInTheDocument();
    return opener;
  }
  const actionButton = (name: string) => within(screen.getByRole('dialog', { name: '第 4 页操作' })).getByRole('button', { name });
  function openQuickFlip() { render(<App />); fireEvent.click(screen.getByRole('button', { name: /速翻/ })); }
  it('keeps selected and pressed pages distinct, traps Tab, and dismisses only the first layer', async () => {
    openQuickFlip(); const opener = await openActions();
    const cancel = screen.getByRole('button', { name: '取消' });
    fireEvent.keyDown(cancel, { key: 'Tab' }); expect(actionButton('阅读此页')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true }); expect(cancel).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowRight' }); fireEvent.keyDown(window, { key: ' ' }); fireEvent.keyDown(window, { key: 'n' });
    await act(async () => vi.advanceTimersByTime(600));
    expect(windowStore.getState().windows).toHaveLength(1); expect(bookStore.getState().currentPage).toBe(3);
    fireEvent.keyDown(window, { key: 'Escape' }); await act(async () => vi.advanceTimersByTime(20));
    expect(screen.getByRole('dialog', { name: '速翻视图' })).toBeInTheDocument(); expect(opener).toHaveFocus();
    expect(screen.getByRole('button', { name: '选择第 3 页' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('holds and unholds the pressed page without changing selection or closing Quick Flip', async () => {
    openQuickFlip(); const opener = await openActions();
    fireEvent.click(actionButton('夹住此页')); await act(async () => vi.advanceTimersByTime(40));
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([4]); expect(opener).toHaveFocus();
    expect(screen.getByRole('button', { name: '选择第 3 页' })).toHaveAttribute('aria-pressed', 'true');
    await openActions(); fireEvent.click(actionButton('取消夹页')); await act(async () => vi.advanceTimersByTime(40));
    expect(heldStore.getState().pages).toHaveLength(0); expect(bookStore.getState().currentPage).toBe(3);
    expect(screen.getByRole('dialog', { name: '速翻视图' })).toBeInTheDocument();
  });
  it.each(['阅读此页', '打开参考窗'])('delegates %s for the pressed rather than selected page', async action => {
    openQuickFlip(); await openActions(); fireEvent.click(actionButton(action));
    await act(async () => vi.advanceTimersByTime(40));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bookStore.getState().currentPage).toBe(action === '阅读此页' ? 4 : 3);
    expect(windowStore.getState().windows.map(window => window.pageNumber)).toEqual(action === '阅读此页' ? [4] : [3, 4]);
  });
  it('leaves the existing held-page capacity notice visible after refusing an action', async () => {
    for (let page = 1; page <= 12; page++) await heldStore.getState().holdPage(page);
    openQuickFlip(); await openActions(13);
    fireEvent.click(within(screen.getByRole('dialog', { name: '第 13 页操作' })).getByRole('button', { name: '夹住此页' }));
    await act(async () => vi.advanceTimersByTime(40));
    expect(heldStore.getState().pages).toHaveLength(12);
    expect(within(screen.getByRole('dialog', { name: '速翻视图' })).getByText(/最多夹住 12 页/)).toBeInTheDocument();
  });
  it('keeps the existing reference-window limit and exposes its notice after closing the sheet', async () => {
    for (let page = 5; page <= 8; page++) windowStore.getState().openInNewWindow(page);
    openQuickFlip(); await openActions(); fireEvent.click(actionButton('打开参考窗'));
    await act(async () => vi.advanceTimersByTime(40));
    expect(windowStore.getState().windows).toHaveLength(5);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/最多.*5.*窗口/)).toBeInTheDocument();
  });
});
