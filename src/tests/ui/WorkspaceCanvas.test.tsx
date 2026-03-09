// @ts-nocheck

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WorkspaceCanvas } from '../../components/workspace/WorkspaceCanvas';
import type { ReaderWindow } from '../../types/domain';

describe('WorkspaceCanvas', () => {
  const mockWindows: ReaderWindow[] = [
    {
      id: 'main',
      type: 'main',
      pageNumber: 1,
      title: 'Main',
      dockMode: 'none',
      zIndex: 1,
      isActive: true,
      canClose: false,
    }
  ];

  it('renders the workspace canvas', () => {
    const { getByText } = render(
      <WorkspaceCanvas 
        windows={mockWindows} 
        onWindowUpdate={vi.fn()} 
        onWindowClose={vi.fn()} 
      />
    );
    expect(getByText('Main')).toBeDefined();
  });
});
