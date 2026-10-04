import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { useWorkspaceAutoSave } from '../../hooks/useWorkspaceAutoSave';
import { PDFService, PDFPasswordRequiredError } from '../../services/PDFService';
import { thumbnailService } from '../../services/ThumbnailService';
import { PersistenceService } from '../../services/PersistenceService';
import { configureBookStoreDependencies, resetBookStoreDependencies, useBookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import { windowStore } from '../../stores/windowStore';
import { configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies, workspaceStore } from '../../stores/workspaceStore';
import type { ReaderWindow } from '../../types/domain';

// App tests cover workflow sequencing. Rendering, pointer/keyboard behaviors and
// debounce timing are exercised in the component/hook suites and browser tests.
vi.mock('../../components/workspace/WorkspaceCanvas', () => ({ WorkspaceCanvas: ({ windows, onWindowClose }: { windows: ReaderWindow[]; onWindowClose: (id: string) => void }) => <>
  <div data-window-id="main"><div role="region" aria-label="主阅读区" tabIndex={0}>阅读画布</div></div>
  {windows.filter(window => window.canClose).map(window => <div key={window.id} data-window-id={window.id}>
    <button onClick={() => onWindowClose(window.id)}>关闭参考 {window.pageNumber}</button>
    <div role="region" aria-label={`参考阅读区，第 ${window.pageNumber} 页`} tabIndex={0} />
  </div>)}
</> }));
vi.mock('../../components/held-pages/HeldPagesPanel', () => ({ HeldPagesPanel: () => null }));
vi.mock('../../components/quick-flip/QuickFlipOverlay', () => ({ QuickFlipOverlay: () => null }));
vi.mock('../../components/timeline/TimelineBar', () => ({ TimelineBar: () => null }));
vi.mock('../../hooks/useWorkspaceAutoSave', () => ({ useWorkspaceAutoSave: vi.fn() }));
vi.mock('../../services/ThumbnailService', () => ({
  thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(),
    ensureThumbnail: vi.fn().mockResolvedValue(undefined),
    getThumbnailKey: (page: number) => `test_${page}_240`,
  },
}));

function setupDependencies() {
  const pdf = new PDFService();
  const load = vi.spyOn(pdf, 'loadDocument').mockResolvedValue({ numPages: 20 });
  vi.spyOn(pdf, 'getDocumentFingerprint').mockReturnValue('new-book');
  configureBookStoreDependencies({ pdfService: pdf });
  const persistence = new PersistenceService();
  const save = vi.spyOn(persistence, 'saveWorkspace').mockImplementation(async snapshot => snapshot);
  const restore = vi.spyOn(persistence, 'loadWorkspace').mockResolvedValue(null);
  const register = vi.spyOn(persistence, 'saveBookAsset').mockResolvedValue(undefined);
  const recent = vi.spyOn(persistence, 'listRecentBooks').mockResolvedValue([]);
  configureWorkspaceStoreDependencies({ persistenceService: persistence });
  return { load, save, restore, register, recent };
}
function selectFile(file = new File(['%PDF-'], 'New book.pdf', { type: 'application/pdf' })) {
  fireEvent.change(screen.getByLabelText('选择 PDF 文件'), { target: { files: [file] } });
  return file;
}
function openExistingBook() {
  useBookStore.getState().setDocumentReady({
    documentId: 'old-book', documentUrl: 'blob:old-book', documentName: 'Existing book.pdf',
    totalPages: 30, initialPage: 8, scale: 1.5,
  });
}

function beforeUnloadIsBlocked() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('App document workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookStore.getState().reset();
    heldStore.getState().reset();
    windowStore.getState().reset();
    quickFlipStore.getState().reset();
    workspaceStore.getState().reset();
    resetBookStoreDependencies();
    resetWorkspaceStoreDependencies();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetBookStoreDependencies();
    resetWorkspaceStoreDependencies();
  });

  it('constrains the library grid without shortening a long recent filename', async () => {
    const { recent } = setupDependencies();
    const fileName = `SyntheticLibraryLayout测试文档${'样例章节LongUnbrokenIdentifier0123456789'.repeat(12)}.pdf`;
    recent.mockResolvedValue([{ documentId: 'synthetic-long-title', fileName, fileSize: 1024,
      totalPages: 12, lastOpenedAt: '2026-01-01T00:00:00.000Z' }]);
    render(<App />);

    const title = await screen.findByText(fileName);
    expect(title).toHaveClass('truncate');
    expect(title.closest('button')).toHaveAccessibleName(new RegExp(`^${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    // JSDOM guards the sizing contract; responsive browser tests measure pixels.
    const intro = screen.getByRole('heading', { name: '页境阅读' }).parentElement!;
    const recentPanel = screen.getByRole('heading', { name: '最近打开' }).parentElement!.parentElement!;
    expect(intro.parentElement).toHaveClass('grid-cols-1', 'md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]');
    expect(recentPanel).toHaveClass('min-w-0');
    expect(recentPanel).toContainElement(title);
    expect(recent).toHaveBeenCalledTimes(1);
  });

  it('restores full header-button contrast immediately when a control becomes enabled', async () => {
    setupDependencies(); openExistingBook(); render(<App />);
    for (const name of ['导入书籍', '保存现场']) {
      const button = await screen.findByRole('button', { name });
      expect(button).toHaveClass('transition-colors');
      for (const unsafe of ['transition', 'transition-opacity', 'transition-all']) expect(button).not.toHaveClass(unsafe);
    }
  });

  it('provides a live autosave getter that blocks an idle registration until import finishes', async () => {
    const { register } = setupDependencies();
    let finish!: () => void;
    register.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<App />);
    const readCurrent = vi.mocked(useWorkspaceAutoSave).mock.lastCall![0].readCurrent;
    await act(async () => { selectFile(); });
    try {
      expect(useBookStore.getState()).toMatchObject({ documentId: 'new-book', status: 'ready' });
      expect(workspaceStore.getState().status).toBe('idle');
      expect(readCurrent()).toMatchObject({ documentId: 'new-book', enabled: false });
    } finally { await act(async () => finish()); }
    expect(readCurrent()).toMatchObject({ documentId: 'new-book', enabled: true });
    act(() => useBookStore.getState().setCurrentPage(9));
    expect(readCurrent()).toMatchObject({ currentPage: 9, sessionId: useBookStore.getState().sessionId });
  });

  it('keeps the live autosave restore barrier after alert dismissal and even after clearing its error', async () => {
    const { restore } = setupDependencies(); openExistingBook();
    restore.mockRejectedValueOnce(new Error('Unread saved workspace'));
    await workspaceStore.getState().restoreWorkspace('old-book');
    render(<App />);
    const readCurrent = vi.mocked(useWorkspaceAutoSave).mock.lastCall![0].readCurrent;
    expect(readCurrent().enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(readCurrent().enabled).toBe(false);
    act(() => workspaceStore.getState().clearError());
    expect(workspaceStore.getState().status).toBe('idle');
    expect(readCurrent().enabled).toBe(false);
    await act(async () => { await workspaceStore.getState().restoreWorkspace('old-book'); });
    expect(readCurrent().enabled).toBe(true);
  });

  it('keeps a direct, non-destructive route back to dismissed restore guidance', async () => {
    const { restore, save } = setupDependencies(); openExistingBook();
    restore.mockRejectedValueOnce(new Error('Unread saved workspace'));
    await workspaceStore.getState().restoreWorkspace('old-book');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    const details = screen.getByRole('button', { name: /查看.*问题/ });
    expect(details).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(details);
    expect(screen.getByRole('alert')).toHaveTextContent('Unread saved workspace');
    expect(screen.getByRole('button', { name: '重试恢复' })).toBeEnabled();
    expect(restore).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled();
    expect(workspaceStore.getState().unrestoredDocumentId).toBe('old-book');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试恢复' })));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看.*问题/ })).not.toBeInTheDocument();
    expect(workspaceStore.getState().unrestoredDocumentId).toBeNull();
  });

  it('resurfaces a repeated blocked library transition after its identical guidance was dismissed', async () => {
    const { restore, save } = setupDependencies(); openExistingBook();
    restore.mockRejectedValueOnce(new Error('Unread saved workspace'));
    await workspaceStore.getState().restoreWorkspace('old-book');
    render(<App />);
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
      expect(screen.getByRole('alert')).toHaveTextContent('上次阅读现场尚未恢复');
      expect(screen.getByRole('button', { name: '重试恢复' })).toBeEnabled();
    }
    expect(save).not.toHaveBeenCalled();
    expect(useBookStore.getState().documentId).toBe('old-book');
  });

  it('names restoration rather than saving when an unread snapshot blocks importing', async () => {
    const { restore, save, load } = setupDependencies(); openExistingBook();
    restore.mockRejectedValueOnce(new Error('Unread saved workspace'));
    await workspaceStore.getState().restoreWorkspace('old-book'); render(<App />);
    await act(async () => { selectFile(); });
    expect(screen.getByRole('alert')).toHaveTextContent('请先重试恢复');
    expect(screen.getByRole('alert')).not.toHaveTextContent('请重试保存');
    expect(save).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });

  it.each(['restore', 'save', 'register', 'recent', 'open'] as const)(
    'keeps %s guidance reachable without starting a recovery operation', async operation => {
      const { save, restore, register, load, recent } = setupDependencies();
      if (operation !== 'recent' && operation !== 'open') openExistingBook();
      await act(async () => { render(<App />); });
      const recentCalls = recent.mock.calls.length;
      act(() => workspaceStore.setState({ error: 'Synthetic operation problem', errorOperation: operation, status: 'error' }));
      const details = screen.getByRole('button', { name: '查看问题' });
      expect(details).toHaveAttribute('aria-expanded', 'true');
      expect(details).toHaveAttribute('aria-controls', 'workspace-problem-guidance');
      fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
      expect(details).toHaveFocus(); expect(details).toHaveAttribute('aria-expanded', 'false');
      expect(details).not.toHaveAttribute('aria-controls');
      fireEvent.click(details);
      expect(screen.getByRole('alert', { name: '问题详情' })).toHaveFocus();
      for (const call of [save, restore, register, load]) expect(call).not.toHaveBeenCalled();
      expect(workspaceStore.getState().errorOperation).toBe(operation);
      expect(recent).toHaveBeenCalledTimes(recentCalls);
    },
  );

  it('reopens a workflow error while storage is idle and does not steal focus for a new background error', async () => {
    setupDependencies(); openExistingBook(); await act(async () => { render(<App />); });
    selectFile(new File(['plain'], 'Notes.txt', { type: 'text/plain' }));
    expect(workspaceStore.getState().status).toBe('idle');
    const details = screen.getByRole('button', { name: '查看问题' });
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' })); fireEvent.click(details);
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('请选择 PDF 文件');
    fireEvent.keyDown(screen.getByRole('alert'), { key: ' ' });
    expect(quickFlipStore.getState().isOpen).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    const reader = screen.getByRole('region', { name: '主阅读区' }); reader.focus();
    act(() => useBookStore.setState({ error: 'New parse failure' }));
    // The workflow message remains authoritative, and ordinary state changes never request focus.
    expect(reader).toHaveFocus();
  });

  it('reveals a new error after dismissal without taking the reader focus', async () => {
    setupDependencies(); openExistingBook(); await act(async () => { render(<App />); });
    act(() => workspaceStore.setState({ error: 'First failure', errorOperation: 'save', status: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    const reader = screen.getByRole('region', { name: '主阅读区' }); reader.focus();
    act(() => workspaceStore.setState({ error: 'Another failure' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Another failure');
    expect(reader).toHaveFocus();
  });

  it('does not let a pending reveal override newer focus or enter an inert surface', async () => {
    setupDependencies(); openExistingBook();
    workspaceStore.setState({ error: 'Synthetic failure', errorOperation: 'save', status: 'error' });
    await act(async () => { render(<App />); });
    const details = screen.getByRole('button', { name: '查看问题' });
    const reader = screen.getByRole('region', { name: '主阅读区' });
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    act(() => { details.click(); reader.focus(); });
    expect(reader).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    act(() => { details.click(); quickFlipStore.getState().open(8); });
    expect(screen.getByRole('alert', { hidden: true })).not.toHaveFocus();
  });

  it('returns a removed problem action to the status only when its reveal still owns focus', async () => {
    setupDependencies(); openExistingBook();
    workspaceStore.setState({ error: 'Synthetic failure', errorOperation: 'save', status: 'error' });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    const details = screen.getByRole('button', { name: '查看问题' });
    act(() => { details.click(); workspaceStore.getState().clearError(); });
    expect(screen.getByRole('status')).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the visible import action when a revealed library problem disappears without status text', async () => {
    setupDependencies(); await act(async () => { render(<App />); });
    act(() => workspaceStore.setState({ error: 'Recent list unavailable', errorOperation: 'recent', status: 'error' }));
    expect(screen.getByRole('status')).toHaveTextContent('操作遇到问题');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    const details = screen.getByRole('button', { name: '查看问题' });
    act(() => { details.click(); workspaceStore.getState().clearError(); });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: '导入书籍' })).toHaveFocus();
  });

  it('keeps a PDF loading error reachable even when there is no workspace error', async () => {
    setupDependencies(); await act(async () => { render(<App />); });
    act(() => useBookStore.setState({ error: 'Synthetic PDF loading failure', status: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    fireEvent.click(screen.getByRole('button', { name: '查看问题' }));
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByRole('button', { name: '重新导入' })).toBeEnabled();
    expect(workspaceStore.getState().error).toBeNull();
  });

  it('warns immediately about unsaved reading changes and stops after they are saved', async () => {
    setupDependencies(); openExistingBook();
    await workspaceStore.getState().restoreWorkspace('old-book');
    await workspaceStore.getState().saveWorkspace('old-book');
    render(<App />);
    expect(beforeUnloadIsBlocked()).toBe(false);
    act(() => useBookStore.getState().setCurrentPage(9));
    expect(beforeUnloadIsBlocked()).toBe(true);
    await act(async () => { await workspaceStore.getState().saveWorkspace('old-book'); });
    expect(beforeUnloadIsBlocked()).toBe(false);
  });

  it('retains the exit warning when a failed PDF alert is dismissed without retrying storage', async () => {
    const { register, save } = setupDependencies();
    register.mockRejectedValue(new DOMException('Synthetic quota', 'QuotaExceededError'));
    openExistingBook();
    await workspaceStore.getState().registerCurrentBook(new File(['%PDF'], 'Unsaved.pdf', { type: 'application/pdf' }));
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(beforeUnloadIsBlocked()).toBe(true);
    expect(register).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it('warns while an asynchronous save is unconfirmed without starting another write', async () => {
    const { save } = setupDependencies(); openExistingBook();
    await workspaceStore.getState().restoreWorkspace('old-book');
    let finish!: () => void;
    save.mockImplementationOnce(snapshot => new Promise<void>(resolve => { finish = resolve; }).then(() => snapshot));
    render(<App />);
    let pending!: Promise<void>;
    await act(async () => { pending = workspaceStore.getState().saveWorkspace('old-book'); });
    try {
      expect(beforeUnloadIsBlocked()).toBe(true);
      expect(save).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { finish(); await pending; });
    }
    expect(beforeUnloadIsBlocked()).toBe(false);
  });

  it('does not warn for untouched failed restoration but preserves later edits across failed retries', async () => {
    const { restore } = setupDependencies();
    restore.mockRejectedValueOnce(new Error('Unread snapshot')).mockRejectedValueOnce(new Error('Still unread'));
    render(<App />);
    await act(async () => { selectFile(); });
    expect(workspaceStore.getState().errorOperation).toBe('restore');
    expect(beforeUnloadIsBlocked()).toBe(false);
    act(() => useBookStore.getState().setCurrentPage(3));
    expect(beforeUnloadIsBlocked()).toBe(true);
    await act(async () => { await workspaceStore.getState().restoreWorkspace('new-book'); });
    expect(beforeUnloadIsBlocked()).toBe(true);
    restore.mockResolvedValueOnce({ documentId: 'new-book', currentPage: 5, scale: 1, activeWindowId: 'main',
      layoutPreset: 'single', heldPages: [], windows: windowStore.getState().windows, savedAt: '2026-01-01T00:00:00.000Z' });
    await act(async () => { await workspaceStore.getState().restoreWorkspace('new-book'); });
    expect(useBookStore.getState().currentPage).toBe(5);
    expect(beforeUnloadIsBlocked()).toBe(false);
  });

  it('does not treat a successful empty restore retry as confirmation that new reading changes are saved', async () => {
    const { restore } = setupDependencies();
    restore.mockRejectedValueOnce(new Error('Unread snapshot')).mockResolvedValueOnce(null);
    render(<App />);
    await act(async () => { selectFile(); });
    expect(beforeUnloadIsBlocked()).toBe(false);
    act(() => useBookStore.getState().setCurrentPage(9));
    await act(async () => { await workspaceStore.getState().restoreWorkspace('new-book'); });
    expect(useBookStore.getState().currentPage).toBe(9);
    expect(beforeUnloadIsBlocked()).toBe(true);
    await act(async () => { await workspaceStore.getState().saveWorkspace('new-book'); });
    expect(beforeUnloadIsBlocked()).toBe(false);
  });

  it('establishes the first exit baseline after cleanup of a partially applied restore failure', async () => {
    const { restore } = setupDependencies();
    restore.mockResolvedValueOnce({ documentId: 'new-book', currentPage: 5, scale: 1.5, activeWindowId: 'main',
      layoutPreset: 'single', heldPages: [null] as unknown as ReturnType<typeof heldStore.getState>['pages'], windows: [], savedAt: '2026-01-01T00:00:00.000Z' });
    render(<App />);
    await act(async () => { selectFile(); });
    expect(workspaceStore.getState().errorOperation).toBe('restore');
    expect(useBookStore.getState().currentPage).toBe(5);
    expect(beforeUnloadIsBlocked()).toBe(false);
    act(() => useBookStore.getState().setCurrentPage(6));
    expect(beforeUnloadIsBlocked()).toBe(true);
  });

  it('rejects an unsupported file before changing the current reader', async () => {
    const { load, save } = setupDependencies();
    openExistingBook();
    render(<App />);
    await act(async () => { selectFile(new File(['text'], 'notes.txt', { type: 'text/plain' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('请选择 PDF 文件');
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(useBookStore.getState().documentId).toBe('old-book');
  });

  it('imports a local PDF, restores its workspace, and registers its local copy', async () => {
    const { load, restore, register } = setupDependencies();
    render(<App />);
    const file = new File(['%PDF-'], 'Research.pdf', { type: 'application/pdf' });
    await act(async () => { selectFile(file); });
    await waitFor(() => expect(useBookStore.getState().documentId).toBe('new-book'));
    expect(load).toHaveBeenCalledExactlyOnceWith(file);
    expect(restore).toHaveBeenCalledExactlyOnceWith('new-book');
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'new-book', file, fileName: 'Research.pdf' }));
    expect(screen.getByText('阅读画布')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存现场' })).toBeEnabled();
  });

  it('explains password-required imports and recovers the import control for a usable copy', async () => {
    const { load, register } = setupDependencies();
    load.mockRejectedValueOnce(new PDFPasswordRequiredError()).mockRejectedValueOnce(new PDFPasswordRequiredError());
    render(<App />);
    const locked = new File(['synthetic encrypted fixture'], 'Protected.pdf', { type: 'application/pdf' });
    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () => { selectFile(locked); });
      expect(screen.getByRole('alert')).toHaveTextContent('这份 PDF 需要打开密码，页境暂不支持');
      expect(screen.getByRole('alert')).toHaveTextContent('本机另存一份无需打开密码');
      expect(screen.getByRole('button', { name: '导入书籍' })).toBeEnabled();
      expect(screen.getByLabelText('选择 PDF 文件')).toHaveValue('');
      expect(register).not.toHaveBeenCalled();
    }
    await act(async () => { selectFile(); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useBookStore.getState().documentId).toBe('new-book');
    expect(register).toHaveBeenCalledOnce();
  });

  it('keeps generic import failures distinct from password requirements', async () => {
    const { load } = setupDependencies();
    load.mockRejectedValueOnce(new Error('Invalid PDF; private detail'));
    render(<App />);
    await act(async () => { selectFile(); });
    expect(screen.getByRole('alert')).toHaveTextContent('文件是否完整');
    expect(screen.getByRole('alert')).not.toHaveTextContent('需要打开密码');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private detail');
  });

  it('flushes the current reading position before starting a replacement import', async () => {
    const { load, save } = setupDependencies();
    let finishSave!: () => void;
    save.mockImplementationOnce(snapshot => new Promise<void>(resolve => { finishSave = resolve; }).then(() => snapshot));
    openExistingBook();
    await heldStore.getState().holdPage(8);
    render(<App />);
    await act(async () => { selectFile(); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ documentId: 'old-book', currentPage: 8, scale: 1.5 });
    expect(save.mock.calls[0][0].heldPages.map(page => page.pageNumber)).toEqual([8]);
    expect(load).not.toHaveBeenCalled();
    expect(useBookStore.getState().documentId).toBe('old-book');
    expect(screen.getByRole('button', { name: '导入书籍' })).toBeDisabled();
    await act(async () => finishSave());
    await waitFor(() => expect(useBookStore.getState().documentId).toBe('new-book'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the old book on a failed flush and allows save retry then import', async () => {
    const { load, save } = setupDependencies();
    save.mockRejectedValueOnce(new Error('Quota exceeded'));
    openExistingBook();
    render(<App />);
    await act(async () => { selectFile(); });
    expect(screen.getByRole('alert')).toHaveTextContent('已暂停切换书籍');
    expect(useBookStore.getState()).toMatchObject({ documentId: 'old-book', currentPage: 8 });
    expect(load).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试保存' })));
    expect(workspaceStore.getState().error).toBeNull();
    await act(async () => { selectFile(); });
    await waitFor(() => expect(useBookStore.getState().documentId).toBe('new-book'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores repeated import events while the first import is pending', async () => {
    const { load } = setupDependencies();
    let finishLoad!: (metadata: { numPages: number }) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve; }));
    render(<App />);
    await act(async () => {
      selectFile();
      selectFile(new File(['%PDF-'], 'Second.pdf', { type: 'application/pdf' }));
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => finishLoad({ numPages: 20 }));
    expect(useBookStore.getState().documentName).toBe('New book.pdf');
  });

  it('waits for a successful save before returning to the library', async () => {
    const { save } = setupDependencies();
    let finishSave!: () => void;
    save.mockImplementationOnce(snapshot => new Promise<void>(resolve => { finishSave = resolve; }).then(() => snapshot));
    openExistingBook();
    render(<App />);
    vi.mocked(thumbnailService.releaseDocument).mockClear();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(useBookStore.getState().documentId).toBe('old-book');
    expect(thumbnailService.releaseDocument).not.toHaveBeenCalled();
    expect(vi.mocked(useWorkspaceAutoSave).mock.lastCall![0].readCurrent().enabled).toBe(false);
    await act(async () => finishSave());
    expect(useBookStore.getState().documentId).toBeNull();
    expect(thumbnailService.releaseDocument).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: '页境阅读' })).toBeInTheDocument();
    expect(heldStore.getState().pages).toEqual([]);
  });

  it('freezes transition input and flushes a late reading revision before leaving', async () => {
    const { save } = setupDependencies();
    let finishSave!: () => void;
    save.mockImplementationOnce(snapshot => new Promise<void>(resolve => { finishSave = resolve; }).then(() => snapshot));
    openExistingBook();
    const reference = windowStore.getState().openInNewWindow(12);
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(document.querySelector('main')).toHaveAttribute('inert');
    expect(document.querySelector('footer')).toHaveAttribute('inert');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(windowStore.getState().windows.some(window => window.id === reference)).toBe(true);
    // Model a scroll/render event already in flight when the transition began.
    act(() => useBookStore.getState().setCurrentPage(9));
    await act(async () => finishSave());
    expect(save.mock.calls.map(call => call[0].currentPage)).toEqual([8, 9]);
    expect(useBookStore.getState().documentId).toBeNull();
  });

  it('keeps an unsaved PDF open when saving its workspace or returning to the library', async () => {
    const { register, save } = setupDependencies();
    register.mockRejectedValue(new DOMException('PDF storage is full', 'QuotaExceededError'));
    render(<App />);
    await act(async () => { selectFile(); });
    expect(workspaceStore.getState().errorOperation).toBe('register');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存现场' })));
    expect(workspaceStore.getState().errorOperation).toBe('register');
    expect(screen.queryByText('已保存到本机')).not.toBeInTheDocument();
    vi.mocked(thumbnailService.releaseDocument).mockClear();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(thumbnailService.releaseDocument).not.toHaveBeenCalled();
    expect(useBookStore.getState().documentId).toBe('new-book');
    expect(save).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(3);
  });

  it('retries the original PDF copy before saving the current reading position', async () => {
    const { register, save } = setupDependencies();
    register.mockRejectedValueOnce(new DOMException('PDF storage is full', 'QuotaExceededError'));
    render(<App />);
    const file = new File(['%PDF-'], 'Research.pdf', { type: 'application/pdf' });
    await act(async () => { selectFile(file); });
    act(() => useBookStore.getState().setCurrentPage(9));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试保存' })));
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.lastCall?.[0]).toMatchObject({ documentId: 'new-book', file });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'new-book', currentPage: 9 }), null);
    expect(workspaceStore.getState().error).toBeNull();
    expect(screen.getByText('已保存到本机')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(register).toHaveBeenCalledTimes(2);
    expect(useBookStore.getState().documentId).toBeNull();
  });

  it('does not replace unread saved context while leaving or importing another book', async () => {
    const { restore, save, load } = setupDependencies();
    restore.mockRejectedValueOnce(new Error('Temporary storage read failure'));
    openExistingBook();
    await workspaceStore.getState().restoreWorkspace('old-book');
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(useBookStore.getState().documentId).toBe('old-book');
    expect(save).not.toHaveBeenCalled();
    await act(async () => { selectFile(); });
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重试恢复' })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试恢复' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(save).toHaveBeenCalledTimes(1);
    expect(useBookStore.getState().documentId).toBeNull();
  });

  it('asks before replacing unread saved context and supports cancel then explicit replacement', async () => {
    const { restore, save } = setupDependencies();
    restore.mockRejectedValueOnce(new Error('Temporary storage read failure'));
    openExistingBook();
    await workspaceStore.getState().restoreWorkspace('old-book');
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存现场' })));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: '确认替换上次现场' })).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: '取消覆盖' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '确认替换上次现场' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存现场' })).toHaveFocus();
    expect(save).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存现场' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '覆盖上次现场' })));
    expect(save).toHaveBeenCalledTimes(1);
    expect(workspaceStore.getState().error).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(useBookStore.getState().documentId).toBeNull();
  });

  it('keeps navigation disabled until an approved workspace replacement finishes', async () => {
    const { restore, save } = setupDependencies();
    restore.mockRejectedValueOnce(new Error('Temporary storage read failure'));
    let finishSave!: () => void;
    save.mockImplementationOnce(snapshot => new Promise<void>(resolve => { finishSave = resolve; }).then(() => snapshot));
    openExistingBook();
    await workspaceStore.getState().restoreWorkspace('old-book');
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存现场' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '覆盖上次现场' })));
    expect(screen.getByRole('button', { name: '回到书库' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导入书籍' })).toBeDisabled();
    expect(document.querySelector('main')).toHaveAttribute('inert');
    await act(async () => finishSave());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到书库' })).toBeEnabled();
    expect(workspaceStore.getState()).toMatchObject({ status: 'idle', error: null, unrestoredDocumentId: null });
  });

  it('cancels replacement before closing reference windows even after focus leaves the warning', async () => {
    const { restore } = setupDependencies();
    restore.mockRejectedValueOnce(new Error('Temporary storage read failure'));
    openExistingBook();
    await workspaceStore.getState().restoreWorkspace('old-book');
    const reference = windowStore.getState().openInNewWindow(12);
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存现场' })));
    expect(screen.getByRole('button', { name: '取消覆盖' })).toHaveAccessibleDescription(/替换它/);
    fireEvent.click(screen.getByRole('button', { name: '查看问题' }));
    expect(screen.getByRole('group', { name: '确认替换上次现场' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.getByRole('button', { name: '查看问题' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '确认替换上次现场' })).not.toBeInTheDocument();
    expect(windowStore.getState().windows.some(window => window.id === reference)).toBe(true);
    expect(screen.getByRole('button', { name: '保存现场' })).toHaveFocus();
  });

  it('does not carry a cancelled-by-restoration replacement prompt into another book', async () => {
    const { restore } = setupDependencies();
    restore.mockRejectedValueOnce(new Error('Temporary storage read failure'));
    openExistingBook();
    await workspaceStore.getState().restoreWorkspace('old-book');
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存现场' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试恢复' })));
    expect(screen.queryByRole('group', { name: '确认替换上次现场' })).not.toBeInTheDocument();
    restore.mockRejectedValueOnce(new Error('Another read failure'));
    await act(async () => { selectFile(); });
    expect(workspaceStore.getState().unrestoredDocumentId).toBe('new-book');
    expect(screen.queryByRole('group', { name: '确认替换上次现场' })).not.toBeInTheDocument();
  });

  it('dismisses storage errors without clearing the failure or re-enabling autosave', async () => {
    const { save } = setupDependencies();
    openExistingBook();
    workspaceStore.setState({ status: 'error', error: 'Storage offline', errorOperation: 'restore' });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Storage offline'));
    expect(vi.mocked(useWorkspaceAutoSave).mock.lastCall?.[0].enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(workspaceStore.getState()).toMatchObject({ status: 'error', error: 'Storage offline', errorOperation: 'restore' });
    act(() => useBookStore.getState().setCurrentPage(9));
    expect(vi.mocked(useWorkspaceAutoSave).mock.lastCall?.[0].enabled).toBe(false);
    expect(save).not.toHaveBeenCalled();
    // Dismissal is tied to this message; a different problem must still be visible.
    act(() => workspaceStore.setState({ error: 'Quota exceeded', errorOperation: 'save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Quota exceeded');
  });

  it('closes the highest reference window on Escape and never closes the main reader', async () => {
    setupDependencies();
    openExistingBook();
    const lower = windowStore.getState().openInNewWindow(5);
    const upper = windowStore.getState().openInNewWindow(12);
    windowStore.getState().setActiveWindow(lower);
    render(<App />);
    await act(async () => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(windowStore.getState().windows.map(window => window.id)).toEqual(['main', lower]);
    expect(windowStore.getState().windows.some(window => window.id === upper)).toBe(false);
    await waitFor(() => expect(screen.getByRole('region', { name: '主阅读区' })).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(windowStore.getState().windows).toHaveLength(1);
    expect(windowStore.getState().windows[0]).toMatchObject({ id: 'main', canClose: false });
    expect(useBookStore.getState().documentId).toBe('old-book');
  });

  it('returns focus to the surviving active reader after an explicit reference close', async () => {
    setupDependencies();
    openExistingBook();
    const lower = windowStore.getState().openInNewWindow(5);
    windowStore.getState().openInNewWindow(12);
    windowStore.getState().setActiveWindow(lower);
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '关闭参考 12' })));
    await waitFor(() => expect(screen.getByRole('region', { name: '参考阅读区，第 5 页' })).toHaveFocus());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '关闭参考 5' })));
    await waitFor(() => expect(screen.getByRole('region', { name: '主阅读区' })).toHaveFocus());
  });

  it('dismisses the held-pages overlay before closing a reference window', async () => {
    setupDependencies();
    openExistingBook();
    const reference = windowStore.getState().openInNewWindow(12);
    render(<App />);
    const toggle = screen.getByRole('button', { name: '夹页 0' });
    await act(async () => fireEvent.click(toggle));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(windowStore.getState().windows.some(window => window.id === reference)).toBe(true);
  });

  it('leaves reference windows open while quick flip owns Escape', async () => {
    setupDependencies();
    openExistingBook();
    const reference = windowStore.getState().openInNewWindow(12);
    quickFlipStore.getState().open();
    render(<App />);
    await act(async () => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(windowStore.getState().windows.some(window => window.id === reference)).toBe(true);
    expect(quickFlipStore.getState().isOpen).toBe(true);
  });

});
