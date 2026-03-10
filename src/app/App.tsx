import { useEffect, useRef, useCallback } from 'react';
import './App.css';
import { WorkspaceCanvas } from '../components/workspace/WorkspaceCanvas.tsx';
import { HeldPagesPanel } from '../components/held-pages/HeldPagesPanel.tsx';
import { QuickFlipOverlay } from '../components/quick-flip/QuickFlipOverlay.tsx';
import { TimelineBar } from '../components/timeline/TimelineBar.tsx';

import { useBookStore } from '../stores/bookStore';
import { useHeldStore } from '../stores/heldStore';
import { useWindowStore } from '../stores/windowStore';
import { useQuickFlipStore } from '../stores/quickFlipStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useRecentBooksStore } from '../stores/recentBooksStore';
import { thumbnailService } from '../services/ThumbnailService';

function App() {
  const { currentPage, totalPages, setCurrentPage, loadDocument, documentId, error: bookError } = useBookStore();
  const { pages: heldPages, unholdPage } = useHeldStore();
  const { windows, updateWindow, closeWindow, openInNewWindow, setActiveWindow } = useWindowStore();
  const { isOpen: isQuickFlipVisible, close: closeQuickFlip, open: openQuickFlip } = useQuickFlipStore();
  const { saveWorkspace, restoreWorkspace, status: workspaceStatus } = useWorkspaceStore();
  const { books: recentBooks, loadBooks: loadRecentBooks, addBook: addRecentBook } = useRecentBooksStore();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileNameRef = useRef<string>('');

  // Load recent books on mount
  useEffect(() => {
    loadRecentBooks();
  }, [loadRecentBooks]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      pendingFileNameRef.current = file.name;
      try {
        await loadDocument(file);
        const state = useBookStore.getState();
        const newId = state.documentId;
        if (newId) {
          await restoreWorkspace(newId);
          await addRecentBook({
            documentId: newId,
            fileName: file.name,
            totalPages: state.totalPages,
          });
        }
      } catch (err) {
        console.error('Workflow Error:', err);
      }
      // Reset input so the same file can be re-selected
      e.target.value = '';
    }
  }, [loadDocument, restoreWorkspace, addRecentBook]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && documentId && !isQuickFlipVisible) {
        e.preventDefault();
        openQuickFlip(currentPage);
        const pages = Array.from({ length: 15 }, (_, i) => currentPage - 7 + i).filter(p => p > 0 && p <= totalPages);
        thumbnailService.ensureThumbnails(pages);
      } else if ((e.key === ' ' || e.key === 'Escape') && isQuickFlipVisible) {
        e.preventDefault();
        closeQuickFlip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [documentId, isQuickFlipVisible, currentPage, totalPages, openQuickFlip, closeQuickFlip]);

  return (
    <div className="leaf-space-shell kindle-theme">
      <header className="leaf-header">
        <div className="logo-section">
          <span className="logo-text">LeafSpace</span>
          {workspaceStatus === 'restoring' && <span className="status-badge">正在恢复布局...</span>}
          {workspaceStatus === 'saving' && <span className="status-badge">正在保存...</span>}
        </div>
        
        <div className="center-info">
          {bookError ? (
            <span className="error-text">文件加载失败</span>
          ) : documentId ? (
            <span className="reading-title">正在阅读模式</span>
          ) : (
            <span className="welcome-text">欢迎使用深度阅读空间</span>
          )}
        </div>

        <div className="header-actions">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" style={{ display: 'none' }} />
          <button onClick={() => fileInputRef.current?.click()} className="kindle-btn">导入书籍</button>
          <button 
            onClick={() => documentId && saveWorkspace(documentId)} 
            disabled={!documentId || workspaceStatus === 'saving'}
            className="kindle-btn outline"
          >
            保存现场
          </button>
        </div>
      </header>

      <main className="leaf-main-container">
        <section className="leaf-workspace-area">
          {documentId ? (
            <WorkspaceCanvas 
              windows={windows} 
              onWindowUpdate={(win) => {
                 updateWindow(win.id, win);
                 if (win.isActive) setActiveWindow(win.id);
              }}
              onWindowClose={closeWindow}
            />
          ) : (
            <div className="welcome-screen">
              <div className="hero">
                <h1>静谧阅读</h1>
                <p>为扫描版 PDF 打造的空间化阅读体验。</p>
                <button onClick={() => fileInputRef.current?.click()} className="kindle-btn large">开启您的阅读之旅</button>
              </div>

              {recentBooks.length > 0 && (
                <div className="recent-books">
                  <h2 className="recent-books-title">最近打开</h2>
                  <ul className="recent-books-list">
                    {recentBooks.map((book) => (
                      <li key={book.documentId} className="recent-book-item">
                        <button
                          className="recent-book-btn"
                          onClick={() => fileInputRef.current?.click()}
                          title={`重新导入文件以恢复 "${book.fileName}" 的阅读状态`}
                        >
                          <span className="recent-book-name">{book.fileName}</span>
                          <span className="recent-book-meta">
                            {book.totalPages} 页 · {new Date(book.lastOpenedAt).toLocaleDateString('zh-CN')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="leaf-held-pages-panel">
          <HeldPagesPanel 
            pages={heldPages} 
            onPageClick={(p) => openInNewWindow(p.pageNumber)}
            onRemovePage={(id) => {
              const p = heldPages.find(pg => pg.id === id);
              if (p) unholdPage(p.pageNumber);
            }}
          />
        </aside>
      </main>

      <footer className="leaf-timeline-bar">
        <TimelineBar 
          currentPage={currentPage} 
          totalPages={totalPages} 
          onPageClick={(p) => {
            setCurrentPage(p);
            updateWindow('main', { pageNumber: p, title: `第 ${p} 页` });
          }} 
          markers={heldPages.map(p => p.pageNumber)}
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
