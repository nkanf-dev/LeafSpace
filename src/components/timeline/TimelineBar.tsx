import React, { useState } from 'react';
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
  const safeTotal = Math.max(1, totalPages);
  const progress = ((currentPage - 1) / Math.max(1, safeTotal - 1)) * 100;
  return (
    <nav aria-label="阅读进度" className="flex h-full min-w-0 items-center gap-3 bg-[var(--surface)] px-3 sm:gap-6 sm:px-6">
      <button type="button" aria-label="上一页" disabled={currentPage <= 1 || !totalPages} onClick={() => onPageClick(currentPage - 1)} className="p-2 text-stone-700 disabled:opacity-30"><ChevronLeft size={20} /></button>
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
        <input type="range" min={1} max={safeTotal} value={currentPage} disabled={!totalPages} aria-label="跳转到页码" aria-valuetext={`第 ${currentPage} 页，共 ${totalPages} 页`} onChange={(event) => onPageClick(Number(event.target.value))} className="page-range relative z-10 w-full" />
        {chapters.filter(item => item.level === 0).map(item => <button key={item.id} type="button" aria-label={`跳转到章节：${item.title}`} title={`${item.title} · 第 ${item.page} 页`} onClick={() => onPageClick(item.page)} className="absolute -top-1 z-20 h-4 w-4 -translate-x-1/2 text-xs text-stone-500" style={{ left: `${((item.page - 1) / Math.max(1, safeTotal - 1)) * 100}%` }}>│</button>)}
        {markers.map((page) => <button key={page} type="button" aria-label={`跳转到夹页 ${page}`} title={`第 ${page} 页夹页`} onClick={() => onPageClick(page)} className="absolute -bottom-1 z-20 h-4 w-4 -translate-x-1/2 text-center text-xs text-amber-700" style={{ left: `${((page - 1) / Math.max(1, safeTotal - 1)) * 100}%` }}>◆</button>)}
      </div>
      <button type="button" aria-label="下一页" disabled={currentPage >= totalPages || !totalPages} onClick={() => onPageClick(currentPage + 1)} className="p-2 text-stone-700 disabled:opacity-30"><ChevronRight size={20} /></button>
      <span className="hidden text-xs text-stone-500 xl:block">← → 翻页 · ↑ 夹页 · Space 速翻</span>
    </nav>
  );
};
