import { useState, type ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeldPagesPanel } from '../../components/held-pages/HeldPagesPanel';
import type { HeldPage } from '../../types/domain';
import { HELD_NAME_LIMIT, HELD_NOTE_LIMIT } from '../../utils/heldPageMetadata';
import { ThumbnailActions } from '../../services/ThumbnailActions';

vi.mock('../../components/thumbnails/CachedThumbnail', () => ({ CachedThumbnail: () => null }));
const held: HeldPage = { id: 'held-8', pageNumber: 8, defaultName: '第 8 页', customName: '证明', note: '对照第二章', createdAt: '2026-10-01', isOpen: false, linkedWindowIds: [] };
const props = (overrides: Partial<ComponentProps<typeof HeldPagesPanel>> = {}) => ({
  pages: [held], interactionKey: 'book:main', metadataContextKey: 'session:1:3', onReadPage: vi.fn(), onPageClick: vi.fn(), onRemovePage: vi.fn(), onUpdateMetadata: vi.fn().mockReturnValue(true), ...overrides,
});
const open = () => fireEvent.click(screen.getByRole('button', { name: '编辑第 8 页名称和备注' }));
const editor = () => screen.queryByRole('form', { name: '编辑第 8 页名称和备注' });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('held-page name and note editor', () => {
  it('edits Chinese text/multiline notes without navigation and returns focus on save', async () => {
    const callbacks = props(); render(<HeldPagesPanel {...callbacks} />); open();
    expect(screen.getByRole('textbox', { name: '名称' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '阅读第 8 页' }).closest('[inert]')).not.toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '定义：极限' } });
    fireEvent.change(screen.getByRole('textbox', { name: '备注' }), { target: { value: '先看图示\n再读证明' } });
    expect(callbacks.onUpdateMetadata).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(callbacks.onUpdateMetadata).toHaveBeenCalledExactlyOnceWith(held.id, { customName: '定义：极限', note: '先看图示\n再读证明' });
    expect(callbacks.onReadPage).not.toHaveBeenCalled(); expect(callbacks.onPageClick).not.toHaveBeenCalled();
    expect(editor()).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑第 8 页名称和备注' })).toHaveFocus());
  });
  it.each(['cancel', 'escape'])('discards with %s and reopens saved values', async method => {
    const callbacks = props(); render(<HeldPagesPanel {...callbacks} />); open();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '不要保存' } });
    if (method === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消' }));
    else fireEvent.keyDown(screen.getByRole('textbox', { name: '名称' }), { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑第 8 页名称和备注' })).toHaveFocus());
    expect(callbacks.onUpdateMetadata).not.toHaveBeenCalled();
    open(); expect(screen.getByRole('textbox', { name: '名称' })).toHaveValue('证明');
  });
  it('keeps composing Enter and Escape local; ordinary Enter saves and textarea Enter is a newline', async () => {
    const callbacks = props(); const globalKey = vi.fn(); window.addEventListener('keydown', globalKey);
    try {
      render(<HeldPagesPanel {...callbacks} />); open(); const name = screen.getByRole('textbox', { name: '名称' });
      fireEvent.compositionStart(name);
      fireEvent.change(name, { target: { value: '定义' } });
      fireEvent.keyDown(name, { key: 'Enter', isComposing: true, keyCode: 229 });
      fireEvent.submit(editor()!);
      fireEvent.keyDown(name, { key: 'Escape', isComposing: true });
      expect(editor()).toBeInTheDocument(); expect(callbacks.onUpdateMetadata).not.toHaveBeenCalled(); expect(globalKey).not.toHaveBeenCalled();
      fireEvent.compositionEnd(name);
      // Safari-style ordering: composition has ended, but this Enter still
      // belongs to the IME. userEvent supplies real implicit form submission.
      name.addEventListener('keydown', event => { Object.defineProperty(event, 'keyCode', { value: 229 }); }, { once: true, capture: true });
      const user = userEvent.setup(); await user.keyboard('{Enter}');
      expect(callbacks.onUpdateMetadata).not.toHaveBeenCalled();
      await user.click(screen.getByRole('textbox', { name: '备注' })); await user.keyboard('{Enter}');
      expect(callbacks.onUpdateMetadata).not.toHaveBeenCalled();
      await user.click(name); await user.keyboard('{Enter}');
      expect(callbacks.onUpdateMetadata).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('keydown', globalKey); }
  });
  it('shows limits without truncating composition or legacy values and permits an unchanged legacy save', () => {
    const callbacks = props({ pages: [{ ...held, customName: 'X'.repeat(100), note: '旧'.repeat(800) }] });
    render(<HeldPagesPanel {...callbacks} />); open();
    expect(screen.getByRole('textbox', { name: '名称' })).toHaveValue('X'.repeat(100));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(callbacks.onUpdateMetadata).toHaveBeenLastCalledWith(held.id, {});
    open(); fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '📖'.repeat(HELD_NAME_LIMIT) } });
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: '备注' }), { target: { value: '字'.repeat(HELD_NOTE_LIMIT + 1) } });
    expect(screen.getByRole('textbox', { name: '备注' })).toHaveValue('字'.repeat(HELD_NOTE_LIMIT + 1));
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('名称最多 80 字，备注最多 500 字');
  });
  it('clears a name to the default after an explicit save and displays metadata in both modes', () => {
    function Panel() {
      const [pages, setPages] = useState([held]);
      return <HeldPagesPanel {...props()} pages={pages} onUpdateMetadata={(id, changes) => { setPages(pages.map(page => page.id === id ? { ...page, ...changes } : page)); return true; }} />;
    }
    render(<Panel />); open(); fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getAllByText('第 8 页')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '列表视图' })); expect(screen.getByText('对照第二章')).toBeInTheDocument();
  });
  it.each(['context', 'removal', 'list'])('retires a draft after %s and does not revive it', kind => {
    const callbacks = props(); const { rerender } = render(<HeldPagesPanel {...callbacks} />); open();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '旧草稿' } });
    if (kind === 'context') rerender(<HeldPagesPanel {...callbacks} metadataContextKey="another-session" />);
    if (kind === 'removal') rerender(<HeldPagesPanel {...callbacks} pages={[]} />);
    if (kind === 'list') fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(editor()).not.toBeInTheDocument(); rerender(<HeldPagesPanel {...callbacks} />); expect(editor()).not.toBeInTheDocument();
    expect(callbacks.onUpdateMetadata).not.toHaveBeenCalled();
  });
  it('keeps a draft through non-retiring metadata updates and ordinary window blur', () => {
    const callbacks = props(); const { rerender } = render(<HeldPagesPanel {...callbacks} />); open();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '继续写' } });
    fireEvent(window, new Event('blur'));
    rerender(<HeldPagesPanel {...callbacks} pages={[{ ...held, thumbnailKey: 'new', isOpen: true, linkedWindowIds: ['reference'] }]} />);
    expect(screen.getByRole('textbox', { name: '名称' })).toHaveValue('继续写');
  });
  it('cancels delayed read transactions and ignores a stale double click while editing', async () => {
    vi.useFakeTimers(); const transaction = { commit: vi.fn(), rollback: vi.fn(), dispose: vi.fn() };
    const callbacks = props({ onPrepareReadPage: () => transaction }); render(<HeldPagesPanel {...callbacks} />);
    const read = screen.getByRole('button', { name: '阅读第 8 页' }); fireEvent.click(read, { detail: 1 }); open(); fireEvent.doubleClick(read);
    await act(async () => vi.advanceTimersByTime(600));
    expect(transaction.dispose).toHaveBeenCalledOnce(); expect(transaction.commit).not.toHaveBeenCalled(); expect(transaction.rollback).not.toHaveBeenCalled();
    expect(callbacks.onReadPage).not.toHaveBeenCalled(); expect(callbacks.onPageClick).not.toHaveBeenCalled(); expect(editor()).toBeInTheDocument();
  });
  it('cancels a pending long press and refuses to edit while a thumbnail menu owns input', async () => {
    vi.useFakeTimers(); const controller = new ThumbnailActions(); const callbacks = props({ thumbnailActions: controller }); render(<HeldPagesPanel {...callbacks} />);
    const read = screen.getByRole('button', { name: '阅读第 8 页' });
    fireEvent(read, Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0 }));
    open(); await act(async () => vi.advanceTimersByTime(600)); expect(controller.ownsInput()).toBe(false); expect(editor()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    controller.open({ pageNumber: 8, opener: read, isCurrent: () => true, actions: [] }, { pointerId: 2, clientX: 0, clientY: 0 }, controller.getRevision());
    open(); expect(editor()).not.toBeInTheDocument(); controller.dispose();
  });
  it('retains failed-save input for recovery, and does not steal newer focus after cancel', async () => {
    vi.useFakeTimers(); const callbacks = props({ onUpdateMetadata: vi.fn().mockReturnValue(false) }); render(<HeldPagesPanel {...callbacks} />); open();
    fireEvent.click(screen.getByRole('button', { name: '保存' })); expect(screen.getByRole('alert')).toHaveTextContent('这张夹页已发生变化');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    const other = screen.getByRole('button', { name: '列表视图' }); other.focus();
    await act(async () => vi.advanceTimersByTime(20)); expect(other).toHaveFocus();
  });
});
