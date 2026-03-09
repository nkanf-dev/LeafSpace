import { useEffect } from 'react';
import './App.css';
import { WorkspaceCanvas } from '../components/workspace/WorkspaceCanvas.tsx';
import { HeldPagesPanel } from '../components/held-pages/HeldPagesPanel.tsx';
import { QuickFlipOverlay } from '../components/quick-flip/QuickFlipOverlay.tsx';
import { TimelineBar } from '../components/timeline/TimelineBar.tsx';

// 注入 Agent 2 提供的全局状态
import { useBookStore } from '../stores/bookStore';
import { useHeldStore } from '../stores/heldStore';
import { useWindowStore } from '../stores/windowStore';
import { useQuickFlipStore } from '../stores/quickFlipStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/**
 * LeafSpace 主应用集成版 (Operation Integration)
 * 职责：作为状态分发中心，集成 Agent 1 (UI) 与 Agent 2 (Logic)
 */
function App() {
  const { currentPage, totalPages, setCurrentPage, loadDocument } = useBookStore();
  const { heldPages, holdPage, unholdPage } = useHeldStore();
  const { windows, updateWindow, closeWindow, openInNewWindow } = useWindowStore();
  const { isOpen: isQuickFlipVisible, close: closeQuickFlip, open: openQuickFlip } = useQuickFlipStore();
  const { saveWorkspace, restoreWorkspace } = useWorkspaceStore();

  // 初始化加载 (模拟加载一个 PDF)
  useEffect(() => {
    // 未来这里接入文件上传回调
    console.log('LeafSpace Initializing...');
  }, []);

  // 全局快捷键处理 (由 Architect 统一管理)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isQuickFlipVisible) {
        e.preventDefault();
        openQuickFlip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isQuickFlipVisible, openQuickFlip]);

  return (
    <div className="leaf-space-shell">
      <header className="leaf-header">
        <div className="logo">LeafSpace</div>
        <div className="document-info">Fully Integrated Workspace</div>
        <div className="app-actions">
          <button onClick={() => holdPage(currentPage)}>Hold Current</button>
          <button onClick={() => saveWorkspace()}>Save Snapshot</button>
        </div>
      </header>

      <main className="leaf-main-container">
        <section className="leaf-workspace-area">
          <WorkspaceCanvas 
            windows={windows} 
            onWindowUpdate={updateWindow}
            onWindowClose={closeWindow}
          />
        </section>

        <aside className="leaf-held-pages-panel">
          <HeldPagesPanel 
            pages={heldPages} 
            onPageClick={(p) => openInNewWindow(p.pageNumber)}
            onRemovePage={unholdPage}
          />
        </aside>
      </main>

      <footer className="leaf-timeline-bar">
        <TimelineBar 
          currentPage={currentPage} 
          totalPages={totalPages} 
          onPageClick={setCurrentPage} 
          markers={heldPages.map(p => p.pageNumber)}
        />
      </footer>

      <QuickFlipOverlay 
        isVisible={isQuickFlipVisible}
        onClose={closeQuickFlip}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

export default App;
