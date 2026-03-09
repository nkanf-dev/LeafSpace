import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ReaderViewport } from '../reader/ReaderViewport';
import { useWindowStore } from '../../stores/windowStore';
import { RefreshCcw, ExternalLink, Columns2, X } from 'lucide-react';
import '../../styles/WorkspaceCanvas.css';

interface Props {
  windows: any[]; // 兼容 ReaderWindow 接口
  onWindowUpdate: (updatedWindow: any) => void;
  onWindowClose: (id: string) => void;
}

export const WorkspaceCanvas: React.FC<Props> = ({ windows, onWindowUpdate, onWindowClose }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const windowsRef = useRef(windows);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const swapWithMain = useWindowStore(state => state.swapWithMain);

  useEffect(() => { windowsRef.current = windows; }, [windows]);

  const dockedWindow = windows.find(w => w.dockMode === 'right-half');
  const mainWindow = windows.find(w => w.type === 'main');
  const floatingWindows = windows.filter(w => w.type !== 'main' && w.dockMode === 'none');

  const handleMouseDown = (e: React.MouseEvent, win: any) => {
    if (win.type === 'main' || win.dockMode !== 'none') return;
    e.preventDefault();
    setDraggingId(win.id);
    const windowEl = e.currentTarget.closest('.kindle-floating-window') as HTMLElement;
    const windowRect = windowEl.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - windowRect.left, y: e.clientY - windowRect.top };
    onWindowUpdate({ ...win, isActive: true, zIndex: Math.max(...windowsRef.current.map(w => w.zIndex || 0), 0) + 1 });
  };

  const handleResizeStart = (e: React.MouseEvent, win: any) => {
    e.preventDefault(); e.stopPropagation();
    setResizingId(win.id);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: win.width || 400, h: win.height || 500 };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!workspaceRef.current) return;
    const workspaceRect = workspaceRef.current.getBoundingClientRect();

    if (draggingId) {
      const win = windowsRef.current.find(w => w.id === draggingId);
      if (win) {
        onWindowUpdate({ 
          ...win, 
          x: e.clientX - workspaceRect.left - dragOffset.current.x, 
          y: e.clientY - workspaceRect.top - dragOffset.current.y 
        });
      }
    } else if (resizingId) {
      const win = windowsRef.current.find(w => w.id === resizingId);
      if (win) {
        const deltaX = e.clientX - resizeStart.current.x;
        const deltaY = e.clientY - resizeStart.current.y;
        onWindowUpdate({ 
          ...win, 
          width: Math.max(250, resizeStart.current.w + deltaX), 
          height: Math.max(250, resizeStart.current.h + deltaY) 
        });
      }
    }
  }, [draggingId, resizingId, onWindowUpdate]);

  useEffect(() => {
    const up = () => { setDraggingId(null); setResizingId(null); };
    if (draggingId || resizingId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', up);
      document.body.classList.add('is-panning');
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('is-panning');
    };
  }, [draggingId, resizingId, handleMouseMove]);

  return (
    <div className={`kindle-workspace ${dockedWindow ? 'is-split' : ''}`} ref={workspaceRef}>
      <div className="workspace-grid">
        {mainWindow && <div className={`grid-pane main-pane ${mainWindow.isActive ? 'active' : ''}`}><ReaderViewport isMain={true} /></div>}
        {dockedWindow && (
          <div className={`grid-pane side-pane ${dockedWindow.isActive ? 'active' : ''}`}>
            <div className="pane-header">
              <span className="pane-badge">对比</span>
              <span className="pane-title">{dockedWindow.title}</span>
              <div className="pane-actions">
                <button onClick={() => swapWithMain(dockedWindow.id)} title="交换"><RefreshCcw size={14} strokeWidth={2.5} /></button>
                <button onClick={() => onWindowUpdate({...dockedWindow, dockMode: 'none'})} title="浮动"><ExternalLink size={14} strokeWidth={2.5} /></button>
                <button onClick={() => onWindowClose(dockedWindow.id)} className="danger"><X size={14} strokeWidth={2.5} /></button>
              </div>
            </div>
            <ReaderViewport pageNumber={dockedWindow.pageNumber} />
          </div>
        )}
      </div>

      {floatingWindows.map(win => (
        <div 
          key={win.id} 
          className={`kindle-floating-window ${win.isActive ? 'active' : ''}`} 
          style={{ zIndex: win.zIndex, left: win.x, top: win.y, width: win.width, height: win.height }} 
          onMouseDown={() => !win.isActive && onWindowUpdate({...win, isActive: true})}
        >
          <div className="floating-header" onMouseDown={(e) => handleMouseDown(e, win)}>
            <span className="title">参考: P.{win.pageNumber}</span>
            <div className="actions">
              <button onClick={() => onWindowUpdate({...win, dockMode: 'right-half'})} title="吸附"><Columns2 size={14} strokeWidth={2.5} /></button>
              <button onClick={() => onWindowClose(win.id)} className="danger"><X size={14} strokeWidth={2.5} /></button>
            </div>
          </div>
          <div className="floating-body">
            <ReaderViewport pageNumber={win.pageNumber} />
          </div>
          <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, win)} />
        </div>
      ))}
    </div>
  );
};
