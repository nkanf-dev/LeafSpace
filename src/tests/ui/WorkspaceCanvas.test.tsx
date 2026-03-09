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
});
