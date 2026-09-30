import React, { useState } from 'react';
import type { HeldPage } from '../../types/domain';
import { LayoutGrid, List, X } from 'lucide-react';
import { CachedThumbnail } from '../thumbnails/CachedThumbnail';

interface Props {
  pages: HeldPage[];
  onPageClick: (page: HeldPage) => void;
  onRemovePage: (id: string) => void;
}

export const HeldPagesPanel: React.FC<Props> = ({ pages, onPageClick, onRemovePage }) => {
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 text-sm font-semibold text-stone-600">
        <h2>夹住的页面 ({pages.length})</h2>
        <div className="flex bg-[#f0ede9] p-0.5">
          <button type="button" aria-label="卡片视图" title="卡片视图" aria-pressed={viewMode === 'card'} className={`p-2 ${viewMode === 'card' ? 'bg-white shadow-sm' : 'opacity-60'}`} onClick={() => setViewMode('card')}><LayoutGrid size={15} /></button>
          <button type="button" aria-label="列表视图" title="列表视图" aria-pressed={viewMode === 'list'} className={`p-2 ${viewMode === 'list' ? 'bg-white shadow-sm' : 'opacity-60'}`} onClick={() => setViewMode('list')}><List size={15} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pages.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm leading-6 text-stone-500">
            <p className="mb-2 text-lg text-stone-700">留住值得对照的一页</p>
            <p>在阅读区按 ↑，或点击「夹住此页」。再点击夹页，即可打开参考窗口。</p>
          </div>
        ) : pages.map((page) => (
          <div key={page.id} className={`relative mx-3 my-3 flex overflow-hidden border bg-white ${page.isOpen ? 'border-stone-700' : 'border-[var(--border)]'}`}>
            <button type="button" aria-label={`打开第 ${page.pageNumber} 页参考窗口`} onClick={() => onPageClick(page)} className="flex min-w-0 flex-1 items-center text-left transition hover:bg-stone-50">
              {viewMode === 'card' && <CachedThumbnail alt={`第 ${page.pageNumber} 页缩略图`} className="shrink-0 bg-[#f0ede9]" height={80} width={60} pageNumber={page.pageNumber} priority placeholder={<span className="p-3 text-stone-400">{page.pageNumber}</span>} />}
              <span className="min-w-0 flex-1 p-3">
                <span className="block text-xs text-stone-500">第 {page.pageNumber} 页{page.isOpen ? ' · 已打开' : ''}</span>
                <span className="mt-1 block truncate text-sm font-semibold text-stone-900">{page.customName || page.defaultName}</span>
                {page.note && <span className="mt-1 block truncate text-xs text-stone-500">{page.note}</span>}
              </span>
            </button>
            <button type="button" className="self-start p-3 text-stone-400 hover:text-red-700" onClick={() => onRemovePage(page.id)} aria-label={`移除第 ${page.pageNumber} 页夹页`} title="移除"><X size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
};
