import { useState, useEffect } from 'react';
import './App.css';
import { WorkspaceCanvas } from './components/workspace/WorkspaceCanvas';
import { HeldPagesPanel } from './components/held-pages/HeldPagesPanel';
import { QuickFlipOverlay } from './components/quick-flip/QuickFlipOverlay';
import { TimelineBar } from './components/timeline/TimelineBar';
import { HeldPage } from './types/domain';

/**
 * LeafSpace 主应用壳层 (UI 深度开发版)
 * 集成 WorkspaceCanvas 和 TimelineBar
 */
function App() {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(100);
  const [isQuickFlipVisible, setIsQuickFlipVisible] = useState(false);
  const [heldPages, setHeldPages] = useState<HeldPage[]>([
    { id: '1', pageNumber: 5, defaultName: 'Intro', createdAt: '', isOpen: false },
    { id: '2', pageNumber: 12, defaultName: 'Architecture', createdAt: '', isOpen: false }
  ]);

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

  return (
    <div className="leaf-space-shell">
      <header className="leaf-header">
        <div className="logo">LeafSpace</div>
        <div className="document-info">Drafting the Spatial Workspace</div>
      </header>

      <main className="leaf-main-container">
        <section className="leaf-workspace-area">
          <WorkspaceCanvas />
        </section>

        <aside className="leaf-held-pages-panel">
          <HeldPagesPanel 
            pages={heldPages.map(p => ({ ...p, isOpen: p.pageNumber === currentPage }))} 
            onPageClick={(p) => setCurrentPage(p.pageNumber)}
            onRemovePage={(id) => setHeldPages(prev => prev.filter(pg => pg.id !== id))}
          />
        </aside>
      </main>

      <footer className="leaf-timeline-bar">
        <TimelineBar 
          currentPage={currentPage} 
          totalPages={totalPages} 
          onPageClick={setCurrentPage} 
        />
      </footer>

      <QuickFlipOverlay 
        isVisible={isQuickFlipVisible}
        onClose={() => setIsQuickFlipVisible(false)}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

export default App;
