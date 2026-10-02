import { useEffect, useRef, useCallback, useState } from 'react';
import { BookOpen, BookmarkPlus, Layers, X } from 'lucide-react';
import { WorkspaceCanvas } from '../components/workspace/WorkspaceCanvas';
import { HeldPagesPanel } from '../components/held-pages/HeldPagesPanel';
import { QuickFlipOverlay } from '../components/quick-flip/QuickFlipOverlay';
import { TimelineBar } from '../components/timeline/TimelineBar';
import { useBookStore } from '../stores/bookStore';
import { useHeldStore } from '../stores/heldStore';
import { useWindowStore } from '../stores/windowStore';
import { useQuickFlipStore } from '../stores/quickFlipStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useWorkspaceAutoSave } from '../hooks/useWorkspaceAutoSave';

const solidButton = 'inline-flex min-h-10 items-center justify-center gap-2 border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50';
const outlineButton = 'inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border)] px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50';

function App() {
  const book = useBookStore();
  const { currentPage, totalPages, documentId, documentName, scale, status: bookStatus, loadDocument } = book;
  const { pages: heldPages, holdPage, unholdPage, reset: resetHeldPages } = useHeldStore();
  const { windows, activeWindowId, navigateActive, setLayout, notice: windowNotice, clearNotice: clearWindowNotice, updateWindow, closeWindow, openInNewWindow, setActiveWindow, reset: resetWindows } = useWindowStore();
  const { isOpen: isQuickFlipVisible, close: closeQuickFlip, open: openQuickFlip } = useQuickFlipStore();
  const activePage = windows.find(window => window.id === activeWindowId)?.pageNumber ?? currentPage;
  const heldNotice = useHeldStore(state => state.notice);
  const workspace = useWorkspaceStore();
  const { hydrateRecentBooks, openRecentBook, recentBooks, registerCurrentBook, saveWorkspace, restoreWorkspace, status: workspaceStatus } = workspace;
  const [isHydratingDocument, setIsHydratingDocument] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [showHeldPages, setShowHeldPages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const quickFlipOpener = useRef<HTMLElement | null>(null);
  const quickFlipOrigin = useRef({ windowId: 'main', page: 1 });
  const showQuickFlip = useCallback((page: number) => {
    quickFlipOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    quickFlipOrigin.current = { windowId: useWindowStore.getState().activeWindowId ?? 'main', page };
    openQuickFlip(page);
  }, [openQuickFlip]);
  const dismissQuickFlip = useCallback(() => {
    closeQuickFlip();
    // React removes background inertness during the commit. Restore focus after it,
    // using the opener captured before inert moved focus away from the reader.
    window.requestAnimationFrame(() => {
      const active = useWindowStore.getState().activeWindowId;
      if (active && active !== quickFlipOrigin.current.windowId) document.querySelector<HTMLElement>(`[data-window-id="${active}"] [role="region"]`)?.focus();
      else quickFlipOpener.current?.focus();
    });
  }, [closeQuickFlip]);
  const heldToggleRef = useRef<HTMLButtonElement>(null);
  const heldBackRef = useRef<HTMLButtonElement>(null);
  const closeHeldPanel = () => { setShowHeldPages(false); heldToggleRef.current?.focus(); };
  useEffect(() => {
    if (showHeldPages) heldBackRef.current?.focus();
    const onResize = () => { if (window.innerWidth >= 1024) setShowHeldPages(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showHeldPages]);
  const busy = isHydratingDocument || bookStatus === 'loading' || workspaceStatus === 'restoring';
  const ready = !!documentId && bookStatus === 'ready' && !busy;

  const importFile = useCallback(async (file: File) => {
    if (importLock.current) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setWorkflowError('请选择 PDF 文件。其他格式暂不支持。');
      return;
    }
    importLock.current = true;
    setIsHydratingDocument(true);
    setWorkflowError(null);
    setDismissedError(null);
    try {
      const previousBook = useBookStore.getState();
      if (previousBook.documentId && previousBook.status === 'ready') {
        await saveWorkspace(previousBook.documentId);
        if (useWorkspaceStore.getState().error) {
          setWorkflowError('当前阅读现场未能保存，已暂停切换书籍。请重试保存后再导入，避免丢失刚才的更改。');
          return;
        }
      }
      closeQuickFlip();
      resetHeldPages();
      resetWindows();
      await loadDocument(file);
      const newId = useBookStore.getState().documentId;
      if (newId) await restoreWorkspace(newId);
      await registerCurrentBook(file);
    } catch {
      setWorkflowError('这本 PDF 没有成功打开或保存到本机。请检查文件是否完整、是否受密码保护，再重新导入。');
    } finally {
      importLock.current = false;
      setIsHydratingDocument(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [loadDocument, closeQuickFlip, registerCurrentBook, resetHeldPages, resetWindows, restoreWorkspace, saveWorkspace]);

  useEffect(() => { void hydrateRecentBooks(); }, [hydrateRecentBooks]);

  useWorkspaceAutoSave({ documentId, currentPage, scale, heldPages, windows, activeWindowId,
    enabled: ready && workspaceStatus === 'idle', saveWorkspace });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' && !isQuickFlipVisible) {
        if (showHeldPages) {
          event.preventDefault();
          setShowHeldPages(false);
          heldToggleRef.current?.focus();
          return;
        }
        const topWindow = useWindowStore.getState().windows.filter((win) => win.canClose).sort((left, right) => right.zIndex - left.zIndex)[0];
        if (topWindow) {
          event.preventDefault();
          useWindowStore.getState().closeWindow(topWindow.id);
          document.querySelector<HTMLElement>('[aria-label="主阅读区"]')?.focus();
        }
        return;
      }
      if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key === ' ' && ready) {
        event.preventDefault();
        if (isQuickFlipVisible) dismissQuickFlip();
        else showQuickFlip(activePage);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ready, isQuickFlipVisible, activePage, showQuickFlip, dismissQuickFlip, showHeldPages]);

  const returnToLibrary = async () => {
    if (!ready || importLock.current) return;
    importLock.current = true;
    setIsHydratingDocument(true);
    try {
      if (documentId) await saveWorkspace(documentId);
      if (useWorkspaceStore.getState().error) return;
      closeQuickFlip();
      resetHeldPages();
      resetWindows();
      book.reset();
      setShowHeldPages(false);
    } finally {
      importLock.current = false;
      setIsHydratingDocument(false);
    }
  };

  const jumpToPage = (page: number) => {
    navigateActive(page);
  };
  const error = workflowError || workspace.error || book.error;
  const snapshot = workspace.currentSnapshot;
  const saved = snapshot?.documentId === documentId && snapshot.currentPage === currentPage && snapshot.scale === scale
    && snapshot.activeWindowId === activeWindowId && JSON.stringify(snapshot.heldPages) === JSON.stringify(heldPages)
    && JSON.stringify(snapshot.windows) === JSON.stringify(windows);
  const retryStorage = () => {
    setWorkflowError(null);
    setDismissedError(null);
    if (workspace.errorOperation === 'recent') void hydrateRecentBooks();
    else if (workspace.errorOperation === 'restore' && documentId) void restoreWorkspace(documentId);
    else if (documentId) void saveWorkspace(documentId);
  };

  return (
    <>
      <div inert={isQuickFlipVisible} className="flex h-dvh min-h-0 w-full flex-col bg-[var(--app-bg)] text-[var(--ink)]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="回到书库" disabled={!ready} onClick={() => void returnToLibrary()} className="text-2xl font-extrabold italic tracking-tight text-stone-900 disabled:cursor-default" style={{ fontFamily: 'Georgia, serif' }}>LeafSpace</button>
            <span className="hidden text-xs text-stone-500 sm:inline">页境 · 空间化研读</span>
          </div>
          <div className="order-3 flex w-full min-w-0 items-center justify-between gap-3 text-xs text-stone-500 sm:order-none sm:w-auto sm:flex-1 sm:px-4">
            <span className="truncate">{documentId ? `${documentName || '当前书籍'} · 第 ${currentPage} 页` : '让线性翻页，成为空间化阅读'}</span>
            <span role="status" className="shrink-0">{busy ? '正在打开…' : workspaceStatus === 'saving' ? '正在保存…' : workspaceStatus === 'error' ? '保存或恢复遇到问题' : saved ? '已保存到本机' : ready ? '更改待保存' : ''}</span>
          </div>
          <div className="flex shrink-0 gap-2">
            <input aria-label="选择 PDF 文件" type="file" ref={fileInputRef} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} accept=".pdf,application/pdf" className="hidden" disabled={busy} />
            <button disabled={busy} onClick={() => fileInputRef.current?.click()} className={solidButton}>导入书籍</button>
            {documentId && <button onClick={() => documentId && void saveWorkspace(documentId)} disabled={!ready || workspaceStatus === 'saving'} className={outlineButton}>保存现场</button>}
          </div>
        </header>

        {error && error !== dismissedError && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="min-w-0 flex-1">{workflowError || (workspace.error ? `本机存储遇到问题：${workspace.error}` : '文件加载失败，请检查 PDF 后重新导入。')}</span>
          {workspace.error && workspace.errorOperation !== 'open' && workspace.errorOperation !== 'register' && <button className="underline underline-offset-4" onClick={retryStorage} disabled={busy}>{workspace.errorOperation === 'restore' ? '重试恢复' : workspace.errorOperation === 'recent' ? '重试读取' : '重试保存'}</button>}
          <button className="underline underline-offset-4" onClick={() => fileInputRef.current?.click()} disabled={busy}>重新导入</button>
          <button aria-label="关闭提示" className="p-2" onClick={() => setDismissedError(error)}><X size={18} /></button>
        </div>}

        {documentId && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 sm:px-6">
          <button className={outlineButton} disabled={!ready} onClick={() => showQuickFlip(activePage)}><BookOpen size={16} />速翻<span className="hidden text-xs text-stone-400 sm:inline">Space</span></button>
          <button className={outlineButton} disabled={!ready} onClick={() => void holdPage(activePage)}><BookmarkPlus size={16} />{heldPages.some((page) => page.pageNumber === activePage) ? '已夹住此页' : '夹住此页'}</button>
          <button ref={heldToggleRef} className={`${outlineButton} ml-auto lg:hidden`} aria-expanded={showHeldPages} aria-controls="held-pages-panel" onClick={() => showHeldPages ? closeHeldPanel() : setShowHeldPages(true)}><Layers size={16} />夹页 {heldPages.length}</button>
          <select aria-label="目录" value="" disabled={!ready || !book.toc.length} onChange={event => { if (event.target.value) jumpToPage(Number(event.target.value)); }} className="min-h-10 max-w-44 border border-[var(--border)] bg-transparent px-2 text-sm text-stone-600 disabled:opacity-60">
            <option value="">{book.toc.length ? '目录 · 跳转章节' : '此 PDF 无目录'}</option>
            {book.toc.map(item => <option key={item.id} value={item.page}>{'　'.repeat(Math.min(item.level, 4))}{item.title} · {item.page}</option>)}
          </select>
          {windows.length > 1 && <select aria-label="工作区布局" value={windows.some(win => win.dockMode === 'grid') ? 'grid' : windows.some(win => win.dockMode !== 'none') ? 'split' : 'floating'} onChange={event => setLayout(event.target.value as 'floating' | 'split' | 'grid')} className="hidden min-h-10 border border-[var(--border)] bg-transparent px-2 text-sm text-stone-600 sm:block">
            <option value="floating">浮动窗口</option><option value="split">并排对照</option><option value="grid">平铺全部</option>
          </select>}
          <span className="ml-auto hidden text-xs text-stone-500 xl:block">{activeWindowId === 'main' ? '主视角' : '参考窗口'} · 第 {activePage} 页</span>
        </div>}

        {(windowNotice || heldNotice) && <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950"><span>{windowNotice || heldNotice}</span><button aria-label="关闭操作提示" className="p-2" onClick={() => { clearWindowNotice(); useHeldStore.getState().clearNotice(); }}><X size={16} /></button></div>}
        <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <section inert={showHeldPages} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#edece9]">
            {documentId ? <WorkspaceCanvas windows={windows} onWindowUpdate={(win) => { updateWindow(win.id, win); if (win.isActive) setActiveWindow(win.id); }} onWindowClose={closeWindow} /> : (
              <div className="flex min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] p-4 sm:p-8 lg:items-center lg:justify-center">
                <div className="m-auto grid w-full max-w-[1080px] grid-cols-1 border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_70px_rgba(28,25,23,0.05)] md:grid-cols-[1.15fr_0.85fr]">
                  <div className="px-6 py-9 sm:px-10 sm:py-12 md:border-r md:border-[var(--border)]">
                    <div className="mb-5 text-xs font-semibold tracking-[0.2em] text-stone-500">为深度阅读，留一片空间</div>
                    <h1 className="text-4xl font-extrabold tracking-tight text-stone-900 sm:text-5xl" style={{ fontFamily: 'Georgia, serif' }}>页境阅读</h1>
                    <p className="mt-5 max-w-md text-base leading-7 text-stone-600">翻阅一本书，夹住关键页。将线索并排展开，让思考不必来回翻找。</p>
                    <button disabled={busy} onClick={() => fileInputRef.current?.click()} className={`${solidButton} mt-8 px-7 py-3`}>{busy ? '正在打开 PDF…' : '导入一本 PDF'}</button>
                    <p className="mt-3 text-xs leading-5 text-stone-500">PDF 留在当前浏览器中处理，不会上传。请保留原文件；清理浏览器数据会移除本机阅读现场。</p>
                    <ol className="mt-9 grid gap-4 border-t border-[var(--border)] pt-6 text-sm text-stone-600">
                      <li><strong className="mr-3 text-stone-800">01 阅读</strong>滚动页面，← → 翻页</li>
                      <li><strong className="mr-3 text-stone-800">02 速翻</strong>点击「速翻」或按 Space，快速找页</li>
                      <li><strong className="mr-3 text-stone-800">03 对照</strong>夹住关键页，打开参考窗口并排研读</li>
                    </ol>
                  </div>
                  <div className="border-t border-[var(--border)] bg-[#f6f1e8] px-6 py-8 sm:px-8 md:border-t-0">
                    <div className="mb-6 flex items-baseline justify-between border-b border-[var(--border)] pb-4"><h2 className="text-xl font-semibold text-stone-900">最近打开</h2><span className="text-xs text-stone-500">{recentBooks.length} 本</span></div>
                    <div className="space-y-3">{recentBooks.length ? recentBooks.map((recent) => (
                      <button key={recent.documentId} type="button" disabled={busy} className="flex w-full items-start gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-stone-700 disabled:opacity-50" onClick={() => { setWorkflowError(null); setDismissedError(null); closeQuickFlip(); void openRecentBook(recent.documentId); }}>
                        <BookOpen className="mt-1 shrink-0 text-stone-500" size={20} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-stone-900">{recent.fileName}</span><span className="mt-2 block text-xs text-stone-500">{recent.totalPages} 页 · {(recent.fileSize / 1024 / 1024).toFixed(1)} MB · {new Date(recent.lastOpenedAt).toLocaleDateString('zh-CN')}</span></span>
                      </button>
                    )) : <div className="border border-dashed border-[var(--border)] px-5 py-9 text-center text-sm leading-6 text-stone-500"><BookOpen size={28} className="mx-auto mb-4 text-stone-400" /><p>从第一本书开始</p><p className="mt-2">导入 PDF 后，下次可从这里<br />回到上次的页码和阅读现场。</p></div>}</div>
                    <p className="mt-6 text-xs leading-5 text-stone-500">最近列表展示 3 本书。更早的现场仍会保留，重新导入同一本 PDF 即可恢复。</p>
                  </div>
                </div>
              </div>
            )}
          </section>
          {documentId && <aside id="held-pages-panel" aria-label="夹页列表" className={`${showHeldPages ? 'absolute inset-0 z-30 flex' : 'hidden'} min-h-0 w-full shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] lg:static lg:flex lg:w-[280px]`}>
            <button ref={heldBackRef} className="min-h-11 border-b border-[var(--border)] px-5 text-left text-sm lg:hidden" onClick={closeHeldPanel}>← 返回阅读</button>
            <HeldPagesPanel pages={heldPages} onReorder={useHeldStore.getState().reorderHeldPages} onReadPage={(page) => {
              const active = windows.find((win) => win.id === activeWindowId);
              if (!active || active.type === 'main') useWindowStore.getState().openInMain(page.pageNumber);
              else updateWindow(active.id, { pageNumber: page.pageNumber, title: `第 ${page.pageNumber} 页` });
              closeHeldPanel();
            }} onPageClick={(page) => { openInNewWindow(page.pageNumber); closeHeldPanel(); }} onRemovePage={(id, closeReferences) => { const page = heldPages.find((candidate) => candidate.id === id); if (page) { if (closeReferences) useWindowStore.getState().closeWindowsForPage(page.pageNumber); unholdPage(page.pageNumber); } }} />
          </aside>}
        </main>
        {documentId && <footer className="h-16 shrink-0 border-t border-[var(--border)]"><TimelineBar currentPage={activePage} chapters={book.toc} totalPages={totalPages} onPageClick={jumpToPage} markers={heldPages.map((page) => page.pageNumber)} /></footer>}
      </div>
      {isQuickFlipVisible && ready && <QuickFlipOverlay isVisible onClose={dismissQuickFlip} currentPage={quickFlipOrigin.current.page} totalPages={totalPages} onPageChange={page => { updateWindow(quickFlipOrigin.current.windowId, { pageNumber: page }); setActiveWindow(quickFlipOrigin.current.windowId); }} />}
    </>
  );
}
export default App;
