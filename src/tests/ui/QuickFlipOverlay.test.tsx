import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickFlipOverlay } from '../../components/quick-flip/QuickFlipOverlay';
import { useBookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';

vi.mock('../../services/ThumbnailService', () => ({
  thumbnailService: {
    ensureThumbnail: vi.fn().mockResolvedValue(undefined),
    ensureThumbnails: vi.fn().mockResolvedValue(undefined),
    getThumbnailKey: (page: number) => `test_${page}_240`,
  },
}));
vi.mock('../../components/thumbnails/CachedThumbnail', () => ({
  CachedThumbnail: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}));

function props(overrides = {}) {
  return {
    isVisible: true, onClose: vi.fn(), currentPage: 10, totalPages: 100,
    onPageChange: vi.fn(), ...overrides,
  };
}
function press(key: string) {
  fireEvent.keyDown(window, { key });
  fireEvent.keyUp(window, { key });
}
function pageButton(page: number) {
  return screen.getByRole('button', { name: `选择第 ${page} 页` });
}

describe('QuickFlipOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useBookStore.getState().reset();
    heldStore.getState().reset();
    windowStore.getState().reset();
    useBookStore.getState().setDocumentReady({
      documentId: 'quick-flip-test', documentUrl: 'memory://quick-flip.pdf',
      totalPages: 100, initialPage: 10,
    });
  });
  afterEach(() => vi.useRealTimers());

  it('renders the named dialog with keyboard help when visible', () => {
    render(<QuickFlipOverlay {...props()} />);
    expect(screen.getByRole('dialog', { name: '速翻视图' })).toBeInTheDocument();
    expect(screen.getByText('长按进入时间轴')).toBeInTheDocument();
    expect(pageButton(10)).toBeInTheDocument();
  });

  it('cancels on Escape without committing the previewed page', () => {
    const callbacks = props();
    render(<QuickFlipOverlay {...callbacks} />);
    press('ArrowRight');
    press('Escape');
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    expect(useBookStore.getState().currentPage).toBe(10);
  });

  it.each([['ArrowRight', 11], ['ArrowLeft', 9]] as const)(
    'previews %s and commits only on Enter', (key, target) => {
      const callbacks = props();
      render(<QuickFlipOverlay {...callbacks} />);
      press(key);
      expect(callbacks.onPageChange).not.toHaveBeenCalled();
      press('Enter');
      expect(callbacks.onPageChange).toHaveBeenCalledExactlyOnceWith(target);
      expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    },
  );

  it.each([[1, 'ArrowLeft'], [100, 'ArrowRight']] as const)(
    'clamps selection at page %i', (currentPage, key) => {
      const callbacks = props({ currentPage });
      render(<QuickFlipOverlay {...callbacks} />);
      press(key);
      press('Enter');
      expect(callbacks.onPageChange).toHaveBeenCalledWith(currentPage);
    },
  );

  it('selects a thumbnail without navigation and commits on double click', () => {
    const callbacks = props();
    render(<QuickFlipOverlay {...callbacks} />);
    fireEvent.click(pageButton(15));
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(pageButton(15));
    expect(callbacks.onPageChange).toHaveBeenCalledExactlyOnceWith(15);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it('opens a Shift-clicked page as a reference without navigating or dismissing', () => {
    const callbacks = props();
    render(<QuickFlipOverlay {...callbacks} />);
    fireEvent.click(pageButton(12), { shiftKey: true });
    expect(windowStore.getState().windows.some(window => window.type === 'floating' && window.pageNumber === 12)).toBe(true);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    expect(useBookStore.getState().currentPage).toBe(10);
  });

  it('holds and releases the previewed page using the up/down keys', async () => {
    render(<QuickFlipOverlay {...props()} />);
    press('ArrowRight');
    await act(async () => press('ArrowUp'));
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([11]);
    press('ArrowDown');
    expect(heldStore.getState().pages).toEqual([]);
  });

  it('resets cancelled selection when reopened at a different reader page', () => {
    const callbacks = props();
    const { rerender } = render(<QuickFlipOverlay {...callbacks} />);
    press('ArrowRight');
    rerender(<QuickFlipOverlay {...callbacks} isVisible={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<QuickFlipOverlay {...callbacks} currentPage={25} />);
    press('Enter');
    expect(callbacks.onPageChange).toHaveBeenCalledExactlyOnceWith(25);
  });

  it('enters accelerated timeline on a held arrow and returns after key release', () => {
    const callbacks = props();
    render(<QuickFlipOverlay {...callbacks} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(240));
    expect(screen.getByText('时间轴视图')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100));
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(181));
    expect(screen.queryByText('时间轴视图')).not.toBeInTheDocument();
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    press('Enter');
    expect(callbacks.onPageChange.mock.calls[0][0]).toBeGreaterThan(11);
  });

  it('removes listeners and pending acceleration work on unmount', () => {
    const callbacks = props();
    const { unmount } = render(<QuickFlipOverlay {...callbacks} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    unmount();
    act(() => vi.advanceTimersByTime(2_000));
    press('Enter');
    press('Escape');
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('neither renders nor handles keys while hidden', () => {
    const callbacks = props({ isVisible: false });
    const { container } = render(<QuickFlipOverlay {...callbacks} />);
    expect(container.firstChild).toBeNull();
    press('Enter');
    press('Escape');
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog, traps its edges, and restores the opener on dismissal', () => {
    render(<button type="button">打开速翻</button>);
    const opener = screen.getByRole('button', { name: '打开速翻' });
    opener.focus();
    const callbacks = props();
    const { rerender } = render(<QuickFlipOverlay {...callbacks} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    const first = screen.getByRole('button', { name: '关闭速翻' });
    const last = screen.getByRole('button', { name: '阅读此页' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    rerender(<QuickFlipOverlay {...callbacks} isVisible={false} />);
    expect(opener).toHaveFocus();
  });

  it('preserves native button keyboard activation and ignores modified navigation keys', () => {
    const callbacks = props();
    render(<QuickFlipOverlay {...callbacks} />);
    const close = screen.getByRole('button', { name: '关闭速翻' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Enter' });
    fireEvent.keyDown(close, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true });
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    expect(pageButton(10)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(close);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it('supports pointer-only preview, hold, and read actions', async () => {
    const callbacks = props();
    render(<QuickFlipOverlay {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '预览下一页' }));
    expect(pageButton(11)).toHaveAttribute('aria-pressed', 'true');
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '夹住此页' })));
    expect(heldStore.getState().pages.map(page => page.pageNumber)).toEqual([11]);
    fireEvent.click(screen.getByRole('button', { name: '阅读此页' }));
    expect(callbacks.onPageChange).toHaveBeenCalledExactlyOnceWith(11);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it('stops held-key acceleration when the browser loses focus', () => {
    const callbacks = props();
    render(<QuickFlipOverlay {...callbacks} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(240));
    fireEvent.blur(window);
    const positionAfterBlur = screen.getByText(/第 \d+ 页 \/ 共 100 页/).textContent;
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText(/第 \d+ 页 \/ 共 100 页/)).toHaveTextContent(positionAfterBlur!);
    expect(callbacks.onPageChange).not.toHaveBeenCalled();
  });

});
