import React, { useCallback, useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useBookStore } from '../../stores/bookStore';
import { useHeldStore } from '../../stores/heldStore';
import { useWindowStore } from '../../stores/windowStore';
import { MousePointer2, Hand, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface Props {
  pageNumber?: number;
  isMain?: boolean;
  windowId?: string;
}

type InteractionMode = 'grab' | 'pointer';

export const ReaderViewport: React.FC<Props> = ({ pageNumber, isMain = false, windowId }) => {
  const documentUrl = useBookStore(state => state.documentUrl);
  const globalCurrentPage = useBookStore(state => state.currentPage);
  const totalPages = useBookStore(state => state.totalPages);
  const setCurrentPage = useBookStore(state => state.setCurrentPage);
  const holdPage = useHeldStore(state => state.holdPage);
  const updateWindow = useWindowStore(state => state.updateWindow);
  const setActiveWindow = useWindowStore(state => state.setActiveWindow);
  const activePage = isMain ? globalCurrentPage : (pageNumber || 1);
  
  const [scale, setScale] = useState(isMain ? 1.3 : 1.0);
  const [mode, setMode] = useState<InteractionMode>('grab');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const contentFrameRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [shouldCenterHorizontally, setShouldCenterHorizontally] = useState(true);
  const [shouldCenterVertically, setShouldCenterVertically] = useState(true);
  const startPos = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const panTarget = useRef({ scrollLeft: 0, scrollTop: 0 });
  const panAnimationFrame = useRef<number | null>(null);
  
  // 用于存储缩放中心的物理参考点
  const zoomPivot = useRef<{ x: number, y: number, scrollX: number, scrollY: number, oldScale: number } | null>(null);
  const zoomCorrectionFrame = useRef<number | null>(null);

  const cancelPanAnimation = useCallback(() => {
    if (panAnimationFrame.current !== null) {
      window.cancelAnimationFrame(panAnimationFrame.current);
      panAnimationFrame.current = null;
    }
  }, []);

  const syncPanTargetToContainer = useCallback(() => {
    if (!containerRef.current) {
      return;
    }

    panTarget.current = {
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    };
  }, []);

  const updateContentAlignment = useCallback(() => {
    const container = containerRef.current;
    const contentFrame = contentFrameRef.current;

    if (!container || !contentFrame) {
      return;
    }

    const horizontalPadding = 80;
    const verticalPadding = 120;
    const availableWidth = Math.max(0, container.clientWidth - horizontalPadding);
    const availableHeight = Math.max(0, container.clientHeight - verticalPadding);

    setShouldCenterHorizontally(contentFrame.offsetWidth <= availableWidth);
    setShouldCenterVertically(contentFrame.offsetHeight <= availableHeight);
  }, []);

  const applyZoomPivot = useCallback(() => {
    if (!zoomPivot.current || !containerRef.current) {
      return;
    }

    const { x, y, scrollX, scrollY, oldScale } = zoomPivot.current;
    const container = containerRef.current;
    const mouseRelativeX = (x + scrollX) / oldScale;
    const mouseRelativeY = (y + scrollY) / oldScale;

    container.scrollLeft = Math.max(0, mouseRelativeX * scale - x);
    container.scrollTop = Math.max(0, mouseRelativeY * scale - y);
    syncPanTargetToContainer();
    zoomPivot.current = null;
  }, [scale, syncPanTargetToContainer]);

  useLayoutEffect(() => {
    updateContentAlignment();

    if (!zoomPivot.current) {
      return;
    }

    if (zoomCorrectionFrame.current !== null) {
      window.cancelAnimationFrame(zoomCorrectionFrame.current);
    }

    zoomCorrectionFrame.current = window.requestAnimationFrame(() => {
      applyZoomPivot();
      zoomCorrectionFrame.current = null;
    });
  }, [applyZoomPivot, scale, updateContentAlignment]);

  useLayoutEffect(() => {
    updateContentAlignment();
  }, [activePage, scale, updateContentAlignment]);

  useEffect(() => {
    const container = containerRef.current;
    const contentFrame = contentFrameRef.current;

    if (!container || !contentFrame || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateContentAlignment();

      if (zoomPivot.current) {
        if (zoomCorrectionFrame.current !== null) {
          window.cancelAnimationFrame(zoomCorrectionFrame.current);
        }

        zoomCorrectionFrame.current = window.requestAnimationFrame(() => {
          applyZoomPivot();
          zoomCorrectionFrame.current = null;
        });
      }
    });

    observer.observe(container);
    observer.observe(contentFrame);

    return () => observer.disconnect();
  }, [applyZoomPivot, updateContentAlignment]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (mode === 'grab') {
        e.preventDefault();
        cancelPanAnimation();
        syncPanTargetToContainer();
        const rect = el.getBoundingClientRect();
        
        // 记录缩放前的快照
        zoomPivot.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          scrollX: el.scrollLeft,
          scrollY: el.scrollTop,
          oldScale: scale
        };

        const factor = 1.15;
        const delta = e.deltaY > 0 ? 1 / factor : factor;
        setScale(s => Math.min(8, Math.max(0.1, s * delta)));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cancelPanAnimation, mode, scale, syncPanTargetToContainer]);

  const animatePanToTarget = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      panAnimationFrame.current = null;
      return;
    }

    const deltaX = panTarget.current.scrollLeft - container.scrollLeft;
    const deltaY = panTarget.current.scrollTop - container.scrollTop;

    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      container.scrollLeft = panTarget.current.scrollLeft;
      container.scrollTop = panTarget.current.scrollTop;
      panAnimationFrame.current = null;
      return;
    }

    container.scrollLeft += deltaX * 0.22;
    container.scrollTop += deltaY * 0.22;
    panAnimationFrame.current = window.requestAnimationFrame(animatePanToTarget);
  }, []);

  const ensurePanAnimation = useCallback(() => {
    if (panAnimationFrame.current !== null) {
      return;
    }

    panAnimationFrame.current = window.requestAnimationFrame(animatePanToTarget);
  }, [animatePanToTarget]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode !== 'grab' || !containerRef.current) return;
    e.preventDefault();
    cancelPanAnimation();
    setIsPanning(true);
    startPos.current = {
      x: e.pageX - containerRef.current.offsetLeft,
      y: e.pageY - containerRef.current.offsetTop,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    };
    panTarget.current = {
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !containerRef.current) return;
    e.preventDefault();
    const x = e.pageX - containerRef.current.offsetLeft;
    const y = e.pageY - containerRef.current.offsetTop;
    const walkX = (x - startPos.current.x) * 1.5;
    const walkY = (y - startPos.current.y) * 1.5;
    panTarget.current = {
      scrollLeft: startPos.current.scrollLeft - walkX,
      scrollTop: startPos.current.scrollTop - walkY,
    };
    ensurePanAnimation();
  };

  const stopPanning = () => {
    setIsPanning(false);
    ensurePanAnimation();
  };

  useEffect(() => () => {
    cancelPanAnimation();
    if (zoomCorrectionFrame.current !== null) {
      window.cancelAnimationFrame(zoomCorrectionFrame.current);
    }
  }, [cancelPanAnimation]);

  const file = useMemo(() => documentUrl ?? null, [documentUrl]);
  const options = useMemo(() => ({
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
  }), []);

  const modeButtonClasses = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center text-stone-500 transition ${active ? 'bg-white text-stone-900 shadow-sm' : 'hover:bg-black/5 hover:text-stone-900'}`;

  const updateActivePage = useCallback((nextPage: number) => {
    const clampedPage = Math.min(Math.max(1, nextPage), Math.max(1, totalPages));

    if (isMain || !windowId) {
      setCurrentPage(clampedPage);
      return;
    }

    updateWindow(windowId, { pageNumber: clampedPage, title: `Page ${clampedPage}` });
  }, [isMain, setCurrentPage, totalPages, updateWindow, windowId]);

  const handleViewportFocus = useCallback(() => {
    if (windowId) {
      setActiveWindow(windowId);
    }
  }, [setActiveWindow, windowId]);

  const handleViewportKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey) {
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      updateActivePage(activePage - 1);
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      updateActivePage(activePage + 1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      void holdPage(activePage);
    }
  }, [activePage, holdPage, updateActivePage]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--surface)]">
      <div className="flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
        <div className="flex items-center gap-3">
          <div className="flex bg-[#f0ede9] p-[2px]">
            <button className={modeButtonClasses(mode === 'pointer')} onClick={() => setMode('pointer')} title="滚动模式">
              <MousePointer2 size={16} strokeWidth={2.5} />
            </button>
            <button className={modeButtonClasses(mode === 'grab')} onClick={() => setMode('grab')} title="抓手模式">
              <Hand size={16} strokeWidth={2.5} />
            </button>
          </div>
          <div className="text-xs font-medium text-stone-600">
            {isMain ? '主视角' : `参考 P.${activePage}`}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-stone-500">
          <button className="border border-[var(--border)] px-2 py-1 text-stone-900 transition hover:bg-[#f0ede9]" onClick={() => setScale((value) => Math.max(0.1, value * 0.8))}><ZoomOut size={14} /></button>
          <span className="text-[0.75rem] text-stone-700">{Math.round(scale * 100)}%</span>
          <button className="border border-[var(--border)] px-2 py-1 text-stone-900 transition hover:bg-[#f0ede9]" onClick={() => setScale((value) => Math.min(8, value * 1.2))}><ZoomIn size={14} /></button>
        </div>
      </div>

      <div 
        ref={containerRef}
        tabIndex={0}
        className={`flex min-h-0 min-w-0 flex-1 overflow-auto bg-[#edece9] ${mode === 'grab' ? 'select-none' : 'select-text'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPanning}
        onMouseLeave={stopPanning}
        onFocus={handleViewportFocus}
        onMouseDownCapture={handleViewportFocus}
        onKeyDown={handleViewportKeyDown}
        style={{ cursor: mode === 'grab' ? (isPanning ? 'grabbing' : 'grab') : 'default', touchAction: mode === 'grab' ? 'none' : 'auto' }}
      >
        <div
          className={`flex min-h-full min-w-full px-10 py-[60px] ${shouldCenterHorizontally ? 'justify-center' : 'justify-start'} ${shouldCenterVertically ? 'items-center' : 'items-start'}`}
        >
          <div ref={contentFrameRef} className="w-max shrink-0">
            {file ? (
              <Document
                file={file}
                options={options}
                loading={<div className="mt-24 text-sm italic text-stone-500" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>正在渲染...</div>}
              >
                <Page
                  pageNumber={activePage}
                  scale={scale}
                  className="border border-[#e0ddd5] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.05),0_30px_100px_rgba(0,0,0,0.1)]"
                  renderTextLayer={true}
                />
              </Document>
            ) : (
              <div className="mt-24 text-sm text-stone-500">等待载入...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
