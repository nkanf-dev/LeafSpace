import React, { useState } from 'react';
import { Document, Thumbnail } from 'react-pdf';
import type { HeldPage } from '../../types/domain';
import { useBookStore } from '../../stores/bookStore';
import { LayoutGrid, List, X } from 'lucide-react';

interface Props {
  pages: HeldPage[];
  onPageClick: (page: HeldPage) => void;
  onRemovePage: (id: string) => void;
}

export const HeldPagesPanel: React.FC<Props> = ({ pages, onPageClick, onRemovePage }) => {
  const documentUrl = useBookStore((state) => state.documentUrl);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

  const renderPageItem = (page: HeldPage, canRenderThumbnail: boolean) => {
    const isCard = viewMode === 'card';

    return (
      <div
        key={page.id}
        className={isCard
          ? `mx-4 my-3 flex cursor-pointer overflow-hidden border bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02)] ${page.isOpen ? 'border-l-4 border-l-stone-900 border-t-[var(--border)] border-r-[var(--border)] border-b-[var(--border)]' : 'border-[var(--border)] hover:bg-[#fbfaf8]'}`
          : `flex cursor-pointer items-center border-b border-[var(--border)] px-4 py-2 hover:bg-[#fbfaf8] ${page.isOpen ? 'border-l-4 border-l-stone-900 bg-[#fbfaf8]' : ''}`}
        onClick={() => onPageClick(page)}
      >
        {isCard && (
          <div className="flex w-[60px] min-h-[80px] shrink-0 items-center justify-center bg-[#f0ede9]">
            {canRenderThumbnail ? (
              <Thumbnail pageNumber={page.pageNumber} width={70} loading={<div className="text-xs font-bold text-stone-300">{page.pageNumber}</div>} />
            ) : (
              <div className="text-xs font-bold text-stone-300">{page.pageNumber}</div>
            )}
          </div>
        )}

        {!isCard && <div className="mr-3 text-sm font-bold text-stone-500">P.{page.pageNumber}</div>}

        <div className={`min-w-0 flex-1 ${isCard ? 'p-3' : 'py-1'}`}>
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="text-[0.65rem] font-extrabold text-stone-500">P.{page.pageNumber}</span>
            <button
              type="button"
              className="px-1 text-stone-400 transition hover:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                onRemovePage(page.id);
              }}
              title="移除"
            >
              <X size={14} />
            </button>
          </div>
          <div className="truncate text-[0.85rem] font-semibold text-stone-900">{page.customName || page.defaultName}</div>
          {page.note && <div className="mt-1 truncate text-[0.7rem] italic text-stone-500">{page.note}</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 text-[0.8rem] font-extrabold text-stone-500" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
        <span>夹住的页面 ({pages.length})</span>
        <div className="flex bg-[#f0ede9] p-[2px]">
          <button
            type="button"
            className={`border-0 px-2 py-0.5 ${viewMode === 'card' ? 'bg-white shadow-sm' : 'opacity-50 hover:bg-black/5 hover:opacity-75'}`}
            onClick={() => setViewMode('card')}
            title="卡片视图"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            className={`border-0 px-2 py-0.5 ${viewMode === 'list' ? 'bg-white shadow-sm' : 'opacity-50 hover:bg-black/5 hover:opacity-75'}`}
            onClick={() => setViewMode('list')}
            title="列表视图"
          >
            <List size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pages.length === 0 ? (
          <div className="pt-24 text-center text-stone-500">✧ 卷轴空空如也</div>
        ) : documentUrl ? (
          <Document file={documentUrl}>{pages.map((page) => renderPageItem(page, true))}</Document>
        ) : (
          pages.map((page) => renderPageItem(page, false))
        )}
      </div>
    </div>
  );
};
