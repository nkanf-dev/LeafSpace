import { useState, type ComponentProps } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HeldPagesPanel } from '../../components/held-pages/HeldPagesPanel';
import type { HeldPage } from '../../types/domain';

vi.mock('../../components/thumbnails/CachedThumbnail', () => ({
  CachedThumbnail: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}));

const heldPage: HeldPage = {
  id: 'held-8', pageNumber: 8, defaultName: '第 8 页', customName: '重要结论',
  note: '对照第二章', createdAt: '2026-09-30T00:00:00.000Z',
  isOpen: false, linkedWindowIds: [],
};
function props(overrides: Partial<ComponentProps<typeof HeldPagesPanel>> = {}) {
  return {
    pages: [heldPage], onReadPage: vi.fn<(page: HeldPage) => void>(),
    onPageClick: vi.fn<(page: HeldPage) => void>(), onRemovePage: vi.fn<(id: string) => void>(),
    ...overrides,
  };
}

describe('HeldPagesPanel', () => {
  it('confines scrolling to its content while its header keeps a fixed row', () => {
    const { container } = render(<HeldPagesPanel {...props()} />);
    expect(container.firstElementChild).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden');
    expect(container.firstElementChild).not.toHaveClass('h-full');
    expect(screen.getByRole('heading', { name: '夹住的页面 (1)' }).parentElement).toHaveClass('shrink-0');
  });

  it('explains how to hold, read, and compare pages in the empty state', () => {
    render(<HeldPagesPanel {...props({ pages: [] })} />);
    expect(screen.getByRole('heading', { name: '夹住的页面 (0)' })).toBeInTheDocument();
    expect(screen.getByText('留住值得对照的一页')).toBeInTheDocument();
    expect(screen.getByText(/在阅读区按 ↑/)).toHaveTextContent('点击夹页回到该页；双击或点击对照按钮，打开参考窗口');
    expect(screen.queryByRole('button', { name: /阅读第/ })).not.toBeInTheDocument();
  });

  it('reads a held page once on a single click without opening a reference', async () => {
    const callbacks = props();
    render(<HeldPagesPanel {...callbacks} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '阅读第 8 页' }));
    await waitFor(() => expect(callbacks.onReadPage).toHaveBeenCalledExactlyOnceWith(heldPage));
    expect(callbacks.onPageClick).not.toHaveBeenCalled();
    expect(callbacks.onRemovePage).not.toHaveBeenCalled();
  });

  it('opens exactly one reference on a native double click', async () => {
    const callbacks = props();
    render(<HeldPagesPanel {...callbacks} />);
    await userEvent.setup().dblClick(screen.getByRole('button', { name: '阅读第 8 页' }));
    expect(callbacks.onReadPage).not.toHaveBeenCalled();
    expect(callbacks.onPageClick).toHaveBeenCalledExactlyOnceWith(heldPage);
    expect(callbacks.onRemovePage).not.toHaveBeenCalled();
  });

  it('opens a reference through the explicit touch control without reading or removing it', async () => {
    const callbacks = props();
    render(<HeldPagesPanel {...callbacks} />);
    const reference = screen.getByRole('button', { name: '打开第 8 页参考窗口' });
    await userEvent.setup().pointer([{ keys: '[TouchA>]', target: reference }, { keys: '[/TouchA]' }]);
    expect(callbacks.onPageClick).toHaveBeenCalledExactlyOnceWith(heldPage);
    expect(callbacks.onReadPage).not.toHaveBeenCalled();
    expect(callbacks.onRemovePage).not.toHaveBeenCalled();
  });

  it('removes a page through a separate button without triggering read/reference actions', async () => {
    const callbacks = props();
    render(<HeldPagesPanel {...callbacks} />);
    const remove = screen.getByRole('button', { name: '移除第 8 页夹页' });
    expect(remove.parentElement?.closest('button')).toBeNull();
    await userEvent.setup().click(remove);
    expect(callbacks.onRemovePage).toHaveBeenCalledExactlyOnceWith('held-8');
    expect(callbacks.onReadPage).not.toHaveBeenCalled();
    expect(callbacks.onPageClick).not.toHaveBeenCalled();
  });

  it('retains the original click handler when the optional read action is absent', async () => {
    const callbacks = props({ onReadPage: undefined });
    render(<HeldPagesPanel {...callbacks} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '阅读第 8 页' }));
    await waitFor(() => expect(callbacks.onPageClick).toHaveBeenCalledExactlyOnceWith(heldPage));
  });

  it('shows held-page metadata and toggles between card and list layouts', async () => {
    render(<HeldPagesPanel {...props({ pages: [{ ...heldPage, isOpen: true, linkedWindowIds: ['reference'] }] })} />);
    expect(screen.getByText('重要结论')).toBeInTheDocument();
    expect(screen.getByText('对照第二章')).toBeInTheDocument();
    expect(screen.getByText('第 8 页 · 已打开')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '第 8 页缩略图' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '列表视图' }));
    expect(screen.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('img', { name: '第 8 页缩略图' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '阅读第 8 页' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '卡片视图' }));
    expect(screen.getByRole('button', { name: '卡片视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: '第 8 页缩略图' })).toBeInTheDocument();
  });

  it.each(['click', 'escape'])('restores the remove opener when cancelling by %s', async method => {
    const callbacks = props({ pages: [{ ...heldPage, isOpen: true, linkedWindowIds: ['reference'] }] });
    render(<HeldPagesPanel {...callbacks} />);
    const user = userEvent.setup();
    const remove = screen.getByRole('button', { name: '移除第 8 页夹页' });
    await user.click(remove);
    if (method === 'click') await user.click(screen.getByRole('button', { name: '取消' }));
    else await user.keyboard('{Escape}');
    await waitFor(() => expect(remove).toHaveFocus());
    expect(callbacks.onRemovePage).not.toHaveBeenCalled();
  });

  it('keeps covered controls inert and moves focus to the next page or empty heading after removal', async () => {
    function InteractivePanel() {
      const [pages, setPages] = useState([
        { ...heldPage, isOpen: true, linkedWindowIds: ['reference'] },
        { ...heldPage, id: 'held-9', pageNumber: 9 },
      ]);
      return <HeldPagesPanel {...props()} pages={pages} onRemovePage={id => setPages(current => current.filter(page => page.id !== id))} />;
    }
    render(<InteractivePanel />);
    const user = userEvent.setup();
    const remove = screen.getByRole('button', { name: '移除第 8 页夹页' });
    await user.click(remove);
    expect(remove.closest('[inert]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: '保留窗口' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '阅读第 9 页' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: '移除第 9 页夹页' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '夹住的页面 (0)' })).toHaveFocus());
  });
});
