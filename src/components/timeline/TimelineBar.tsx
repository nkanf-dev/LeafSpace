import React, { useMemo } from 'react';
import '../../styles/TimelineBar.css';

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
      <div 
        key={m}
        className="kindle-marker"
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
    <div className="kindle-timeline">
      <div className="timeline-meta-left">
        <span className="current-num">{currentPage}</span>
        <span className="total-num">/ {safeTotal}</span>
      </div>
      
      <div className="timeline-core">
        <div className="timeline-track" onClick={handleTrackClick}>
          <div className="track-rail" />
          <div className="track-fill" style={{ width: `${progress}%` }} />
          {markerElements}
          <div className="track-knob" style={{ left: `${progress}%` }}>
            <div className="knob-label">{progress.toFixed(0)}%</div>
          </div>
        </div>
      </div>

      <div className="timeline-meta-right">
        <span className="hint-text">点击进度条跳转 • Space 开启速翻</span>
      </div>
    </div>
  );
};
