import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Document, Thumbnail } from 'react-pdf';
import { useBookStore } from '../../stores/bookStore';
import { useHeldStore } from '../../stores/heldStore';
import { useWindowStore } from '../../stores/windowStore';
import { Pin } from 'lucide-react';
import '../../styles/QuickFlipOverlay.css';

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
  const documentUrl = useBookStore(state => state.documentUrl);
  const heldPages = useHeldStore(state => state.pages);
  const { holdPage, unholdPage } = useHeldStore.getState();
  const { openInNewWindow } = useWindowStore.getState();

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(2.5, Math.max(0.4, z - e.deltaY * 0.001 * z)));
  };

  const file = useMemo(() => documentUrl ? { data: documentUrl } : null, [documentUrl]);

  useEffect(() => {
    if (!isVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setSelectedPage(p => Math.min(totalPages, p + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setSelectedPage(p => Math.max(1, p - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); holdPage(selectedPage); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); unholdPage(selectedPage); }
      else if (e.key === 'Enter') { e.preventDefault(); onPageChange(selectedPage); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, selectedPage, totalPages, onClose, onPageChange, holdPage, unholdPage]);

  // 物理锁定：只有在 selectedPage 变化时才触发滚动，而不是 hover
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
    <div className="kindle-scroll-overlay" onWheel={handleWheel}>
      <div className="scroll-backdrop" onClick={onClose} />
      <div className="scroll-content">
        <div className="scroll-header">
          <div className="title-serif">速翻视图</div>
          <div className="controls-hint">
            <kbd>←</kbd><kbd>→</kbd> 选择 • <kbd>↑</kbd> 夹住 • <kbd>Enter</kbd> 跳转 • <kbd>Shift + 点击</kbd> 浮窗
          </div>
        </div>

        <div className="scroll-strip" ref={stripRef}>
          {file && (
            <Document file={documentUrl}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <div 
                  key={page} 
                  className={`scroll-item p-${page} ${page === selectedPage ? 'selected' : ''} ${heldPages.some(p => p.pageNumber === page) ? 'held' : ''}`} 
                  style={{ transform: `scale(${page === selectedPage ? 1.3 * zoom : 0.85 * zoom})` }} 
                  onClick={(e) => {
                    if (e.shiftKey) { openInNewWindow(page); }
                    else { setSelectedPage(page); }
                  }}
                  onDoubleClick={() => { onPageChange(page); onClose(); }}
                >
                  <div className="scroll-card-ux">
                    <Thumbnail pageNumber={page} width={180 * zoom} loading={<div className="ux-skeleton">{page}</div>} />
                    {heldPages.some(p => p.pageNumber === page) && <div className="held-pin-vector"><Pin size={24} fill="#f5a623" /></div>}
                  </div>
                  <div className="scroll-label-ux">{page}</div>
                </div>
              ))}
            </Document>
          )}
        </div>
      </div>
    </div>
  );
};
