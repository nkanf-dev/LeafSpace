import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  currentPage: number;
  totalPages: number;
  onPageClick: (page: number) => void;
  markers?: number[];
}

export const TimelineBar: React.FC<Props> = ({ currentPage, totalPages, onPageClick, markers = [] }) => {
  const safeTotal = Math.max(1, totalPages);
  const progress = ((currentPage - 1) / Math.max(1, safeTotal - 1)) * 100;
  return (
    <nav aria-label="阅读进度" className="flex h-full min-w-0 items-center gap-3 bg-[var(--surface)] px-3 sm:gap-6 sm:px-6">
      <button type="button" aria-label="上一页" disabled={currentPage <= 1 || !totalPages} onClick={() => onPageClick(currentPage - 1)} className="p-2 text-stone-700 disabled:opacity-30"><ChevronLeft size={20} /></button>
      <div className="shrink-0 text-sm tabular-nums text-stone-600"><strong className="text-xl text-stone-900">{totalPages ? currentPage : '—'}</strong> / {totalPages || '—'}</div>
      <div className="relative flex h-10 min-w-0 flex-1 items-center">
        <div aria-hidden="true" className="absolute inset-x-0 h-0.5 bg-[var(--border)]" />
        <div aria-hidden="true" className="absolute left-0 h-0.5 bg-stone-800" style={{ width: `${progress}%` }} />
        <input type="range" min={1} max={safeTotal} value={currentPage} disabled={!totalPages} aria-label="跳转到页码" aria-valuetext={`第 ${currentPage} 页，共 ${totalPages} 页`} onChange={(event) => onPageClick(Number(event.target.value))} className="page-range relative z-10 w-full" />
        {markers.map((page) => <button key={page} type="button" aria-label={`跳转到夹页 ${page}`} title={`第 ${page} 页夹页`} onClick={() => onPageClick(page)} className="absolute -bottom-1 z-20 h-4 w-4 -translate-x-1/2 text-center text-xs text-amber-700" style={{ left: `${((page - 1) / Math.max(1, safeTotal - 1)) * 100}%` }}>◆</button>)}
      </div>
      <button type="button" aria-label="下一页" disabled={currentPage >= totalPages || !totalPages} onClick={() => onPageClick(currentPage + 1)} className="p-2 text-stone-700 disabled:opacity-30"><ChevronRight size={20} /></button>
      <span className="hidden text-xs text-stone-500 xl:block">← → 翻页 · ↑ 夹页 · Space 速翻</span>
    </nav>
  );
};
