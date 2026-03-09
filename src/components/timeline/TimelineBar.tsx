import React, { useMemo } from 'react';
import '../../styles/TimelineBar.css';

interface Props {
  currentPage: number;
  totalPages: number;
  onPageClick: (page: number) => void;
  markers?: number[]; // 关键页标记
}

/**
 * TimelineBar (可视化时间轴)
 * 职责：提供全局进度视图，标注关键页。
 */
export const TimelineBar: React.FC<Props> = ({ 
  currentPage, 
  totalPages, 
  onPageClick, 
  markers = [5, 12, 45, 89] // 默认 Mock 标记
}) => {
  const progress = (currentPage / totalPages) * 100;

  const markerElements = useMemo(() => {
    return markers.map(m => (
      <div 
        key={m}
        className="timeline-marker"
        style={{ left: `${(m / totalPages) * 100}%` }}
        title={`Bookmark at Page ${m}`}
        onClick={(e) => {
          e.stopPropagation();
          onPageClick(m);
        }}
      />
    ));
  }, [markers, totalPages, onPageClick]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedPage = Math.max(1, Math.ceil((x / rect.width) * totalPages));
    onPageClick(clickedPage);
  };

  return (
    <div className="timeline-bar-wrapper">
      <div className="timeline-track" onClick={handleTimelineClick}>
        <div 
          className="timeline-fill" 
          style={{ width: `${progress}%` }} 
        />
        {markerElements}
        <div 
          className="timeline-handle" 
          style={{ left: `${progress}%` }} 
        />
      </div>
      <div className="timeline-labels">
        <span>Page {currentPage}</span>
        <span>{totalPages} Pages</span>
      </div>
    </div>
  );
};
