import React, { useEffect, useRef, useState, useId } from 'react';
import type { TOCItem } from '../../types/domain';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  currentPage: number;
  totalPages: number;
  onPageClick: (page: number) => void;
  markers?: number[];
  chapters?: TOCItem[];
}

export const TimelineBar: React.FC<Props> = ({ currentPage, totalPages, onPageClick, markers = [], chapters = [] }) => {
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ page: number; origin: number; total: number } | null>(null);
  const previewPage = preview?.origin === currentPage && preview.total === totalPages ? preview.page : null;
  const drag = useRef<{ pointerId: number; page: number; canceled: boolean } | null>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const cancel = () => { if (drag.current) drag.current.canceled = true; setPreview(null); };
  useEffect(() => {
    // A navigation from another control invalidates this temporary selection.
    if (drag.current) drag.current.canceled = true;
  }, [currentPage, totalPages]);
  useEffect(() => {
    const onBlur = () => cancel();
    const onVisibility = () => { if (document.hidden) cancel(); };
    const onKey = (event: KeyboardEvent) => {
      if (drag.current && !drag.current.canceled && (event.key === 'Escape' || event.key === ' ')) {
        event.preventDefault(); event.stopPropagation(); cancel();
      }
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
  const displayedPage = previewPage ?? currentPage;
  const safeTotal = Math.max(1, totalPages);
  const progress = ((displayedPage - 1) / Math.max(1, safeTotal - 1)) * 100;
  return (
    <nav aria-label="阅读进度" className="flex h-full min-w-0 items-center gap-3 bg-[var(--surface)] px-3 sm:gap-6 sm:px-6">
      <button type="button" aria-label="上一页" tabIndex={0} disabled={currentPage <= 1 || !totalPages} onClick={() => onPageClick(currentPage - 1)} className="p-2 text-stone-700 disabled:opacity-30"><ChevronLeft size={20} /></button>
      <form className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-stone-600" onSubmit={event => {
        event.preventDefault();
        const value = Number(pageInput ?? currentPage);
        if (Number.isFinite(value) && (pageInput ?? String(currentPage)).trim()) onPageClick(Math.min(safeTotal, Math.max(1, Math.round(value))));
        setPageInput(null);
      }}>
        <input aria-label="输入页码" inputMode="numeric" value={pageInput ?? currentPage} onChange={event => setPageInput(event.target.value)} onBlur={() => setPageInput(null)} onFocus={event => event.target.select()} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPageInput(null); event.currentTarget.blur(); } }} className="w-14 border-b border-stone-400 bg-transparent px-1 text-center text-lg font-bold text-stone-900" />
        <span>/ {totalPages || '—'}</span>
        <button className="sr-only" type="submit">跳转</button>
      </form>
      <div className="relative flex h-10 min-w-0 flex-1 items-center">
        <div aria-hidden="true" className="absolute inset-x-0 h-0.5 bg-[var(--border)]" />
        <div aria-hidden="true" className="absolute left-0 h-0.5 bg-stone-800" style={{ width: `${progress}%` }} />
        <input ref={sliderRef} type="range" tabIndex={0} min={1} max={safeTotal} value={displayedPage} disabled={!totalPages} aria-label="跳转到页码" aria-describedby={hintId}
          aria-valuetext={`${previewPage === null ? '' : '预览：'}第 ${displayedPage} 页，共 ${totalPages} 页`}
          onPointerDown={event => {
            if (event.button !== 0 || (drag.current && !drag.current.canceled)) return;
            drag.current = { pointerId: event.pointerId, page: currentPage, canceled: false };
            setPreview({ page: currentPage, origin: currentPage, total: totalPages });
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onChange={event => {
            const page = Number(event.target.value);
            if (drag.current) { if (!drag.current.canceled) { drag.current.page = page; setPreview({ page, origin: currentPage, total: totalPages }); } }
            else onPageClick(page);
          }}
          onPointerUp={event => {
            if (drag.current?.pointerId !== event.pointerId) return;
            const { page, canceled } = drag.current;
            drag.current = null;
            setPreview(null);
            if (!canceled) onPageClick(page);
          }}
          onPointerCancel={() => { drag.current = null; setPreview(null); }} onLostPointerCapture={() => { drag.current = null; setPreview(null); }} onBlur={cancel}
          className="page-range relative z-10 w-full" style={{ touchAction: 'none' }} />
        <span id={hintId} className="sr-only">拖动预览页码，松开跳转；Esc 或空格取消。方向键直接翻页。</span>
        {previewPage !== null && <output aria-live="polite" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[min(18rem,85vw)] -translate-x-1/2 border border-stone-300 bg-[var(--surface)] px-3 py-2 text-center text-xs leading-5 text-stone-800 shadow-lg">
          预览第 {previewPage} 页<span className="block text-stone-600">松开跳转 · Esc 取消</span>
        </output>}
        {chapters.filter(item => item.level === 0).map(item => <button key={item.id} type="button" aria-label={`跳转到章节：${item.title}`} title={`${item.title} · 第 ${item.page} 页`} onClick={() => onPageClick(item.page)} className="absolute -top-1 z-20 h-4 w-4 -translate-x-1/2 text-xs text-stone-500" style={{ left: `${((item.page - 1) / Math.max(1, safeTotal - 1)) * 100}%` }}>│</button>)}
        {markers.map((page) => <button key={page} type="button" aria-label={`跳转到夹页 ${page}`} title={`第 ${page} 页夹页`} onClick={() => onPageClick(page)} className="absolute -bottom-1 z-20 h-4 w-4 -translate-x-1/2 text-center text-xs text-amber-700" style={{ left: `${((page - 1) / Math.max(1, safeTotal - 1)) * 100}%` }}>◆</button>)}
      </div>
      <button type="button" aria-label="下一页" tabIndex={0} disabled={currentPage >= totalPages || !totalPages} onClick={() => onPageClick(currentPage + 1)} className="p-2 text-stone-700 disabled:opacity-30"><ChevronRight size={20} /></button>
      <span className="hidden text-xs text-stone-500 xl:block">← → 翻页 · ↑ 夹页 · Space 速翻</span>
    </nav>
  );
};
