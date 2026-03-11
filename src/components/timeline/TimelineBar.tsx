import React, { useMemo } from 'react';

interface Props {
  currentPage: number;
  totalPages: number;
  onPageClick: (page: number) => void;
  markers?: number[];
}

export const TimelineBar: React.FC<Props> = ({ 
  currentPage, 
  totalPages, 
  onPageClick, 
  markers = [] 
}) => {
  const safeTotal = Math.max(1, totalPages);
  const progress = (currentPage / safeTotal) * 100;

  const markerElements = useMemo(() => {
    return markers.map(m => (
      <button
        type="button"
        key={m}
        className="absolute top-1/2 z-10 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-800/50 transition hover:h-4 hover:bg-stone-900"
        style={{ left: `${(m / safeTotal) * 100}%` }}
        onClick={(e) => {
          e.stopPropagation();
          onPageClick(m);
        }}
      />
    ));
  }, [markers, safeTotal, onPageClick]);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedPage = Math.max(1, Math.ceil((x / rect.width) * safeTotal));
    onPageClick(clickedPage);
  };

  return (
    <div className="flex h-full items-center gap-8 bg-[var(--surface)] px-8">
      <div className="flex min-w-[100px] items-baseline gap-1">
        <div className="text-[1.4rem] font-extrabold text-stone-900" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>{currentPage}</div>
        <div className="text-[0.8rem] text-stone-500">/ {safeTotal}</div>
      </div>
      
      <div className="flex h-10 flex-1 items-center">
        <div className="group relative flex h-5 w-full cursor-pointer items-center" onClick={handleTrackClick}>
          <div className="absolute inset-x-0 h-[2px] bg-[var(--border)]" />
          <div className="absolute left-0 h-[2px] bg-stone-900" style={{ width: `${progress}%` }} />
          {markerElements}
          <div className="absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-stone-900 bg-[var(--surface)]" style={{ left: `${progress}%` }}>
            <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 bg-stone-900 px-1.5 py-0.5 text-[0.65rem] font-bold text-white opacity-0 transition group-hover:opacity-100">
              {progress.toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-[200px] text-right text-[0.75rem] italic text-stone-500">
        点击进度条跳转 • Space 开启速翻
      </div>
    </div>
  );
};
