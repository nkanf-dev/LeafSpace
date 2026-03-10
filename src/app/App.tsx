import { useEffect, useRef, useCallback } from 'react';
import { WorkspaceCanvas } from '../components/workspace/WorkspaceCanvas.tsx';
import { HeldPagesPanel } from '../components/held-pages/HeldPagesPanel.tsx';
import { QuickFlipOverlay } from '../components/quick-flip/QuickFlipOverlay.tsx';
import { TimelineBar } from '../components/timeline/TimelineBar.tsx';

import { useBookStore } from '../stores/bookStore';
import { useHeldStore } from '../stores/heldStore';
import { useWindowStore } from '../stores/windowStore';
import { useQuickFlipStore } from '../stores/quickFlipStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { thumbnailService } from '../services/ThumbnailService';
import type { ReaderWindow } from '../types/domain';

const solidButtonClasses =
  'border border-stone-900 bg-stone-900 px-4 py-2 text-[0.85rem] font-semibold text-white transition hover:-translate-y-px hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';

const outlineButtonClasses =
  'border border-stone-900 bg-transparent px-4 py-2 text-[0.85rem] font-semibold text-stone-900 transition hover:-translate-y-px hover:bg-stone-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';

function App() {
  const { currentPage, totalPages, setCurrentPage, loadDocument, documentId, documentName, error: bookError, scale } = useBookStore();
  const { pages: heldPages, unholdPage } = useHeldStore();
  const { windows, updateWindow, closeWindow, closeWindowsForPage, openInNewWindow, setActiveWindow } = useWindowStore();
  const { isOpen: isQuickFlipVisible, close: closeQuickFlip, open: openQuickFlip } = useQuickFlipStore();
  const { hydrateRecentBooks, openRecentBook, recentBooks, registerCurrentBook, saveWorkspace, restoreWorkspace, status: workspaceStatus } = useWorkspaceStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await loadDocument(file);
        await registerCurrentBook(file);
        const newId = useBookStore.getState().documentId;
        if (newId) await restoreWorkspace(newId);
      } catch (err) {
        console.error('Workflow Error:', err);
      } finally {
        e.target.value = '';
      }
    }
  }, [loadDocument, registerCurrentBook, restoreWorkspace]);

  useEffect(() => {
    void hydrateRecentBooks();
  }, [hydrateRecentBooks]);

  useEffect(() => {
    if (!documentId || workspaceStatus !== 'idle') {
      return;
    }

    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      void saveWorkspace(documentId);
    }, 500);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [currentPage, documentId, heldPages, saveWorkspace, scale, windows, workspaceStatus]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && documentId) {
        e.preventDefault();

        if (isQuickFlipVisible) {
          closeQuickFlip();
          return;
        }

        openQuickFlip(currentPage);
        const pages = Array.from({ length: 15 }, (_, i) => currentPage - 7 + i).filter((p) => p > 0 && p <= totalPages);
        thumbnailService.ensureThumbnails(pages);
      } else if (e.key === 'Escape' && isQuickFlipVisible) {
        e.preventDefault();
        closeQuickFlip();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [documentId, isQuickFlipVisible, currentPage, totalPages, openQuickFlip, closeQuickFlip]);

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--app-bg)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
        <div className="flex items-center gap-3">
          <span className="text-[1.4rem] font-extrabold italic tracking-[-0.03em]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
            LeafSpace
          </span>
          {workspaceStatus === 'restoring' && (
            <span className="border border-[var(--border)] bg-stone-100 px-2 py-1 text-xs text-stone-600">正在恢复布局...</span>
          )}
        </div>

        <div className="flex-1 px-6 text-center text-sm text-stone-600">
          {bookError ? (
            <span>文件加载失败</span>
          ) : documentId ? (
            <span>{documentName || '当前书籍'} · 第 {currentPage} 页</span>
          ) : (
            <span>欢迎使用页境阅读</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className={solidButtonClasses}>导入书籍</button>
          <button
            onClick={() => documentId && saveWorkspace(documentId)}
            disabled={!documentId || workspaceStatus === 'saving' || workspaceStatus === 'restoring'}
            className={outlineButtonClasses}
          >
            保存现场
          </button>
        </div>
      </header>

      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#edece9]">
          {documentId ? (
            <WorkspaceCanvas
              windows={windows}
              onWindowUpdate={(win: ReaderWindow) => {
                updateWindow(win.id, win);
                if (win.isActive) setActiveWindow(win.id);
              }}
              onWindowClose={closeWindow}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[var(--surface)]">
              <div className="grid w-full max-w-[1120px] grid-cols-[1.1fr_0.9fr] gap-0 border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_rgba(28,25,23,0.08)]">
                <div className="border-r border-[var(--border)] px-12 py-14">
                  <div className="mb-12">
                    <div className="mb-3 text-[0.72rem] font-extrabold uppercase tracking-[0.28em] text-stone-500">LeafSpace</div>
                    <h1 className="mb-5 text-[3.5rem] font-extrabold tracking-[-0.04em]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      页境阅读
                    </h1>
                    <p className="max-w-[520px] text-[1.08rem] leading-7 text-stone-500">为扫描版 PDF 打造的空间化阅读体验。</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button onClick={() => fileInputRef.current?.click()} className="border border-stone-900 bg-stone-900 px-10 py-3 text-[1.05rem] font-semibold text-white transition hover:-translate-y-px hover:bg-stone-800">
                      导入一本 PDF
                    </button>
                  </div>
                </div>

                <div className="bg-[#f6f1e8] px-8 py-10">
                  <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
                    <div>
                      <div className="text-[0.72rem] font-extrabold uppercase tracking-[0.24em] text-stone-500">Recent</div>
                      <div className="mt-1 text-xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>最近打开</div>
                    </div>
                    <div className="text-xs text-stone-500">共 {recentBooks.length} 本</div>
                  </div>

                  <div className="space-y-3">
                    {recentBooks.length > 0 ? recentBooks.map((book) => (
                      <button
                        key={book.documentId}
                        type="button"
                        className="flex w-full items-start justify-between border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-left transition hover:-translate-y-px hover:border-stone-900"
                        onClick={() => void openRecentBook(book.documentId)}
                      >
                        <div className="min-w-0 pr-4">
                          <div className="truncate text-[0.95rem] font-semibold text-stone-900">{book.fileName}</div>
                          <div className="mt-1 text-xs text-stone-500">{book.totalPages} 页 · {(book.fileSize / 1024 / 1024).toFixed(1)} MB</div>
                        </div>
                        <div className="shrink-0 text-right text-[0.7rem] font-medium text-stone-500">
                          <div>最近打开</div>
                          <div className="mt-1 text-stone-700">{new Date(book.lastOpenedAt).toLocaleDateString('zh-CN')}</div>
                        </div>
                      </button>
                    )) : (
                      <div className="border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-stone-500">
                        还没有最近书籍。导入第一本 PDF 之后，这里会保留它和它的阅读现场。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="w-[300px] shrink-0 border-l border-[var(--border)] bg-[var(--surface)]">
          <HeldPagesPanel
            pages={heldPages}
            onPageClick={(p) => {
              const hasClosableWindow = windows.some((window) => window.canClose && window.pageNumber === p.pageNumber);

              if (hasClosableWindow) {
                closeWindowsForPage(p.pageNumber);
                return;
              }

              openInNewWindow(p.pageNumber);
            }}
            onRemovePage={(id) => {
              const page = heldPages.find((pg) => pg.id === id);
              if (page) unholdPage(page.pageNumber);
            }}
          />
        </aside>
      </main>

      <footer className="h-16 shrink-0 border-t border-[var(--border)] bg-[var(--surface)]">
        <TimelineBar
          currentPage={currentPage}
          totalPages={totalPages}
          onPageClick={(p) => {
            setCurrentPage(p);
            updateWindow('main', { pageNumber: p, title: `第 ${p} 页` });
          }}
          markers={heldPages.map((p) => p.pageNumber)}
        />
      </footer>

      {isQuickFlipVisible && (
        <QuickFlipOverlay
          isVisible={isQuickFlipVisible}
          onClose={closeQuickFlip}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={(p) => {
            setCurrentPage(p);
            updateWindow('main', { pageNumber: p, title: `第 ${p} 页` });
          }}
        />
      )}
    </div>
  );
}

export default App;
