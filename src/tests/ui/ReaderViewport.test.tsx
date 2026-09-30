import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderViewport } from '../../components/reader/ReaderViewport';
import { useBookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';

// Exercise reader behavior against real stores without a canvas/PDF worker.
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: ({ children }: ComponentProps<'div'>) => <div>{children}</div>,
  Page: ({ pageNumber, scale }: { pageNumber: number; scale: number }) => (
    <div data-testid="pdf-page" data-page={pageNumber} data-scale={scale} />
  ),
}));
vi.mock('../../services/ThumbnailService', () => ({
  thumbnailService: {
    ensureThumbnail: vi.fn().mockResolvedValue(undefined),
    getThumbnailKey: (page: number) => `test_${page}_240`,
  },
}));

function loadDocument(currentPage = 3, scale = 1) {
  useBookStore.getState().setDocumentReady({
    documentId: 'reader-test', documentUrl: 'memory://reader.pdf', totalPages: 20,
    initialPage: currentPage, scale,
  });
}

function readerRegion() {
  return screen.getByRole('region', { name: /阅读区/ });
}

describe('ReaderViewport', () => {
  beforeEach(() => {
    useBookStore.getState().reset();
    heldStore.getState().reset();
    windowStore.getState().reset();
  });

  it('shows the waiting state before a document is loaded', () => {
    render(<ReaderViewport isMain windowId="main" />);
    expect(screen.getByText('等待载入...')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-page')).not.toBeInTheDocument();
  });

  it('uses bookStore as the source of the main page and scale', () => {
    loadDocument(7, 1.5);
    render(<ReaderViewport pageNumber={1} isMain windowId="main" />);
    expect(screen.getByText('主视角')).toBeInTheDocument();
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '7');
    expect(screen.getByText('150%')).toBeInTheDocument();
    act(() => useBookStore.getState().setCurrentPage(12));
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '12');
  });

  it.each([
    ['放大', 1.2, '120%'],
    ['缩小', 0.8, '80%'],
  ] as const)('persists main-reader %s through bookStore', (name, scale, label) => {
    loadDocument();
    render(<ReaderViewport isMain windowId="main" />);
    fireEvent.click(screen.getByRole('button', { name }));
    expect(useBookStore.getState().scale).toBeCloseTo(scale);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(windowStore.getState().windows[0].viewport?.scale).toBeCloseTo(scale);
  });

  it('keeps reference zoom independent of the main-reader scale', () => {
    loadDocument(3, 1.5);
    const id = windowStore.getState().openInNewWindow(8);
    windowStore.getState().updateWindow(id, { viewport: { scale: 2, mode: 'pointer' } });
    render(<ReaderViewport pageNumber={8} windowId={id} />);
    expect(screen.getByText('参考 P.8')).toBeInTheDocument();
    expect(screen.getByText('200%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(screen.getByText('240%')).toBeInTheDocument();
    expect(useBookStore.getState().scale).toBe(1.5);
    expect(windowStore.getState().windows.find(window => window.id === id)?.viewport?.scale).toBeCloseTo(2.4);
  });

  it('changes and restores the interaction mode', () => {
    loadDocument();
    const first = render(<ReaderViewport isMain windowId="main" />);
    fireEvent.click(screen.getByRole('button', { name: '选择文字' }));
    expect(screen.getByRole('button', { name: '选择文字' })).toHaveAttribute('aria-pressed', 'true');
    expect(windowStore.getState().windows[0].viewport?.mode).toBe('pointer');
    first.unmount();
    render(<ReaderViewport isMain windowId="main" />);
    expect(screen.getByRole('button', { name: '选择文字' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clamps keyboard navigation at the document boundaries and ignores modified shortcuts', () => {
    loadDocument(1);
    render(<ReaderViewport isMain windowId="main" />);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowLeft' });
    expect(useBookStore.getState().currentPage).toBe(1);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight', ctrlKey: true });
    expect(useBookStore.getState().currentPage).toBe(1);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight' });
    expect(useBookStore.getState().currentPage).toBe(2);
    act(() => useBookStore.getState().setCurrentPage(20));
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight' });
    expect(useBookStore.getState().currentPage).toBe(20);
  });

  it('navigates a reference window without changing the main page and activates it on focus', () => {
    loadDocument(3);
    const id = windowStore.getState().openInNewWindow(8);
    windowStore.getState().setActiveWindow('main');
    render(<ReaderViewport pageNumber={8} windowId={id} />);
    fireEvent.focus(readerRegion());
    expect(windowStore.getState().activeWindowId).toBe(id);
    fireEvent.keyDown(readerRegion(), { key: 'ArrowRight' });
    expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(9);
    expect(useBookStore.getState().currentPage).toBe(3);
  });

  it('holds the active page with ArrowUp without creating duplicate held pages', async () => {
    loadDocument(6);
    render(<ReaderViewport isMain windowId="main" />);
    await act(async () => {
      fireEvent.keyDown(readerRegion(), { key: 'ArrowUp' });
      fireEvent.keyDown(readerRegion(), { key: 'ArrowUp' });
    });
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([6]);
  });

  it('allows normal wheel scrolling and reserves zoom for Ctrl or Meta + wheel', () => {
    loadDocument();
    render(<ReaderViewport isMain windowId="main" />);
    const normalScroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    fireEvent(readerRegion(), normalScroll);
    expect(normalScroll.defaultPrevented).toBe(false);
    expect(useBookStore.getState().scale).toBe(1);
    fireEvent.wheel(readerRegion(), { deltaY: -100, ctrlKey: true });
    expect(useBookStore.getState().scale).toBeGreaterThan(1);
  });

  it('restores and persists viewport scroll offsets', () => {
    loadDocument();
    windowStore.getState().updateWindow('main', { viewport: { scrollLeft: 120, scrollTop: 240 } });
    render(<ReaderViewport isMain windowId="main" />);
    expect(readerRegion().scrollLeft).toBe(120);
    expect(readerRegion().scrollTop).toBe(240);
    fireEvent.scroll(readerRegion(), { target: { scrollLeft: 150, scrollTop: 320 } });
    expect(windowStore.getState().windows[0].viewport).toMatchObject({ scrollLeft: 150, scrollTop: 320 });
  });

  it.each([[4, '放大'], [0.1, '缩小']] as const)('disables %s-scale zoom at the supported boundary', (scale, name) => {
    loadDocument(3, scale);
    render(<ReaderViewport isMain windowId="main" />);
    expect(screen.getByRole('button', { name })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name }));
    expect(useBookStore.getState().scale).toBe(scale);
  });

});
