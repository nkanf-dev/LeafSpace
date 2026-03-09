import { useState, useEffect } from 'react';
import './App.css';
import { ReaderViewport } from '../components/reader/ReaderViewport';
import { HeldPagesPanel } from '../components/held-pages/HeldPagesPanel';
import { QuickFlipOverlay } from '../components/quick-flip/QuickFlipOverlay';
import type { HeldPage } from '../types/domain';

/**
 * LeafSpace 主应用壳层
 * 由 Agent 1 (Frontend) 填充 UI 组件并注入初步状态逻辑
 */
function App() {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(100); // 模拟总页数
  const [isQuickFlipVisible, setIsQuickFlipVisible] = useState(false);
  const [heldPages, setHeldPages] = useState<HeldPage[]>([
    {
      id: '1',
      pageNumber: 5,
      defaultName: 'Page 5',
      createdAt: new Date().toISOString(),
      isOpen: false
    },
    {
      id: '2',
      pageNumber: 12,
      defaultName: 'Page 12',
      createdAt: new Date().toISOString(),
      isOpen: false
    }
  ]);

  // 处理全局快捷键 (Space 键打开速翻)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isQuickFlipVisible) {
        e.preventDefault();
        setIsQuickFlipVisible(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isQuickFlipVisible]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setIsQuickFlipVisible(false);
  };

  const handleHeldPageClick = (page: HeldPage) => {
    setCurrentPage(page.pageNumber);
  };

  const handleRemoveHeldPage = (id: string) => {
    setHeldPages(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="leaf-space-shell">
      <header className="leaf-header">
        <div className="logo">LeafSpace</div>
        <div className="document-info">Sample PDF Document</div>
        <button 
          className="hold-btn"
          onClick={() => {
            const newPage: HeldPage = {
              id: Date.now().toString(),
              pageNumber: currentPage,
              defaultName: `Page ${currentPage}`,
              createdAt: new Date().toISOString(),
              isOpen: true
            };
            if (!heldPages.find(p => p.pageNumber === currentPage)) {
              setHeldPages([...heldPages, newPage]);
            }
          }}
        >
          Hold Current Page
        </button>
      </header>

      <main className="leaf-main-container">
        <section className="leaf-reader-viewport">
          <ReaderViewport initialPage={currentPage} key={currentPage} />
        </section>

        <aside className="leaf-held-pages-panel">
          <HeldPagesPanel 
            pages={heldPages.map(p => ({ ...p, isOpen: p.pageNumber === currentPage }))} 
            onPageClick={handleHeldPageClick}
            onRemovePage={handleRemoveHeldPage}
          />
        </aside>
      </main>

      <footer className="leaf-timeline-bar">
        <div className="timeline-info">
          Page {currentPage} of {totalPages}
        </div>
      </footer>

      <QuickFlipOverlay 
        isVisible={isQuickFlipVisible}
        onClose={() => setIsQuickFlipVisible(false)}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
    </div>
  );
}

export default App;
