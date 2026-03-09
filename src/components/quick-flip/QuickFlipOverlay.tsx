import React, { useEffect, useState, useRef } from 'react';
import '../../styles/QuickFlipOverlay.css';

interface Props {
  isVisible: boolean;
  onClose: () => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * QuickFlipOverlay (速翻图层)
 * 职责：提供类似胶片的可视化快速翻页。
 */
export const QuickFlipOverlay: React.FC<Props> = ({ 
  isVisible, 
  onClose, 
  currentPage, 
  totalPages,
  onPageChange 
}) => {
  const [hoverPage, setHoverPage] = useState(currentPage);
  const stripRef = useRef<HTMLDivElement>(null);

  // 处理键盘导航
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        onPageChange(Math.min(totalPages, currentPage + 1));
      } else if (e.key === 'ArrowLeft') {
        onPageChange(Math.max(1, currentPage - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, currentPage, totalPages, onClose, onPageChange]);

  if (!isVisible) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="quick-flip-overlay" onClick={onClose}>
      <div className="quick-flip-content" onClick={e => e.stopPropagation()}>
        <div className="quick-flip-current-label">Page {currentPage} / {totalPages}</div>
        <div className="quick-flip-strip" ref={stripRef}>
          {pages.map(page => (
            <div 
              key={page}
              className={`quick-flip-item ${page === currentPage ? 'active' : ''}`}
              onClick={() => onPageChange(page)}
              onMouseEnter={() => setHoverPage(page)}
            >
              <div className="thumbnail-placeholder">
                {page}
              </div>
            </div>
          ))}
        </div>
        <div className="quick-flip-preview-label">Jump to Page {hoverPage}</div>
      </div>
    </div>
  );
};
