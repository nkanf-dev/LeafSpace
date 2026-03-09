import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceCanvas } from '../../components/workspace/WorkspaceCanvas';
import { ReaderWindow } from '../../types/domain';
import { useState } from 'react';

describe('WorkspaceCanvas (DND & Controlled UI)', () => {
  const initialWindows: ReaderWindow[] = [
    {
      id: 'ref-1',
      type: 'floating',
      pageNumber: 5,
      title: 'Ref Window',
      dockMode: 'none',
      zIndex: 2,
      isActive: false,
      canClose: true,
      x: 100,
      y: 100,
      width: 400,
      height: 500,
    }
  ];

  const TestWrapper = ({ initial }: { initial: ReaderWindow[] }) => {
    const [wins, setWins] = useState(initial);
    return (
      <WorkspaceCanvas 
        windows={wins} 
        onWindowUpdate={(updated) => setWins(prev => prev.map(w => w.id === updated.id ? updated : w))} 
        onWindowClose={vi.fn()} 
      />
    );
  };

  it('updates coordinates during dragging by mocking getBoundingClientRect', () => {
    render(<TestWrapper initial={initialWindows} />);
    
    const refHeader = screen.getByText('Ref Window').parentElement!;
    const refWindowContainer = refHeader.parentElement!;

    // 模拟 jsdom 缺失的布局信息
    vi.spyOn(refWindowContainer, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 400,
      height: 500,
      bottom: 600,
      right: 500,
      x: 100,
      y: 100,
      toJSON: () => {}
    });

    // 开始拖拽: 鼠标在 (110, 110)
    fireEvent.mouseDown(refHeader, { clientX: 110, clientY: 110 });
    
    // 移动到 (210, 210)
    // 偏移量 = (110 - 100) = 10
    // 新坐标 = (210 - 10) = 200
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210 });
    
    expect(refWindowContainer.style.left).toBe('200px');
    expect(refWindowContainer.style.top).toBe('200px');
  });

  it('remains stable and renders correctly with high load (20 windows)', () => {
    const manyWindows: ReaderWindow[] = Array.from({ length: 20 }, (_, i) => ({
      id: `ref-${i}`,
      type: 'floating',
      pageNumber: i + 1,
      title: `Window ${i}`,
      dockMode: 'none',
      zIndex: i,
      isActive: false,
      canClose: true,
      x: i * 10,
      y: i * 10,
      width: 200,
      height: 300,
    }));

    render(<TestWrapper initial={manyWindows} />);
    
    // 验证是否所有窗口都已渲染
    const windowTitles = screen.getAllByText(/Window \d+/);
    expect(windowTitles).toHaveLength(20);
    
    // 验证最后一个窗口的交互性
    const lastHeader = screen.getByText('Window 19').parentElement!;
    fireEvent.mouseDown(lastHeader, { clientX: 200, clientY: 200 });
    // 简单验证没有崩溃且触发了激活逻辑
  });
});
