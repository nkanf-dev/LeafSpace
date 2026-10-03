import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { HeldPage } from '../../types/domain';
import { LayoutGrid, List, X, Columns2, ArrowUp, ArrowDown } from 'lucide-react';
import { CachedThumbnail } from '../thumbnails/CachedThumbnail';
import type { PreparedHeldRead } from '../../services/HeldReadTransaction';
import type { ThumbnailActions } from '../../services/ThumbnailActions';
import { useThumbnailLongPress } from '../../hooks/useThumbnailLongPress';

interface Props {
  pages: HeldPage[];
  thumbnailActions?: ThumbnailActions;
  actionsSuspended?: boolean;
  fallbackActionFocus?: () => HTMLElement | null;
  onPageClick: (page: HeldPage) => void;
  onReadPage?: (page: HeldPage) => void;
  onPrepareReadPage?: (page: HeldPage) => PreparedHeldRead;
  interactionKey?: string;
  onRemovePage: (id: string, closeReferences?: boolean) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

export const HeldPagesPanel: React.FC<Props> = ({ pages, thumbnailActions, actionsSuspended = false, fallbackActionFocus, onPageClick, onReadPage, onPrepareReadPage, interactionKey, onRemovePage, onReorder }) => {
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparedRead = useRef<{ id: string; transaction: PreparedHeldRead } | null>(null);
  const pointerType = useRef('mouse');
  const comparedOnClick = useRef(false);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const readButtons = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelRemoval = () => {
    const opener = pendingRemoval ? removeButtons.current.get(pendingRemoval) : undefined;
    setPendingRemoval(null);
    window.requestAnimationFrame(() => opener?.focus());
  };
  const removePage = (id: string, closeReferences?: boolean) => {
    const index = pages.findIndex(page => page.id === id);
    const nextId = pages[index + 1]?.id ?? pages[index - 1]?.id;
    if (closeReferences === undefined) onRemovePage(id);
    else onRemovePage(id, closeReferences);
    setPendingRemoval(null);
    window.requestAnimationFrame(() => (nextId ? readButtons.current.get(nextId) : headingRef.current)?.focus());
  };
  const cancelPendingRead = useCallback(() => {
    if (readTimer.current !== null) clearTimeout(readTimer.current);
    readTimer.current = null;
    preparedRead.current?.transaction.dispose();
    preparedRead.current = null;
  }, []);
  useEffect(() => thumbnailActions?.onInterrupt(cancelPendingRead), [cancelPendingRead, thumbnailActions]);
  const requestRemoval = (page: HeldPage) => {
    cancelPendingRead();
    if (page.linkedWindowIds.some(id => id !== 'main')) setPendingRemoval(page.id);
    else removePage(page.id);
  };
  const longPress = useThumbnailLongPress({
    controller: thumbnailActions, enabled: !actionsSuspended && pendingRemoval === null,
    contextKey: `${interactionKey}:${viewMode}:${pages.map(page => `${page.id}/${page.pageNumber}`).join(',')}`,
    request: (page: HeldPage, opener) => ({
      pageNumber: page.pageNumber, opener, fallbackFocus: () => fallbackActionFocus?.() ?? headingRef.current,
      actions: [
        { id: 'read', label: '阅读此页', run: () => (onReadPage ?? onPageClick)(page), focus: 'delegate' },
        { id: 'reference', label: '打开参考窗', run: () => onPageClick(page), focus: 'delegate' },
        { id: 'remove', label: '移除夹页', run: () => requestRemoval(page), focus: 'delegate' },
      ],
    }),
  });
  useEffect(() => () => {
    if (readTimer.current !== null) clearTimeout(readTimer.current);
    readTimer.current = null;
    preparedRead.current?.transaction.dispose(); preparedRead.current = null;
  }, [interactionKey]);
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth >= 1024) return;
      if (readTimer.current !== null) clearTimeout(readTimer.current);
      readTimer.current = null;
      preparedRead.current?.transaction.dispose(); preparedRead.current = null;
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 text-sm font-semibold text-stone-600">
        <h2 ref={headingRef} tabIndex={-1}>夹住的页面 ({pages.length})</h2>
        <div className="flex bg-[#f0ede9] p-0.5">
          <button type="button" aria-label="卡片视图" title="卡片视图" aria-pressed={viewMode === 'card'} className={`p-2 ${viewMode === 'card' ? 'bg-white shadow-sm' : 'opacity-60'}`} onClick={() => { cancelPendingRead(); setViewMode('card'); }}><LayoutGrid size={15} /></button>
          <button type="button" aria-label="列表视图" title="列表视图" aria-pressed={viewMode === 'list'} className={`p-2 ${viewMode === 'list' ? 'bg-white shadow-sm' : 'opacity-60'}`} onClick={() => { cancelPendingRead(); setViewMode('list'); }}><List size={15} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pages.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm leading-6 text-stone-500">
            <p className="mb-2 text-lg text-stone-700">留住值得对照的一页</p>
            <p>在阅读区按 ↑，或点击「夹住此页」。点击夹页回到该页；双击或点击对照按钮，打开参考窗口。</p>
          </div>
        ) : pages.map((page, index) => (
          <div key={page.id} onKeyDown={event => { if (event.key === 'Escape' && pendingRemoval === page.id) { event.preventDefault(); event.stopPropagation(); cancelRemoval(); } }} className={`relative mx-3 my-3 flex overflow-hidden border bg-white ${page.isOpen ? 'border-stone-700' : 'border-[var(--border)]'}`}>
            <div inert={pendingRemoval === page.id} className="flex min-w-0 flex-1">
            <button ref={element => { if (element) readButtons.current.set(page.id, element); else readButtons.current.delete(page.id); }} type="button" aria-label={`阅读第 ${page.pageNumber} 页`} onPointerDown={event => { pointerType.current = event.pointerType; if (event.pointerType === 'touch') cancelPendingRead(); longPress.onPointerDown(event, page); }} onContextMenu={longPress.onContextMenu} onClick={(event) => {
              if (thumbnailActions?.ownsInput()) return;
              if (event.detail > 1) return;
              cancelPendingRead();
              comparedOnClick.current = false;
              if (event.detail === 0) (onReadPage ?? onPageClick)(page);
              else if (event.shiftKey) { comparedOnClick.current = true; onPageClick(page); }
              else if (pointerType.current !== 'mouse' || window.innerWidth < 1024) (onReadPage ?? onPageClick)(page);
              else {
                const transaction = onPrepareReadPage?.(page);
                preparedRead.current = transaction ? { id: page.id, transaction } : null;
                readTimer.current = setTimeout(() => {
                  readTimer.current = null;
                  if (transaction) transaction.commit();
                  else (onReadPage ?? onPageClick)(page);
                }, 220);
              }
            }} onDoubleClick={() => {
              if (pointerType.current !== 'mouse' || window.innerWidth < 1024 || comparedOnClick.current) return;
              if (preparedRead.current?.id === page.id) preparedRead.current.transaction.rollback();
              cancelPendingRead(); onPageClick(page);
            }} className="thumbnail-action-target flex min-w-0 flex-1 items-center text-left transition hover:bg-stone-50">
              {viewMode === 'card' && <CachedThumbnail alt={`第 ${page.pageNumber} 页缩略图`} className="shrink-0 bg-[#f0ede9]" height={80} width={60} pageNumber={page.pageNumber} priority placeholder={<span className="p-3 text-stone-400">{page.pageNumber}</span>} />}
              <span className="min-w-0 flex-1 p-3">
                <span className="block text-xs text-stone-500">第 {page.pageNumber} 页{page.isOpen ? ' · 已打开' : ''}</span>
                <span className="mt-1 block truncate text-sm font-semibold text-stone-900">{page.customName || page.defaultName}</span>
                {page.note && <span className="mt-1 block truncate text-xs text-stone-500">{page.note}</span>}
              </span>
            </button>
            <div className="flex shrink-0 flex-col">
            <button type="button" className="p-3 text-stone-500 hover:text-stone-900" aria-label={`打开第 ${page.pageNumber} 页参考窗口`} title="打开参考窗口" onClick={() => { cancelPendingRead(); onPageClick(page); }}><Columns2 size={16} /></button>
            <button ref={element => { if (element) removeButtons.current.set(page.id, element); else removeButtons.current.delete(page.id); }} type="button" className="self-start p-3 text-stone-400 hover:text-red-700" onClick={() => requestRemoval(page)} aria-label={`移除第 ${page.pageNumber} 页夹页`} title="移除"><X size={16} /></button>
            </div>
            {onReorder && <div className="flex shrink-0 flex-col justify-center border-l border-[var(--border)]">
              <button className="p-2 text-stone-500 disabled:opacity-25" disabled={index === 0} aria-label={`上移第 ${page.pageNumber} 页夹页`} onClick={() => { cancelPendingRead(); onReorder(index, index - 1); }}><ArrowUp size={14} /></button>
              <button className="p-2 text-stone-500 disabled:opacity-25" disabled={index === pages.length - 1} aria-label={`下移第 ${page.pageNumber} 页夹页`} onClick={() => { cancelPendingRead(); onReorder(index, index + 1); }}><ArrowDown size={14} /></button>
            </div>}
            </div>
            {pendingRemoval === page.id && <div role="group" aria-label={`移除第 ${page.pageNumber} 页夹页选项`} className="absolute inset-0 flex flex-col justify-center gap-2 bg-[var(--surface)] p-3 text-xs">
              <p>这页仍在参考窗口中打开</p>
              <div className="flex flex-wrap gap-2">
                <button autoFocus className="border border-stone-500 px-2 py-1" onClick={() => removePage(page.id, false)}>保留窗口</button>
                <button className="border border-stone-500 px-2 py-1" onClick={() => removePage(page.id, true)}>同时关闭</button>
                <button className="px-1 py-1 underline" onClick={cancelRemoval}>取消</button>
              </div>
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
};
