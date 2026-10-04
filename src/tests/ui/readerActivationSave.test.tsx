import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { PersistenceService } from '../../services/PersistenceService';
import { bookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import { configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies, workspaceStore, hasUnsavedWorkspace } from '../../stores/workspaceStore';
import type { WorkspaceSnapshot } from '../../types/domain';

// Keep App, reader input/focus, Quick Flip, stores and autosave real. These are
// event/persistence-call contracts, not native PDF-render performance measurements.
vi.mock('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: ({ children }: ComponentProps<'div'>) => <div>{children}</div>,
  Page: ({ pageNumber }: { pageNumber: number }) => <div>PDF page {pageNumber}</div>,
}));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: {
  activateDocument: vi.fn(), releaseDocument: vi.fn(), ensureThumbnail: vi.fn().mockResolvedValue(undefined),
  ensureThumbnails: vi.fn().mockResolvedValue(undefined), getThumbnailKey: () => 'fixture',
} }));
let hidden = false;
async function tick(milliseconds: number) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }
function press(key: string, target: Window | HTMLElement = window) { fireEvent.keyDown(target, { key }); fireEvent.keyUp(target, { key }); }
function mouseClick(region: HTMLElement) {
  fireEvent.pointerDown(region, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseDown(region, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(region, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseUp(region, { button: 0 }); fireEvent.click(region);
}
async function setup(panes = 1, active: 'main' | 'reference' = 'main') {
  const written: WorkspaceSnapshot[] = [];
  const service = new PersistenceService();
  const save = vi.spyOn(service, 'saveWorkspace').mockImplementation(async snapshot => { written.push(structuredClone(snapshot)); return snapshot; });
  vi.spyOn(service, 'loadWorkspace').mockResolvedValue(null);
  vi.spyOn(service, 'listRecentBooks').mockResolvedValue([]);
  configureWorkspaceStoreDependencies({ persistenceService: service });
  bookStore.getState().setDocumentReady({ documentId: 'fixture', documentUrl: 'memory://fixture', totalPages: 20, initialPage: 8 });
  await workspaceStore.getState().restoreWorkspace('fixture');
  const references: string[] = [];
  for (let index = 1; index < panes; index++) references.push(windowStore.getState().openInNewWindow(11 + index));
  windowStore.getState().setActiveWindow(active === 'main' ? 'main' : references[0]);
  render(<App />); await tick(500);
  return { written, save, references };
}
describe('reader activation persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers(); hidden = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset();
    workspaceStore.getState().reset(); quickFlipStore.getState().reset();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); resetWorkspaceStoreDependencies(); });

  it.each([1, 5])('keeps %i panes unchanged through repeated motionless reader clicks', async panes => {
    const { written, save } = await setup(panes);
    const before = windowStore.getState();
    const notify = vi.fn(); const unsubscribe = windowStore.subscribe(notify);
    try {
      const region = screen.getByRole('region', { name: '主阅读区' });
      for (let index = 0; index < 10; index++) { mouseClick(region); await tick(600); }
      expect(region).toHaveFocus(); expect(windowStore.getState()).toBe(before);
      expect(notify).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledTimes(1);
      expect(written).toHaveLength(1); expect(hasUnsavedWorkspace()).toBe(false);
      await act(async () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      await tick(500); expect(save).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });

  it('does not write for region and toolbar focus traversal or a stationary touch contact', async () => {
    const { save } = await setup(); const before = windowStore.getState().windows;
    const region = screen.getByRole('region', { name: '主阅读区' });
    act(() => region.focus()); await tick(500);
    act(() => screen.getByRole('button', { name: '选择文字' }).focus()); await tick(500);
    act(() => screen.getByRole('button', { name: '拖动页面' }).focus()); await tick(500);
    Object.defineProperties(region, { clientWidth: { configurable: true, value: 500 }, clientHeight: { configurable: true, value: 600 } });
    const touch = { identifier: 1, clientX: 100, clientY: 100, target: region };
    fireEvent.pointerDown(region, { pointerType: 'touch' });
    fireEvent.touchStart(region, { touches: [touch], changedTouches: [touch] });
    fireEvent.touchEnd(region, { touches: [], changedTouches: [touch] }); await tick(500);
    expect(save).toHaveBeenCalledTimes(1); expect(windowStore.getState().windows).toBe(before);
  });

  it('does not postpone a real page save while no-op input continues', async () => {
    const { written } = await setup(); const region = screen.getByRole('region', { name: '主阅读区' });
    act(() => bookStore.getState().setCurrentPage(9));
    for (let index = 0; index < 10; index++) { await tick(100); mouseClick(region); }
    expect(written.map(snapshot => snapshot.currentPage)).toEqual([8, 9]);
    await tick(1_000); expect(written).toHaveLength(2);
  });

  it('does not create a hidden save or an extra write after explicit failed-save recovery from pure focus', async () => {
    const { written, save } = await setup();
    save.mockRejectedValueOnce(new Error('Synthetic activation save failure'));
    act(() => bookStore.getState().setCurrentPage(9)); await tick(500);
    expect(workspaceStore.getState().status).toBe('error');
    mouseClick(screen.getByRole('region', { name: '主阅读区' }));
    await act(async () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => { await workspaceStore.getState().saveWorkspace('fixture'); });
    await tick(2_000); expect(save).toHaveBeenCalledTimes(3);
    expect(written.map(snapshot => snapshot.currentPage)).toEqual([8, 9]);
  });

  it('still persists a genuine reference activation', async () => {
    const { written, references } = await setup(2);
    const region = screen.getByRole('region', { name: '参考阅读区，第 12 页' });
    act(() => region.focus()); expect(hasUnsavedWorkspace()).toBe(true); await tick(500);
    expect(written).toHaveLength(2); expect(written[1].activeWindowId).toBe(references[0]);
    expect(written[1].windows.filter(win => win.isActive).map(win => win.id)).toEqual([references[0]]);
  });

  it('restores reference focus after Space and Escape without persisting the cancelled preview', async () => {
    const { written, references } = await setup(2, 'reference');
    const region = screen.getByRole('region', { name: '参考阅读区，第 12 页' });
    act(() => region.focus()); await tick(500); const count = written.length;
    const before = windowStore.getState().windows;
    press(' ', region); expect(screen.getByRole('dialog', { name: '速翻视图' })).toBeInTheDocument();
    press('ArrowRight'); press('Escape'); await tick(32);
    expect(region).toHaveFocus(); expect(windowStore.getState().activeWindowId).toBe(references[0]);
    expect(windowStore.getState().windows).toBe(before); expect(bookStore.getState().currentPage).toBe(8);
    await tick(500); expect(written).toHaveLength(count);
  });

  it('persists Enter navigation in the active reference and restores its focus', async () => {
    const { written, references } = await setup(2, 'reference');
    const region = screen.getByRole('region', { name: '参考阅读区，第 12 页' });
    act(() => region.focus()); await tick(500); const count = written.length;
    press(' ', region); press('ArrowRight'); press('Enter'); await tick(32);
    expect(screen.getByRole('region', { name: '参考阅读区，第 13 页' })).toHaveFocus();
    expect(bookStore.getState().currentPage).toBe(8); await tick(500);
    expect(written).toHaveLength(count + 1);
    expect(written.at(-1)?.windows.find(win => win.id === references[0])?.pageNumber).toBe(13);
  });

  it('keeps Escape closing the top reference and saving the newly active main pane', async () => {
    const { written, references } = await setup(3, 'reference');
    const region = screen.getByRole('region', { name: '参考阅读区，第 12 页' });
    act(() => region.focus()); await tick(500); const count = written.length;
    press('Escape', region); await tick(32);
    expect(windowStore.getState().windows.map(win => win.id)).toEqual(['main', references[0]]);
    expect(screen.getByRole('region', { name: '主阅读区' })).toHaveFocus();
    await tick(500); expect(written).toHaveLength(count + 1); expect(written.at(-1)?.activeWindowId).toBe('main');
  });
});
