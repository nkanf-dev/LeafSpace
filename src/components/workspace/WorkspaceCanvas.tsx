import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ReaderWindow } from '../../types/domain';
import { ReaderViewport } from '../reader/ReaderViewport';
import '../../styles/WorkspaceCanvas.css';

interface Props {
  windows: ReaderWindow[];
  onWindowUpdate: (updatedWindow: ReaderWindow) => void;
  onWindowClose: (id: string) => void;
}

/**
 * WorkspaceCanvas (多窗口容器)
 * 职责：管理多个阅读窗口的布局、吸附和拖拽交互。
 * 状态隔离：受控组件模式。
 */
export const WorkspaceCanvas: React.FC<Props> = ({ windows, onWindowUpdate, onWindowClose }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  
  // 使用 Ref 保持对最新 windows 的引用，避免 mousemove 闭包问题
  const windowsRef = useRef(windows);
  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  // 处理拖拽开始
  const handleMouseDown = (e: React.MouseEvent, win: ReaderWindow) => {
    if (win.type === 'main') return;

    setDraggingId(win.id);
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    
    // 激活窗口 (置顶)
    onWindowUpdate({ 
      ...win, 
      isActive: true, 
      zIndex: Math.max(...windowsRef.current.map(w => w.zIndex), 0) + 1 
    });
  };

  // 处理拖拽移动 (全局监听)
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingId) return;

    const win = windowsRef.current.find(w => w.id === draggingId);
    if (!win) return;

    const newX = e.clientX - dragOffset.current.x;
    const newY = e.clientY - dragOffset.current.y;

    onWindowUpdate({
      ...win,
      x: newX,
      y: newY,
    });
  }, [draggingId, onWindowUpdate]);

  // 处理拖拽结束
  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  useEffect(() => {
    if (draggingId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, handleMouseMove, handleMouseUp]);

  return (
    <div className="workspace-canvas">
      {windows.map(win => (
        <div 
          key={win.id}
          className={`reader-window-container ${win.type} ${win.isActive ? 'active' : ''} ${draggingId === win.id ? 'dragging' : ''}`}
          style={{
            zIndex: win.zIndex,
            left: win.type === 'main' ? 0 : win.x,
            top: win.type === 'main' ? 0 : win.y,
            width: win.type === 'main' ? '100%' : win.width,
            height: win.type === 'main' ? '100%' : win.height,
            position: win.type === 'main' ? 'relative' : 'absolute',
          }}
        >
          <div 
            className="window-header" 
            onMouseDown={(e) => handleMouseDown(e, win)}
            style={{ cursor: win.type === 'main' ? 'default' : 'grab' }}
          >
            <span className="window-title">{win.title}</span>
            {win.canClose && (
              <button 
                className="close-win-btn" 
                onClick={(e) => {
                  e.stopPropagation();
                  onWindowClose(win.id);
                }}
              >
                ×
              </button>
            )}
          </div>
          <div className="window-body">
            <ReaderViewport initialPage={win.pageNumber} />
          </div>
        </div>
      ))}
    </div>
  );
};
