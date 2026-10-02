import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { useWorkspaceAutoSave } from '../../hooks/useWorkspaceAutoSave';
import { PDFService } from '../../services/PDFService';
import { PersistenceService } from '../../services/PersistenceService';
import { configureBookStoreDependencies, resetBookStoreDependencies, useBookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import { windowStore } from '../../stores/windowStore';
import { configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies, workspaceStore } from '../../stores/workspaceStore';

// App tests cover workflow sequencing. Rendering, pointer/keyboard behaviors and
// debounce timing are exercised in the component/hook suites and browser tests.
vi.mock('../../components/workspace/WorkspaceCanvas', () => ({ WorkspaceCanvas: () => <div role="region" aria-label="主阅读区" tabIndex={0}>阅读画布</div> }));
vi.mock('../../components/held-pages/HeldPagesPanel', () => ({ HeldPagesPanel: () => null }));
vi.mock('../../components/quick-flip/QuickFlipOverlay', () => ({ QuickFlipOverlay: () => null }));
vi.mock('../../components/timeline/TimelineBar', () => ({ TimelineBar: () => null }));
vi.mock('../../hooks/useWorkspaceAutoSave', () => ({ useWorkspaceAutoSave: vi.fn() }));
vi.mock('../../services/ThumbnailService', () => ({
  thumbnailService: {
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
  const save = vi.spyOn(persistence, 'saveWorkspace').mockResolvedValue(undefined);
  const restore = vi.spyOn(persistence, 'loadWorkspace').mockResolvedValue(null);
  const register = vi.spyOn(persistence, 'saveBookAsset').mockResolvedValue(undefined);
  vi.spyOn(persistence, 'listRecentBooks').mockResolvedValue([]);
  configureWorkspaceStoreDependencies({ persistenceService: persistence });
  return { load, save, restore, register };
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

  it('flushes the current reading position before starting a replacement import', async () => {
    const { load, save } = setupDependencies();
    let finishSave!: () => void;
    save.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
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
    save.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    openExistingBook();
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '回到书库' })));
    expect(useBookStore.getState().documentId).toBe('old-book');
    await act(async () => finishSave());
    expect(useBookStore.getState().documentId).toBeNull();
    expect(screen.getByRole('heading', { name: '页境阅读' })).toBeInTheDocument();
    expect(heldStore.getState().pages).toEqual([]);
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
