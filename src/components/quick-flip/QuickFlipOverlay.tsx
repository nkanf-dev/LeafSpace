import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Document, Thumbnail } from 'react-pdf';
import { useBookStore } from '../../stores/bookStore';
import { useHeldStore } from '../../stores/heldStore';
import { useWindowStore } from '../../stores/windowStore';
import { Pin } from 'lucide-react';

interface Props {
  isVisible: boolean;
  onClose: () => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export const QuickFlipOverlay: React.FC<Props> = ({ isVisible, onClose, currentPage, totalPages, onPageChange }) => {
  const [selectedPage, setSelectedPage] = useState(currentPage);
  const [zoom, setZoom] = useState(1.0);
  const stripRef = useRef<HTMLDivElement>(null);
  const documentUrl = useBookStore((state) => state.documentUrl);
  const heldPages = useHeldStore((state) => state.pages);
  const { holdPage, unholdPage } = useHeldStore.getState();
  const { openInNewWindow } = useWindowStore.getState();

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((value) => Math.min(2.5, Math.max(0.4, value - e.deltaY * 0.001 * value)));
  };

  const file = useMemo(() => documentUrl ?? null, [documentUrl]);

  useEffect(() => {
    if (!isVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setSelectedPage((page) => Math.min(totalPages, page + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setSelectedPage((page) => Math.max(1, page - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); holdPage(selectedPage); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); unholdPage(selectedPage); }
      else if (e.key === 'Enter') { e.preventDefault(); onPageChange(selectedPage); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, selectedPage, totalPages, onClose, onPageChange, holdPage, unholdPage]);

  useEffect(() => {
    if (stripRef.current && isVisible) {
      const activeEl = stripRef.current.querySelector(`.p-${selectedPage}`) as HTMLElement;
      if (activeEl) {
        const x = activeEl.offsetLeft - (stripRef.current.clientWidth / 2) + (activeEl.clientWidth / 2);
        stripRef.current.scrollTo({ left: x, behavior: 'smooth' });
      }
    }
  }, [selectedPage, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex flex-col justify-center overflow-hidden" onWheel={handleWheel}>
      <div className="absolute inset-0 bg-[rgba(251,250,248,0.7)] backdrop-blur-[40px]" onClick={onClose} />
      <div className="relative z-10 flex w-full flex-col">
        <div className="mb-5 text-center">
          <div className="text-[2.8rem] font-extrabold text-stone-900" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>速翻视图</div>
          <div className="mt-2 text-[0.85rem] text-stone-500">
            <kbd className="border border-[var(--border)] bg-white px-1.5 py-0.5">←</kbd>
            <kbd className="ml-1 border border-[var(--border)] bg-white px-1.5 py-0.5">→</kbd>
            <span className="mx-2">选择</span>•
            <kbd className="mx-2 border border-[var(--border)] bg-white px-1.5 py-0.5">↑</kbd>
            夹住 •
            <kbd className="mx-2 border border-[var(--border)] bg-white px-1.5 py-0.5">Enter</kbd>
            跳转 •
            <kbd className="mx-2 border border-[var(--border)] bg-white px-1.5 py-0.5">Shift + 点击</kbd>
            浮窗
          </div>
        </div>

        <div className="quick-flip-strip overflow-x-auto" ref={stripRef}>
          {file && (
            <Document file={file}>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => {
                const isSelected = page === selectedPage;
                const isHeld = heldPages.some((heldPage) => heldPage.pageNumber === page);

                return (
                  <div
                    key={page}
                    className={`p-${page} flex shrink-0 cursor-pointer flex-col items-center gap-6 transition-all duration-500 ${isSelected ? 'opacity-100' : 'opacity-35 hover:opacity-60'}`}
                    style={{ transform: `scale(${isSelected ? 1.3 * zoom : 0.85 * zoom})` }}
                    onClick={(e) => {
                      if (e.shiftKey) openInNewWindow(page);
                      else setSelectedPage(page);
                    }}
                    onDoubleClick={() => { onPageChange(page); onClose(); }}
                  >
                    <div className={`relative flex h-[280px] w-[200px] items-center justify-center overflow-hidden border bg-white shadow-[0_4px_12px_rgba(0,0,0,0.05),0_30px_80px_rgba(0,0,0,0.1)] ${isSelected ? 'translate-y-[-15px] border-[3px] border-stone-900 shadow-[0_50px_120px_rgba(0,0,0,0.22)]' : isHeld ? 'border-[#f5a623]' : 'border-[var(--border)]'}`}>
                      <Thumbnail pageNumber={page} width={180 * zoom} loading={<div className="text-xl font-bold text-stone-300">{page}</div>} />
                      {isHeld && (
                        <div className="absolute right-3 top-3 text-[#f5a623] [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.2))]">
                          <Pin size={24} fill="currentColor" />
                        </div>
                      )}
                    </div>
                    <div className={`text-[1.1rem] font-bold text-stone-900 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`} style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {page}
                    </div>
                  </div>
                );
              })}
            </Document>
          )}
        </div>
      </div>
    </div>
  );
};
