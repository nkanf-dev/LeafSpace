import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ReaderViewport } from '../reader/ReaderViewport';
import { useWindowStore } from '../../stores/windowStore';
import { RefreshCcw, ExternalLink, Columns2, X } from 'lucide-react';
import type { ReaderWindow } from '../../types/domain';

interface Props {
  windows: ReaderWindow[];
  onWindowUpdate: (updatedWindow: ReaderWindow) => void;
  onWindowClose: (id: string) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const WorkspaceCanvas: React.FC<Props> = ({ windows, onWindowUpdate, onWindowClose }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.64);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const splitResizeStart = useRef({ x: 0, ratio: 0.64 });
  const windowsRef = useRef(windows);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const swapWithMain = useWindowStore(state => state.swapWithMain);

  const surfaceIconButton = 'inline-flex items-center justify-center px-2 py-1 text-stone-500 transition hover:bg-black/5 hover:text-stone-900';
  const dangerIconButton = 'inline-flex items-center justify-center px-2 py-1 text-stone-500 transition hover:bg-red-50 hover:text-red-600';

  const raiseWindow = useCallback((window: ReaderWindow) => {
    onWindowUpdate({
      ...window,
      isActive: true,
      zIndex: Math.max(...windowsRef.current.map((candidate) => candidate.zIndex || 0), 0) + 1,
    });
  }, [onWindowUpdate]);

  useEffect(() => { windowsRef.current = windows; }, [windows]);

  const dockedWindow = windows.find(w => w.dockMode === 'right-half');
  const mainWindow = windows.find(w => w.type === 'main');
  const floatingWindows = windows.filter(w => w.type !== 'main' && w.dockMode === 'none');

  const handleMouseDown = (e: React.MouseEvent, win: ReaderWindow) => {
    if (win.type === 'main' || win.dockMode !== 'none') return;
    e.preventDefault();
    setDraggingId(win.id);
    const windowEl = e.currentTarget.closest('[data-floating-window]') as HTMLElement;
    const windowRect = windowEl.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - windowRect.left, y: e.clientY - windowRect.top };
    raiseWindow(win);
  };

  const handleResizeStart = (e: React.MouseEvent, win: ReaderWindow) => {
    e.preventDefault(); e.stopPropagation();
    setResizingId(win.id);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: win.width || 400, h: win.height || 500 };
  };

  const handleSplitResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingSplit(true);
    splitResizeStart.current = { x: e.clientX, ratio: splitRatio };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!workspaceRef.current) return;
    const workspaceRect = workspaceRef.current.getBoundingClientRect();

    if (isResizingSplit) {
      const deltaX = e.clientX - splitResizeStart.current.x;
      const nextRatio = splitResizeStart.current.ratio + deltaX / workspaceRect.width;
      setSplitRatio(clamp(nextRatio, 0.35, 0.8));
      return;
    }

    if (draggingId) {
      const win = windowsRef.current.find(w => w.id === draggingId);
      if (win) {
        const width = win.width || 420;
        const height = win.height || 560;
        const nextX = clamp(e.clientX - workspaceRect.left - dragOffset.current.x, 12, Math.max(12, workspaceRect.width - width - 12));
        const nextY = clamp(e.clientY - workspaceRect.top - dragOffset.current.y, 12, Math.max(12, workspaceRect.height - height - 12));
        onWindowUpdate({ 
          ...win, 
          x: nextX,
          y: nextY,
        });
      }
    } else if (resizingId) {
      const win = windowsRef.current.find(w => w.id === resizingId);
      if (win) {
        const deltaX = e.clientX - resizeStart.current.x;
        const deltaY = e.clientY - resizeStart.current.y;
        const maxWidth = Math.max(280, workspaceRect.width - (win.x || 0) - 16);
        const maxHeight = Math.max(280, workspaceRect.height - (win.y || 0) - 16);
        onWindowUpdate({ 
          ...win, 
          width: clamp(resizeStart.current.w + deltaX, 280, maxWidth), 
          height: clamp(resizeStart.current.h + deltaY, 280, maxHeight), 
        });
      }
    }
  }, [draggingId, isResizingSplit, onWindowUpdate, resizingId]);

  useEffect(() => {
    const up = () => { setDraggingId(null); setResizingId(null); setIsResizingSplit(false); };
    if (draggingId || resizingId || isResizingSplit) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', up);
      document.body.classList.add('is-panning');
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('is-panning');
    };
  }, [draggingId, resizingId, isResizingSplit, handleMouseMove]);

  useEffect(() => {
    if (!dockedWindow) {
      setIsResizingSplit(false);
    }
  }, [dockedWindow]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#edece9]" ref={workspaceRef}>
      <div className="flex h-full w-full min-w-0 bg-[var(--border)]">
        {mainWindow && (
          <div
            className={`min-h-0 min-w-0 flex flex-col overflow-hidden bg-[var(--surface)] ${mainWindow.isActive ? '' : ''}`}
            style={dockedWindow ? { width: `calc(${splitRatio * 100}% - 2px)` } : { width: '100%' }}
          >
            <ReaderViewport isMain={true} windowId={mainWindow.id} />
          </div>
        )}
        {dockedWindow && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整主窗口与分栏宽度"
              className={`group relative w-1 shrink-0 cursor-col-resize bg-[var(--border)] transition hover:bg-stone-500 ${isResizingSplit ? 'bg-stone-900' : ''}`}
              onMouseDown={handleSplitResizeStart}
            >
              <div className="absolute inset-y-0 left-1/2 w-4 -translate-x-1/2" />
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-stone-900" />
            </div>
            <div className="min-h-0 min-w-0 flex flex-col overflow-hidden bg-[var(--surface)]" style={{ width: `calc(${(1 - splitRatio) * 100}% - 2px)` }}>
            <div className="flex h-9 items-center gap-3 border-b border-[var(--border)] bg-[#f3f1ed] px-4">
              <span className="bg-stone-900 px-1.5 py-0.5 text-[0.6rem] font-extrabold text-white">对比</span>
              <span className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold text-stone-500">{dockedWindow.title}</span>
              <div className="flex items-center gap-1">
                <button type="button" className={surfaceIconButton} onClick={() => swapWithMain(dockedWindow.id)} title="交换"><RefreshCcw size={14} strokeWidth={2.5} /></button>
                <button
                  type="button"
                  className={surfaceIconButton}
                  onClick={() => onWindowUpdate({ ...dockedWindow, dockMode: 'none', x: 72, y: 72, width: 420, height: 560 })}
                  title="浮动"
                >
                  <ExternalLink size={14} strokeWidth={2.5} />
                </button>
                <button type="button" className={dangerIconButton} onClick={() => onWindowClose(dockedWindow.id)} title="关闭"><X size={14} strokeWidth={2.5} /></button>
              </div>
            </div>
            <ReaderViewport pageNumber={dockedWindow.pageNumber} windowId={dockedWindow.id} />
            </div>
          </>
        )}
      </div>

      {floatingWindows.map(win => (
        <div 
          key={win.id} 
          data-floating-window
          className={`absolute flex flex-col overflow-hidden border bg-[var(--surface)] shadow-[0_20px_60px_rgba(0,0,0,0.15)] ${win.isActive ? 'border-stone-900 shadow-[0_30px_100px_rgba(0,0,0,0.25)]' : 'border-[var(--border)]'}`}
          style={{ zIndex: win.zIndex, left: win.x, top: win.y, width: win.width, height: win.height }} 
          onMouseDown={() => !win.isActive && raiseWindow(win)}
        >
          <div className="flex h-8 items-center gap-2 border-b border-[var(--border)] bg-[#f3f1ed] px-3" onMouseDown={(e) => handleMouseDown(e, win)}>
            <span className="min-w-0 flex-1 truncate text-[0.7rem] font-bold text-stone-500">参考: P.{win.pageNumber}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={surfaceIconButton}
                onClick={() => onWindowUpdate({ ...win, dockMode: 'right-half', x: undefined, y: undefined, width: undefined, height: undefined })}
                title="吸附"
              >
                <Columns2 size={14} strokeWidth={2.5} />
              </button>
              <button type="button" className={dangerIconButton} onClick={() => onWindowClose(win.id)} title="关闭"><X size={14} strokeWidth={2.5} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ReaderViewport pageNumber={win.pageNumber} windowId={win.id} />
          </div>
          <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize bg-[linear-gradient(135deg,transparent_50%,var(--border)_50%)] hover:bg-[linear-gradient(135deg,transparent_50%,#1c1917_50%)]" onMouseDown={(e) => handleResizeStart(e, win)} />
        </div>
      ))}
    </div>
  );
};
