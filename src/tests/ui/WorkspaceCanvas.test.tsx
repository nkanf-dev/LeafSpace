import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCanvas } from '../../components/workspace/WorkspaceCanvas';
import { ReaderViewport } from '../../components/reader/ReaderViewport';
import { useBookStore } from '../../stores/bookStore';
import { windowStore } from '../../stores/windowStore';
import type { ReaderWindow } from '../../types/domain';

vi.mock('../../components/reader/ReaderViewport', () => ({
  ReaderViewport: ({ isMain, pageNumber, windowId }: ComponentProps<typeof ReaderViewport>) => (
    <div data-testid={`viewport-${windowId}`} data-main={isMain} data-page={pageNumber} />
  ),
}));

const mainWindow: ReaderWindow = {
  id: 'main', type: 'main', pageNumber: 1, title: 'Main', dockMode: 'none',
  zIndex: 1, isActive: true, canClose: false,
};
const floatingWindow: ReaderWindow = {
  id: 'reference', type: 'floating', pageNumber: 8, title: 'Page 8', dockMode: 'none',
  zIndex: 2, isActive: false, canClose: true, x: 100, y: 100, width: 420, height: 560,
};
const dockedWindow: ReaderWindow = {
  ...floatingWindow, type: 'docked', dockMode: 'right-half', splitRatio: 0.6,
};
function renderWorkspace(windows: ReaderWindow[]) {
  const onWindowUpdate = vi.fn<(window: ReaderWindow) => void>();
  const onWindowClose = vi.fn<(id: string) => void>();
  const result = render(<WorkspaceCanvas windows={windows} onWindowUpdate={onWindowUpdate} onWindowClose={onWindowClose} />);
  const canvas = result.container.firstElementChild;
  if (!(canvas instanceof HTMLElement)) throw new Error('Workspace root was not rendered');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 800));
  return { ...result, onWindowUpdate, onWindowClose, canvas };
}

describe('WorkspaceCanvas', () => {
  beforeEach(() => {
    useBookStore.getState().reset();
    windowStore.getState().reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the main reader without a close action', () => {
    renderWorkspace([mainWindow]);
    expect(screen.getByTestId('viewport-main')).toHaveAttribute('data-main', 'true');
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('renders floating reference pages and closes only the requested window', () => {
    const { onWindowClose } = renderWorkspace([mainWindow, floatingWindow]);
    expect(screen.getByText('参考: P.8')).toBeInTheDocument();
    expect(screen.getByTestId('viewport-reference')).toHaveAttribute('data-page', '8');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onWindowClose).toHaveBeenCalledExactlyOnceWith('reference');
  });

  it('docks a floating window and resets floating geometry', () => {
    const { onWindowUpdate } = renderWorkspace([mainWindow, floatingWindow]);
    fireEvent.click(screen.getByRole('button', { name: '吸附' }));
    expect(onWindowUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'reference', dockMode: 'right-half', splitRatio: 0.64,
      x: undefined, y: undefined, width: undefined, height: undefined,
    }));
  });

  it('renders a split pane and returns it to a floating window', () => {
    const { onWindowUpdate } = renderWorkspace([mainWindow, dockedWindow]);
    expect(screen.getByRole('separator', { name: '调整主窗口与分栏宽度' })).toBeInTheDocument();
    expect(screen.getByText('对比')).toBeInTheDocument();
    expect(screen.getByTestId('viewport-reference')).toHaveAttribute('data-page', '8');
    fireEvent.click(screen.getByRole('button', { name: '浮动' }));
    expect(onWindowUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'reference', dockMode: 'none', x: 72, y: 72, width: 420, height: 560,
    }));
  });

  it('swaps the split page with the main reader through the window store', () => {
    useBookStore.getState().setDocumentReady({ documentId: 'canvas', totalPages: 20 });
    windowStore.getState().restoreWindows([mainWindow, dockedWindow], 'reference');
    renderWorkspace(windowStore.getState().windows);
    fireEvent.click(screen.getByRole('button', { name: '交换' }));
    expect(useBookStore.getState().currentPage).toBe(8);
    expect(windowStore.getState().windows.find(window => window.id === 'reference')?.pageNumber).toBe(1);
  });

  it('clamps split resizing and stops reacting after the mouse is released', () => {
    const { onWindowUpdate } = renderWorkspace([mainWindow, dockedWindow]);
    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 600 });
    fireEvent.mouseMove(window, { clientX: 2000 });
    expect(onWindowUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ splitRatio: 0.8 }));
    fireEvent.mouseMove(window, { clientX: -1000 });
    expect(onWindowUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ splitRatio: 0.35 }));
    fireEvent.mouseUp(window);
    onWindowUpdate.mockClear();
    fireEvent.mouseMove(window, { clientX: 500 });
    expect(onWindowUpdate).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass('is-panning');
  });

  it('raises and keeps a dragged floating window inside the workspace', () => {
    const { onWindowUpdate } = renderWorkspace([mainWindow, floatingWindow]);
    const title = screen.getByText('参考: P.8');
    const floating = title.closest('[data-floating-window]');
    if (!(floating instanceof HTMLElement)) throw new Error('Floating window was not rendered');
    vi.spyOn(floating, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 420, 560));
    fireEvent.mouseDown(title, { clientX: 110, clientY: 110 });
    expect(onWindowUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'reference', isActive: true, zIndex: 3 }));
    fireEvent.mouseMove(window, { clientX: 2000, clientY: 2000 });
    expect(onWindowUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ x: 568, y: 228 }));
    fireEvent.mouseMove(window, { clientX: -100, clientY: -100 });
    expect(onWindowUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ x: 12, y: 12 }));
    fireEvent.mouseUp(window);
  });

  it('cleans up document styles and drag listeners on unmount', () => {
    const { onWindowUpdate, unmount } = renderWorkspace([mainWindow, floatingWindow]);
    fireEvent.mouseDown(screen.getByText('参考: P.8'), { clientX: 10, clientY: 10 });
    expect(document.body).toHaveClass('is-panning');
    unmount();
    onWindowUpdate.mockClear();
    fireEvent.mouseMove(window, { clientX: 300, clientY: 300 });
    expect(onWindowUpdate).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass('is-panning');
  });
});
