import React, { useState } from 'react';
import { ReaderWindow } from '../../types/domain';
import { ReaderViewport } from '../reader/ReaderViewport';
import '../../styles/WorkspaceCanvas.css';

/**
 * WorkspaceCanvas (多窗口容器)
 * 职责：管理多个阅读窗口的布局、吸附和层级。
 */
export const WorkspaceCanvas: React.FC = () => {
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

  const addWindow = (page: number) => {
    const newWin: ReaderWindow = {
      id: `float-${Date.now()}`,
      type: 'floating',
      pageNumber: page,
      title: `Reference Page ${page}`,
      dockMode: 'none',
      zIndex: windows.length + 1,
      isActive: true,
      canClose: true,
      x: 100 + windows.length * 20,
      y: 100 + windows.length * 20,
      width: 400,
      height: 500,
    };
    setWindows([...windows, newWin]);
  };

  return (
    <div className="workspace-canvas">
      {windows.map(win => (
        <div 
          key={win.id}
          className={`reader-window-container ${win.type} ${win.isActive ? 'active' : ''} dock-${win.dockMode}`}
          style={{
            zIndex: win.zIndex,
            left: win.x,
            top: win.y,
            width: win.width,
            height: win.height,
          }}
        >
          <div className="window-header">
            <span className="window-title">{win.title}</span>
            {win.canClose && <button className="close-win-btn">×</button>}
          </div>
          <div className="window-body">
            <ReaderViewport initialPage={win.pageNumber} />
          </div>
        </div>
      ))}
      
      {/* 临时的多窗口添加按钮，供 UI 验证使用 */}
      <button 
        className="add-ref-btn"
        onClick={() => addWindow(Math.floor(Math.random() * 100))}
      >
        + New Ref Window
      </button>
    </div>
  );
};
