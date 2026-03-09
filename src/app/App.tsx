import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { WorkspaceCanvas } from './components/workspace/WorkspaceCanvas';
import { HeldPagesPanel } from './components/held-pages/HeldPagesPanel';
import { QuickFlipOverlay } from './components/quick-flip/QuickFlipOverlay';
import { TimelineBar } from './components/timeline/TimelineBar';
import { HeldPage, ReaderWindow } from './types/domain';

/**
 * LeafSpace 主应用壳层 (集成拖拽交互)
 */
function App() {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(100);
  const [isQuickFlipVisible, setIsQuickFlipVisible] = useState(false);
  
  // 窗口状态管理
  const [windows, setWindows] = useState<ReaderWindow[]>([
    {
      id: 'main-window',
      type: 'main',
      pageNumber: 1,
      title: 'Main Viewer',
      dockMode: 'none',
      zIndex: 1,
      isActive: true,
      canClose: false,
    },
  ]);

  const [heldPages, setHeldPages] = useState<HeldPage[]>([
    { id: '1', pageNumber: 5, defaultName: 'Intro', createdAt: '', isOpen: false },
    { id: '2', pageNumber: 12, defaultName: 'Architecture', createdAt: '', isOpen: false }
  ]);

  // 处理窗口更新 (拖拽、激活等)
  const handleWindowUpdate = useCallback((updatedWin: ReaderWindow) => {
    setWindows(prev => prev.map(w => w.id === updatedWin.id ? updatedWin : {
      ...w,
      isActive: updatedWin.id === w.id ? true : (updatedWin.isActive ? false : w.isActive)
    }));
    
    if (updatedWin.type === 'main') {
      setCurrentPage(updatedWin.pageNumber);
    }
  }, []);

  // 处理关闭窗口
  const handleWindowClose = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  // 点击夹页：在主窗打开或新建参考窗
  const handleHeldPageClick = (page: HeldPage) => {
    // 逻辑：如果 Shift 按下，打开新窗口；否则切换主窗
    const newWin: ReaderWindow = {
      id: `ref-${Date.now()}`,
      type: 'floating',
      pageNumber: page.pageNumber,
      title: `Ref: P.${page.pageNumber}`,
      dockMode: 'none',
      zIndex: Math.max(...windows.map(w => w.zIndex)) + 1,
      isActive: true,
      canClose: true,
      x: 50 + Math.random() * 100,
      y: 50 + Math.random() * 100,
      width: 400,
      height: 500,
    };
    setWindows(prev => [...prev.map(w => ({ ...w, isActive: false })), newWin]);
  };

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
        <div className="document-info">Spatial Drag & Drop Workspace</div>
      </header>

      <main className="leaf-main-container">
        <section className="leaf-workspace-area">
          <WorkspaceCanvas 
            windows={windows} 
            onWindowUpdate={handleWindowUpdate}
            onWindowClose={handleWindowClose}
          />
        </section>

        <aside className="leaf-held-pages-panel">
          <HeldPagesPanel 
            pages={heldPages.map(p => ({ 
              ...p, 
              isOpen: windows.some(w => w.pageNumber === p.pageNumber) 
            }))} 
            onPageClick={handleHeldPageClick}
            onRemovePage={(id) => setHeldPages(prev => prev.filter(pg => pg.id !== id))}
          />
        </aside>
      </main>

      <footer className="leaf-timeline-bar">
        <TimelineBar 
          currentPage={currentPage} 
          totalPages={totalPages} 
          onPageClick={(p) => {
            setCurrentPage(p);
            handleWindowUpdate({ ...windows[0], pageNumber: p });
          }} 
        />
      </footer>

      <QuickFlipOverlay 
        isVisible={isQuickFlipVisible}
        onClose={() => setIsQuickFlipVisible(false)}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={(p) => {
          setCurrentPage(p);
          handleWindowUpdate({ ...windows[0], pageNumber: p });
          setIsQuickFlipVisible(false);
        }}
      />
    </div>
  );
}

export default App;
