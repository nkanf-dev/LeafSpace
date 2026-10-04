import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { BookOpen, BookmarkPlus, Layers, X } from 'lucide-react';
import { WorkspaceCanvas } from '../components/workspace/WorkspaceCanvas';
import { HeldPagesPanel } from '../components/held-pages/HeldPagesPanel';
import { QuickFlipOverlay } from '../components/quick-flip/QuickFlipOverlay';
import { TimelineBar } from '../components/timeline/TimelineBar';
import { useBookStore } from '../stores/bookStore';
import { useHeldStore } from '../stores/heldStore';
import { useWindowStore } from '../stores/windowStore';
import { useQuickFlipStore } from '../stores/quickFlipStore';
import { useWorkspaceStore, type WorkspaceConflict } from '../stores/workspaceStore';
import { useUnsavedExitGuard } from '../hooks/useUnsavedExitGuard';
import { useWorkspaceAutoSave } from '../hooks/useWorkspaceAutoSave';
import { PDFPasswordRequiredError } from '../services/PDFService';
import { prepareHeldRead } from '../services/HeldReadTransaction';
import { notifyReaderNavigation } from '../services/readerNavigationIntent';
import { useThumbnailActions } from '../hooks/useThumbnailActions';
import { ThumbnailActionDialog } from '../components/thumbnails/ThumbnailActionDialog';

function isCurrentWorkspaceSaved(documentId: string | null) {
  const snapshot = useWorkspaceStore.getState().currentSnapshot;
  const book = useBookStore.getState();
  const { windows, activeWindowId } = useWindowStore.getState();
  return !!snapshot && snapshot.documentId === documentId && snapshot.currentPage === book.currentPage && snapshot.scale === book.scale
    && snapshot.activeWindowId === activeWindowId && JSON.stringify(snapshot.heldPages) === JSON.stringify(useHeldStore.getState().pages)
    && JSON.stringify(snapshot.windows) === JSON.stringify(windows);
}

function conflictDescription(conflict: WorkspaceConflict): string {
  const page = conflict.currentPage === null ? '页码未知' : `第 ${conflict.currentPage} 页`;
  const saved = conflict.savedAt && Number.isFinite(Date.parse(conflict.savedAt))
    ? `，保存于 ${new Date(conflict.savedAt).toLocaleString('zh-CN')}` : '';
  return `检测到的已存现场：${page}${saved}。`;
}

// Disabled controls may be muted, but re-enabled text must regain its full
// contrast immediately instead of fading through a readable-but-low-contrast state.
const solidButton = 'inline-flex min-h-10 items-center justify-center gap-2 border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50';
const outlineButton = 'inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border)] px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50';

function App() {
  const book = useBookStore();
  const { currentPage, totalPages, documentId, documentName, sessionId, scale, status: bookStatus, loadDocument } = book;
  const { pages: heldPages, metadataGeneration, updatePageMetadata, holdPage, unholdPage, reset: resetHeldPages } = useHeldStore();
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
  const [replaceDocumentId, setReplaceDocumentId] = useState<string | null>(null);
  const [conflictResolution, setConflictResolution] = useState<{ action: 'reload' | 'overwrite'; conflict: WorkspaceConflict } | null>(null);
  const conflictOpener = useRef<HTMLElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const problemButtonRef = useRef<HTMLButtonElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const problemFocusRequest = useRef<{ error: string; opener: HTMLElement; previousFocus: Element | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importLock = useRef(false);
  const quickFlipOpener = useRef<HTMLElement | null>(null);
  const quickFlipOrigin = useRef({ windowId: 'main', page: 1 });
  const showQuickFlip = useCallback((page: number) => {
    quickFlipOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    quickFlipOrigin.current = { windowId: useWindowStore.getState().activeWindowId ?? 'main', page };
    openQuickFlip(page);
  }, [openQuickFlip]);
  const dismissQuickFlip = useCallback(() => {
    const active = useWindowStore.getState().activeWindowId;
    closeQuickFlip();
    // React removes background inertness during the commit. Restore focus after it,
    // using the opener captured before inert moved focus away from the reader.
    window.requestAnimationFrame(() => {
      if (active && active !== quickFlipOrigin.current.windowId) document.querySelector<HTMLElement>(`[data-window-id="${active}"] [role="region"]`)?.focus();
      else quickFlipOpener.current?.focus();
    });
  }, [closeQuickFlip]);
  const heldToggleRef = useRef<HTMLButtonElement>(null);
  const heldBackRef = useRef<HTMLButtonElement>(null);
  const closeReferenceWindow = useCallback((id: string) => {
    closeWindow(id);
    window.requestAnimationFrame(() => {
      const activeId = useWindowStore.getState().activeWindowId;
      const pane = Array.from(document.querySelectorAll<HTMLElement>('[data-window-id]')).find(element => element.dataset.windowId === activeId);
      pane?.querySelector<HTMLElement>('[role="region"]')?.focus();
    });
  }, [closeWindow]);
  const closeHeldPanel = () => { setShowHeldPages(false); heldToggleRef.current?.focus(); };
  useEffect(() => {
    if (showHeldPages) heldBackRef.current?.focus();
    const onResize = () => { if (window.innerWidth >= 1024) setShowHeldPages(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [showHeldPages]);
  const busy = isHydratingDocument || bookStatus === 'loading' || workspaceStatus === 'restoring'
    || (workspaceStatus === 'saving' && workspace.unrestoredDocumentId === documentId);
  const thumbnailActions = useThumbnailActions(`${showHeldPages}:${busy}`);
  const ready = !!documentId && bookStatus === 'ready' && !busy;
  const conflictNeedsConfirmation = conflictResolution && conflictResolution.conflict.documentId === documentId
    && conflictResolution.conflict.sessionId === sessionId && workspace.conflict?.version === conflictResolution.conflict.version;
  const replacementNeedsConfirmation = replaceDocumentId === documentId && !!documentId && workspace.unrestoredDocumentId === documentId;
  const flushWorkspace = useCallback(async (id: string) => {
    // A late scroll/render event may settle while the first write is pending.
    // Freeze input during transitions, then persist that final revision as well.
    do {
      await saveWorkspace(id);
      if (useWorkspaceStore.getState().error || useBookStore.getState().documentId !== id) return false;
    } while (!isCurrentWorkspaceSaved(id));
    return true;
  }, [saveWorkspace]);

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
        if (!await flushWorkspace(previousBook.documentId)) {
          setWorkflowError(useWorkspaceStore.getState().conflict
            ? useWorkspaceStore.getState().error
            : useWorkspaceStore.getState().unrestoredDocumentId === previousBook.documentId
            ? '上次阅读现场尚未恢复，已暂停切换书籍。请先重试恢复，或点击「保存现场」确认替换。'
            : '当前阅读现场未能保存，已暂停切换书籍。请重试保存后再导入，避免丢失刚才的更改。');
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
    } catch (error) {
      setWorkflowError(error instanceof PDFPasswordRequiredError ? error.message
        : '这本 PDF 没有成功打开或保存到本机。请检查文件是否完整，再重新导入。');
    } finally {
      importLock.current = false;
      setIsHydratingDocument(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [loadDocument, closeQuickFlip, registerCurrentBook, resetHeldPages, resetWindows, restoreWorkspace, flushWorkspace]);

  useEffect(() => { void hydrateRecentBooks(); }, [hydrateRecentBooks]);

  useUnsavedExitGuard();

  const readAutoSaveState = useCallback(() => {
    const currentBook = useBookStore.getState();
    const currentWorkspace = useWorkspaceStore.getState();
    const currentWindows = useWindowStore.getState();
    return {
      documentId: currentBook.documentId, sessionId: currentBook.sessionId,
      currentPage: currentBook.currentPage, scale: currentBook.scale,
      heldPages: useHeldStore.getState().pages, windows: currentWindows.windows,
      activeWindowId: currentWindows.activeWindowId,
      enabled: !importLock.current && currentBook.status === 'ready' && currentWorkspace.status === 'idle'
        && currentWorkspace.unrestoredDocumentId !== currentBook.documentId && !currentWorkspace.conflict,
    };
  }, []);
  useWorkspaceAutoSave({ documentId, sessionId, currentPage, scale, heldPages, windows, activeWindowId,
    enabled: ready && workspaceStatus === 'idle' && workspace.unrestoredDocumentId !== documentId && !workspace.conflict,
    currentSnapshot: workspace.currentSnapshot, readCurrent: readAutoSaveState, saveWorkspace });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (thumbnailActions.controller.ownsInput() || busy || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' && !isQuickFlipVisible) {
        if (conflictNeedsConfirmation) {
          event.preventDefault();
          setConflictResolution(null);
          conflictOpener.current?.focus();
          return;
        }
        if (replacementNeedsConfirmation) {
          event.preventDefault();
          setReplaceDocumentId(null);
          saveButtonRef.current?.focus();
          return;
        }
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
          useWindowStore.getState().setActiveWindow('main');
          window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="主阅读区"]')?.focus());
        }
        return;
      }
      if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a, [contenteditable="true"], [role="dialog"], [role="alert"]')) return;
      if (event.key === ' ' && ready) {
        event.preventDefault();
        if (isQuickFlipVisible) dismissQuickFlip();
        else showQuickFlip(activePage);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [thumbnailActions.controller, ready, busy, isQuickFlipVisible, activePage, showQuickFlip, dismissQuickFlip, showHeldPages, replacementNeedsConfirmation, conflictNeedsConfirmation]);

  const returnToLibrary = async () => {
    if (!ready || importLock.current) return;
    importLock.current = true;
    setIsHydratingDocument(true);
    setWorkflowError(null);
    setDismissedError(null);
    try {
      if (documentId && !await flushWorkspace(documentId)) return;
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
  const problemVisible = !!error && error !== dismissedError;
  useLayoutEffect(() => {
    const request = problemFocusRequest.current;
    problemFocusRequest.current = null;
    if (!request) return;
    const active = document.activeElement;
    if (active !== request.opener && active !== request.previousFocus
      && !(active === document.body && !request.opener.isConnected)) return;
    const fallback = statusRef.current?.textContent?.trim() ? statusRef.current : importButtonRef.current;
    const target = error === request.error && problemVisible ? problemRef.current : !error ? fallback : null;
    if (target?.isConnected && !target.closest('[inert]')) target.focus();
  }, [error, problemVisible]);
  const showProblem = () => {
    if (!error || !problemButtonRef.current) return;
    if (problemRef.current) {
      if (!problemRef.current.closest('[inert]')) problemRef.current.focus();
      return;
    }
    problemFocusRequest.current = { error, opener: problemButtonRef.current, previousFocus: document.activeElement };
    setDismissedError(null);
  };
  const dismissProblem = () => {
    setDismissedError(error);
    problemButtonRef.current?.focus();
  };
  const saved = isCurrentWorkspaceSaved(documentId);
  const retryStorage = () => {
    setReplaceDocumentId(null);
    setWorkflowError(null);
    setDismissedError(null);
    if (workspace.errorOperation === 'recent') void hydrateRecentBooks();
    else if (workspace.errorOperation === 'restore' && documentId) void restoreWorkspace(documentId);
    else if (documentId && workspace.unrestoredDocumentId === documentId) setReplaceDocumentId(documentId);
    else if (documentId) void saveWorkspace(documentId);
  };
  const requestSave = () => {
    if (!documentId) return;
    if (workspace.conflict) { setWorkflowError(null); setDismissedError(null); }
    else if (workspace.unrestoredDocumentId === documentId) setReplaceDocumentId(documentId);
    else void saveWorkspace(documentId);
  };
  const requestConflictResolution = (action: 'reload' | 'overwrite', opener: HTMLElement) => {
    if (!workspace.conflict) return;
    conflictOpener.current = opener;
    setConflictResolution({ action, conflict: workspace.conflict });
  };
  const closeConflictConfirmation = () => {
    setConflictResolution(null);
    conflictOpener.current?.focus();
  };
  const closeReplaceConfirmation = () => {
    setReplaceDocumentId(null);
    saveButtonRef.current?.focus();
  };

  return (
    <>
      <div inert={isQuickFlipVisible || thumbnailActions.isOpen} className="flex h-dvh min-h-0 w-full flex-col bg-[var(--app-bg)] text-[var(--ink)]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="回到书库" disabled={!ready} onClick={() => void returnToLibrary()} className="text-2xl font-extrabold italic tracking-tight text-stone-900 disabled:cursor-default" style={{ fontFamily: 'Georgia, serif' }}>LeafSpace</button>
            <span className="hidden text-xs text-stone-500 sm:inline">页境 · 空间化研读</span>
          </div>
          <div className="order-3 flex w-full min-w-0 items-center justify-between gap-3 text-xs text-stone-500 sm:order-none sm:w-auto sm:flex-1 sm:px-4">
            <span className="truncate">{documentId ? `${documentName || '当前书籍'} · 第 ${currentPage} 页` : '让线性翻页，成为空间化阅读'}</span>
            <div className="shrink-0">
              <span ref={statusRef} role="status" aria-atomic="true" tabIndex={-1} className={error ? 'sr-only' : undefined}>{workspaceStatus === 'saving' ? '正在保存…' : busy ? '正在打开…' : workspaceStatus === 'error' || error ? '操作遇到问题' : saved ? '已保存到本机' : ready ? '更改待保存' : ''}</span>
              {error && <button ref={problemButtonRef} type="button" aria-expanded={problemVisible} aria-controls={problemVisible ? 'workspace-problem-guidance' : undefined} onClick={showProblem} className="min-h-10 px-2 text-amber-900 underline underline-offset-4">查看问题</button>}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <input aria-label="选择 PDF 文件" type="file" ref={fileInputRef} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} accept=".pdf,application/pdf" className="hidden" disabled={busy} />
            <button ref={importButtonRef} disabled={busy} onClick={() => fileInputRef.current?.click()} className={solidButton}>导入书籍</button>
            {documentId && <button ref={saveButtonRef} onClick={requestSave} disabled={!ready || workspaceStatus === 'saving'} className={outlineButton}>保存现场</button>}
          </div>
        </header>

        {replacementNeedsConfirmation && documentId && <div role="group" aria-label="确认替换上次现场" aria-describedby="workspace-replacement-warning" onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeReplaceConfirmation(); }
        }} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p id="workspace-replacement-warning" className="min-w-0 flex-1">上次现场尚未恢复。覆盖会用当前页码、夹页和窗口布局替换它；原 PDF 不受影响。</p>
          <button aria-describedby="workspace-replacement-warning" className="min-h-10 border border-amber-900 px-3 py-2" onClick={() => {
            closeReplaceConfirmation(); setWorkflowError(null); setDismissedError(null);
            void saveWorkspace(documentId, { replaceUnrestored: true });
          }}>覆盖上次现场</button>
          <button autoFocus aria-describedby="workspace-replacement-warning" className="min-h-10 px-3 py-2 underline" onClick={closeReplaceConfirmation}>取消覆盖</button>
        </div>}

        {conflictNeedsConfirmation && conflictResolution && documentId && <div role="group" aria-label="确认解决现场冲突" aria-describedby="workspace-conflict-warning" onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeConflictConfirmation(); }
        }} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p id="workspace-conflict-warning" className="min-w-0 basis-full sm:flex-1">{conflictDescription(conflictResolution.conflict)}{conflictResolution.action === 'reload'
            ? '载入检测到的已存现场会替换此标签页尚未保存的页码、夹页（含名称和备注）和窗口布局。此页更改将丢失；原 PDF 不受影响。若已存现场再次变化，会保留此页并重新提示。'
            : '将用此页当前的页码、夹页（含名称和备注）和窗口布局覆盖检测到的已存现场。已存现场将被替换；原 PDF 不受影响。若其他标签页再次保存，仍会暂停并提示。'}</p>
          <button aria-describedby="workspace-conflict-warning" disabled={busy || workspaceStatus === 'saving'} className="min-h-10 border border-amber-900 px-3 py-2" onClick={() => {
            const { action, conflict } = conflictResolution;
            closeConflictConfirmation(); setWorkflowError(null); setDismissedError(null);
            void workspace.resolveWorkspaceConflict(documentId, action, conflict.version);
          }}>{conflictResolution.action === 'reload' ? '确认载入' : '确认覆盖'}</button>
          <button autoFocus aria-describedby="workspace-conflict-warning" className="min-h-10 px-3 py-2 underline" onClick={closeConflictConfirmation}>取消处理</button>
        </div>}

        {problemVisible && <div ref={problemRef} id="workspace-problem-guidance" role="alert" aria-label="问题详情" aria-describedby="workspace-problem-message" tabIndex={-1} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span id="workspace-problem-message" className="min-w-0 basis-full sm:flex-1">{workflowError || (workspace.errorOperation === 'register' ? 'PDF 尚未保存到本机，请保留原文件。可以继续阅读，但刷新或关闭页面可能丢失未保存的现场；请先重试保存。' : workspace.error ? `本机存储遇到问题：${workspace.error}` : '文件加载失败，请检查 PDF 后重新导入。')}</span>
          {workspace.error && workspace.errorOperation !== 'open' && !workspace.conflict && <button className="underline underline-offset-4" onClick={retryStorage} disabled={busy || workspaceStatus === 'saving'}>{workspace.errorOperation === 'restore' ? '重试恢复' : workspace.errorOperation === 'recent' ? '重试读取' : workspace.unrestoredDocumentId === documentId ? '重新确认覆盖' : '重试保存'}</button>}
          {workspace.conflict && <>
            <button className="min-h-10 underline underline-offset-4" disabled={busy || workspaceStatus === 'saving'} onClick={event => requestConflictResolution('reload', event.currentTarget)}>载入已存现场</button>
            <button className="min-h-10 underline underline-offset-4" disabled={busy || workspaceStatus === 'saving'} onClick={event => requestConflictResolution('overwrite', event.currentTarget)}>用此页覆盖</button>
          </>}
          {!workspace.conflict && <button className="underline underline-offset-4" onClick={() => fileInputRef.current?.click()} disabled={busy}>重新导入</button>}
          <button aria-label="关闭提示" className="p-2" onClick={dismissProblem}><X size={18} /></button>
        </div>}

        {documentId && <div inert={busy} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 sm:px-6">
          <button className={outlineButton} disabled={!ready} onClick={() => showQuickFlip(activePage)}><BookOpen size={16} />速翻<span className="hidden text-xs text-stone-600 sm:inline">Space</span></button>
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
        <main inert={busy} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <section inert={showHeldPages} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#edece9]">
            {documentId ? <WorkspaceCanvas subscribeInterruption={thumbnailActions.controller.onInterrupt} windows={windows} onWindowUpdate={(win) => {
              // Canvas callbacks carry the full window for layout operations.
              // Do not turn a raise/drag/resize into a new page choice or replay
              // a stale paper viewport while applying that geometry.
              updateWindow(win.id, { x: win.x, y: win.y, width: win.width, height: win.height,
                type: win.type, dockMode: win.dockMode, splitRatio: win.splitRatio,
                zIndex: win.zIndex, isActive: win.isActive });
              if (win.isActive) setActiveWindow(win.id);
            }} onWindowClose={closeReferenceWindow} /> : (
              <div className="flex min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] p-4 sm:p-8 lg:items-center lg:justify-center">
                <div className="m-auto grid w-full max-w-[1080px] grid-cols-1 border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_70px_rgba(28,25,23,0.05)] md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
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
                  <div className="min-w-0 border-t border-[var(--border)] bg-[#f6f1e8] px-6 py-8 sm:px-8 md:border-t-0">
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
            <button ref={heldBackRef} className="min-h-11 shrink-0 border-b border-[var(--border)] px-5 text-left text-sm lg:hidden" onClick={closeHeldPanel}>← 返回阅读</button>
            <HeldPagesPanel metadataContextKey={`${documentId}:${sessionId}:${metadataGeneration}:${showHeldPages}:${busy}:${isQuickFlipVisible}`} onUpdateMetadata={(id, changes) => {
              const current = useBookStore.getState();
              if (!ready || importLock.current || current.documentId !== documentId || current.sessionId !== sessionId || current.status !== 'ready' || useWorkspaceStore.getState().status === 'restoring') return false;
              return updatePageMetadata(id, metadataGeneration, changes);
            }} pages={heldPages} thumbnailActions={thumbnailActions.controller} actionsSuspended={thumbnailActions.isOpen} fallbackActionFocus={() => heldToggleRef.current} interactionKey={`${documentId}:${activeWindowId}:${showHeldPages}:${busy}:${isQuickFlipVisible}`} onReorder={useHeldStore.getState().reorderHeldPages} onPrepareReadPage={page => {
              const transaction = prepareHeldRead(page.pageNumber);
              return { ...transaction, commit: () => {
                if (!transaction.commit()) return false;
                closeHeldPanel(); return true;
              } };
            }} onReadPage={(page) => {
              const active = windows.find((win) => win.id === activeWindowId);
              if (!active || active.type === 'main') useWindowStore.getState().openInMain(page.pageNumber);
              else updateWindow(active.id, { pageNumber: page.pageNumber, title: `第 ${page.pageNumber} 页` });
              closeHeldPanel();
            }} onPageClick={(page) => { openInNewWindow(page.pageNumber); closeHeldPanel(); }} onRemovePage={(id, closeReferences) => { const page = heldPages.find((candidate) => candidate.id === id); if (page) { if (closeReferences) useWindowStore.getState().closeWindowsForPage(page.pageNumber); unholdPage(page.pageNumber); } }} />
          </aside>}
        </main>
        {documentId && <footer inert={busy} className="h-16 shrink-0 border-t border-[var(--border)]"><TimelineBar key={`${documentId}:${activeWindowId}:${isQuickFlipVisible}:${showHeldPages}:${busy}:${thumbnailActions.isOpen}`} currentPage={activePage} chapters={book.toc} totalPages={totalPages} onPageClick={jumpToPage} onPreviewStart={() => notifyReaderNavigation(useWindowStore.getState().activeWindowId ?? 'main')} markers={heldPages.map((page) => page.pageNumber)} /></footer>}
      </div>
      {isQuickFlipVisible && ready && <QuickFlipOverlay thumbnailActions={thumbnailActions.controller} interactionSuspended={thumbnailActions.isOpen} isVisible restoreFocusOnClose={false} onClose={dismissQuickFlip} currentPage={quickFlipOrigin.current.page} totalPages={totalPages} onPageChange={page => { updateWindow(quickFlipOrigin.current.windowId, { pageNumber: page }); setActiveWindow(quickFlipOrigin.current.windowId); }} />}
      {thumbnailActions.request && <ThumbnailActionDialog controller={thumbnailActions.controller} request={thumbnailActions.request} awaitingRelease={thumbnailActions.awaitingRelease} />}
    </>
  );
}
export default App;
