import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import App from '../../app/App';
import { useWorkspaceAutoSave } from '../../hooks/useWorkspaceAutoSave';
import { DexieWorkspacePersistencePort, PersistenceService, workspaceVersion } from '../../services/PersistenceService';
import { bookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import { configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies, workspaceStore } from '../../stores/workspaceStore';
import type { ReaderWindow, WorkspaceSnapshot } from '../../types/domain';

vi.mock('../../components/workspace/WorkspaceCanvas', () => ({ WorkspaceCanvas: ({ windows }: { windows: ReaderWindow[] }) => <>
  <div data-window-id="main"><div role="region" aria-label="主阅读区" tabIndex={0}>阅读画布</div></div>
  {windows.filter(window => window.canClose).map(window => <div key={window.id} data-window-id={window.id}>参考 {window.pageNumber}</div>)}
</> }));
vi.mock('../../components/held-pages/HeldPagesPanel', () => ({ HeldPagesPanel: () => null }));
vi.mock('../../components/quick-flip/QuickFlipOverlay', () => ({ QuickFlipOverlay: () => null }));
vi.mock('../../components/timeline/TimelineBar', () => ({ TimelineBar: () => null }));
vi.mock('../../hooks/useWorkspaceAutoSave', () => ({ useWorkspaceAutoSave: vi.fn() }));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(),
  ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: (page: number) => `generated_${page}` } }));

const ports: DexieWorkspacePersistencePort[] = [];
function snapshot(currentPage: number): WorkspaceSnapshot {
  return { documentId: 'fixture', currentPage, scale: 1, activeWindowId: 'main', layoutPreset: 'single', heldPages: [], windows: [], savedAt: '2026-10-04T00:00:00.000Z' };
}
function exitBlocked() {
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
}
async function setup() {
  const name = `leafspace-conflict-ui-${crypto.randomUUID()}`;
  const port = new DexieWorkspacePersistencePort(name), otherPort = new DexieWorkspacePersistencePort(name);
  ports.push(port, otherPort);
  const service = new PersistenceService(port), other = new PersistenceService(otherPort);
  configureWorkspaceStoreDependencies({ persistenceService: service });
  const original = await other.saveWorkspace(snapshot(1));
  bookStore.getState().setDocumentReady({ documentId: 'fixture', documentName: 'Generated.pdf', totalPages: 20 });
  await workspaceStore.getState().restoreWorkspace('fixture');
  const stored = await other.saveWorkspace(snapshot(7), workspaceVersion(original));
  bookStore.getState().setCurrentPage(2);
  await heldStore.getState().holdPage(3);
  const reference = windowStore.getState().openInNewWindow(4);
  await workspaceStore.getState().saveWorkspace('fixture');
  await act(async () => { render(<App />); });
  return { port, other, service, stored, reference };
}
beforeEach(() => {
  vi.clearAllMocks(); bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset();
  quickFlipStore.getState().reset(); workspaceStore.getState().reset();
});
afterEach(async () => {
  vi.restoreAllMocks(); resetWorkspaceStoreDependencies();
  const all = ports.splice(0); all.forEach(port => port.close());
  for (const name of new Set(all.map(port => port.name))) await Dexie.delete(name);
});

describe('explicit cross-tab conflict resolution', () => {
  it('keeps conflict guidance and exit/auto-save barriers through dismissal and ordinary Save', async () => {
    const { stored, other, service } = await setup();
    const write = vi.spyOn(service, 'saveWorkspace');
    expect(screen.getByRole('alert')).toHaveTextContent('另一个标签页');
    expect(screen.queryByRole('button', { name: '重试保存' })).not.toBeInTheDocument();
    expect(vi.mocked(useWorkspaceAutoSave).mock.lastCall![0].readCurrent().enabled).toBe(false);
    expect(exitBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存现场' }));
    expect(screen.getByRole('alert')).toHaveTextContent('另一个标签页');
    expect(write).not.toHaveBeenCalled();
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
    expect(bookStore.getState().currentPage).toBe(2);
    expect(exitBlocked()).toBe(true);
  });

  it.each(['reload', 'overwrite'] as const)('cancels %s without changing either scene or closing a reference', async action => {
    const { stored, other, reference } = await setup();
    const opener = screen.getByRole('button', { name: action === 'reload' ? '载入已存现场' : '用此页覆盖' });
    fireEvent.click(opener);
    expect(screen.getByRole('group', { name: '确认解决现场冲突' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消处理' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '取消处理' }));
    expect(opener).toHaveFocus();
    expect(screen.queryByRole('group', { name: '确认解决现场冲突' })).not.toBeInTheDocument();
    fireEvent.click(opener);
    screen.getByRole('region', { name: '主阅读区' }).focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(opener).toHaveFocus();
    expect(windowStore.getState().windows.some(window => window.id === reference)).toBe(true);
    expect(bookStore.getState().currentPage).toBe(2);
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([3]);
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
  });

  it('blocks library and import transitions until the user resolves the conflict', async () => {
    const { stored, other } = await setup();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(bookStore.getState().documentId).toBe('fixture');
    expect(screen.queryByRole('heading', { name: '页境阅读' })).not.toBeInTheDocument();
    await act(async () => fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File(['%PDF-generated'], 'another.pdf', { type: 'application/pdf' })] },
    }));
    expect(bookStore.getState()).toMatchObject({ documentId: 'fixture', currentPage: 2 });
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
    expect(screen.getByRole('button', { name: '载入已存现场' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '用此页覆盖' })).toBeEnabled();
  });

  it('makes reload destructive only after confirmation and keeps failure recoverable', async () => {
    const { service, stored, other } = await setup();
    const read = vi.spyOn(service, 'loadWorkspace').mockRejectedValueOnce(new Error('Synthetic read blocked'));
    fireEvent.click(screen.getByRole('button', { name: '载入已存现场' }));
    expect(screen.getByRole('group')).toHaveTextContent('此页更改将丢失');
    expect(read).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认载入' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic read blocked');
    expect(bookStore.getState().currentPage).toBe(2);
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([3]);
    expect(exitBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '载入已存现场' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认载入' })));
    expect(bookStore.getState().currentPage).toBe(7);
    expect(heldStore.getState().pages).toEqual([]);
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(exitBlocked()).toBe(false);
  });

  it('rejects a superseded overwrite confirmation and asks for a new explicit decision', async () => {
    const { stored, other } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '用此页覆盖' }));
    expect(screen.getByRole('group')).toHaveTextContent('已存现场将被替换');
    const newer = await other.saveWorkspace(snapshot(9), workspaceVersion(stored));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认覆盖' })));
    expect(await other.loadWorkspace('fixture')).toEqual(newer);
    expect(screen.queryByRole('group', { name: '确认解决现场冲突' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('另一个标签页');
    expect(bookStore.getState().currentPage).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '用此页覆盖' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认覆盖' })));
    expect(await other.loadWorkspace('fixture')).toMatchObject({ currentPage: 2, heldPages: [{ pageNumber: 3 }] });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(exitBlocked()).toBe(false);
  });

  it('refreshes detected page details when another tab saves during reload confirmation without losing live work', async () => {
    const { stored, other } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '载入已存现场' }));
    expect(screen.getByRole('group')).toHaveTextContent('检测到的已存现场：第 7 页');
    const newer = await other.saveWorkspace(snapshot(9), workspaceVersion(stored));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认载入' })));
    expect(bookStore.getState().currentPage).toBe(2);
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([3]);
    expect(await other.loadWorkspace('fixture')).toEqual(newer);
    expect(exitBlocked()).toBe(true);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '载入已存现场' }));
    expect(screen.getByRole('group')).toHaveTextContent('检测到的已存现场：第 9 页');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认载入' })));
    expect(bookStore.getState().currentPage).toBe(9);
    expect(heldStore.getState().pages).toEqual([]);
    expect(exitBlocked()).toBe(false);
  });

  it('deduplicates confirmation clicks while reload is pending and keeps reading inert', async () => {
    const { service, stored } = await setup();
    let finish!: (snapshot: WorkspaceSnapshot) => void;
    const read = vi.spyOn(service, 'loadWorkspace').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '载入已存现场' }));
    const confirm = screen.getByRole('button', { name: '确认载入' });
    await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
    try {
      expect(read).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: '导入书籍' })).toBeDisabled();
      expect(document.querySelector('main')).toHaveAttribute('inert');
      expect(bookStore.getState().currentPage).toBe(2);
    } finally { await act(async () => finish(stored)); }
    expect(bookStore.getState().currentPage).toBe(7);
  });
});
