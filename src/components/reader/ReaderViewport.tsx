import React, { useCallback, useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useBookStore } from '../../stores/bookStore';
import { useHeldStore } from '../../stores/heldStore';
import { useWindowStore } from '../../stores/windowStore';
import { MousePointer2, Hand, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
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
  const globalScale = useBookStore(state => state.scale);
  const totalPages = useBookStore(state => state.totalPages);
  const setCurrentPage = useBookStore(state => state.setCurrentPage);
  const setGlobalScale = useBookStore(state => state.setScale);
  const holdPage = useHeldStore(state => state.holdPage);
  const currentWindow = useWindowStore(state => state.windows.find((candidate) => candidate.id === (windowId ?? 'main')));
  const updateWindow = useWindowStore(state => state.updateWindow);
  const setActiveWindow = useWindowStore(state => state.setActiveWindow);
  const activePage = isMain ? globalCurrentPage : (pageNumber || 1);
  const storedMode = currentWindow?.viewport?.mode ?? 'grab';
  const storedScale = isMain ? globalScale : (currentWindow?.viewport?.scale ?? 1);
  
  const scale = storedScale;
  const [pageWidth, setPageWidth] = useState(612);
  const [mode, setMode] = useState<InteractionMode>(storedMode);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const contentFrameRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [shouldCenterHorizontally, setShouldCenterHorizontally] = useState(true);
  const [shouldCenterVertically, setShouldCenterVertically] = useState(true);
  const startPos = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const panTarget = useRef({ scrollLeft: 0, scrollTop: 0 });
  const panAnimationFrame = useRef<number | null>(null);
  const lastPersistedScroll = useRef({ left: 0, top: 0 });
  const renderReady = useRef(false);
  const viewportRef = useRef(currentWindow?.viewport);
  useLayoutEffect(() => { viewportRef.current = currentWindow?.viewport; }, [currentWindow?.viewport]);
  
  // 用于存储缩放中心的物理参考点
  const zoomPivot = useRef<{ x: number, y: number, scrollX: number, scrollY: number, oldScale: number } | null>(null);
  const zoomCorrectionFrame = useRef<number | null>(null);

  useEffect(() => {
    setMode(storedMode);
  }, [storedMode]);


  const persistViewport = useCallback((partial: Record<string, number | string>) => {
    if (!windowId) {
      return;
    }

    const container = containerRef.current;
    const nextViewport = {
      ...currentWindow?.viewport,
      scrollLeft: container?.scrollLeft ?? currentWindow?.viewport?.scrollLeft ?? 0,
      scrollTop: container?.scrollTop ?? currentWindow?.viewport?.scrollTop ?? 0,
      ...partial,
    };

    updateWindow(windowId, { viewport: nextViewport });
  }, [currentWindow?.viewport, updateWindow, windowId]);

  const updateScale = useCallback((updater: number | ((value: number) => number)) => {
    const currentScale = isMain ? globalScale : scale;
    const nextScale = typeof updater === 'function' ? updater(currentScale) : updater;
    const clampedScale = Math.min(4, Math.max(0.1, nextScale));
    if (Math.abs(clampedScale - currentScale) > 0.0001) renderReady.current = false;

    if (isMain) {
      setGlobalScale(clampedScale);
    }

    persistViewport({ scale: clampedScale });
  }, [globalScale, isMain, persistViewport, scale, setGlobalScale]);

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

    const horizontalPadding = window.innerWidth < 640 ? 32 : 80;
    const verticalPadding = window.innerWidth < 640 ? 48 : 120;
    // 100% is a paper-sized page that fits the current reader. Zoom stays relative
    // to that baseline so mobile and narrow comparison panes are readable by default.
    if (container.clientWidth > 0) setPageWidth(Math.min(612, Math.max(1, container.clientWidth - horizontalPadding)));
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

  const restoreScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || !viewportRef.current) return;
    const left = viewportRef.current.scrollLeft ?? 0;
    const top = viewportRef.current.scrollTop ?? 0;
    container.scrollLeft = left;
    container.scrollTop = top;
    lastPersistedScroll.current = { left, top };
    syncPanTargetToContainer();
  }, [syncPanTargetToContainer]);

  useLayoutEffect(() => {
    renderReady.current = false;
    restoreScroll();
  }, [activePage, documentUrl, scale, pageWidth, restoreScroll]);

  const handleRenderSuccess = useCallback(() => {
    updateContentAlignment();
    window.requestAnimationFrame(() => {
      if (zoomPivot.current) applyZoomPivot();
      else restoreScroll();
      renderReady.current = true;
    });
  }, [applyZoomPivot, restoreScroll, updateContentAlignment]);

  useEffect(() => {
    const container = containerRef.current;
    const contentFrame = contentFrameRef.current;

    if (!container || !contentFrame || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateContentAlignment();
      if (!renderReady.current) restoreScroll();

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
  }, [applyZoomPivot, restoreScroll, updateContentAlignment]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
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
        updateScale((value) => value * delta);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cancelPanAnimation, scale, syncPanTargetToContainer, updateScale]);

  const animatePanToTarget = useCallback(function animate() {
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
    panAnimationFrame.current = window.requestAnimationFrame(animate);
  }, []);

  const ensurePanAnimation = useCallback(() => {
    if (panAnimationFrame.current !== null) {
      return;
    }

    panAnimationFrame.current = window.requestAnimationFrame(animatePanToTarget);
  }, [animatePanToTarget]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || mode !== 'grab' || !containerRef.current) return;
    containerRef.current.focus();
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

  const handleScroll = useCallback(() => {
    if (!windowId || !containerRef.current || !renderReady.current) {
      return;
    }

    const nextLeft = containerRef.current.scrollLeft;
    const nextTop = containerRef.current.scrollTop;

    if (Math.abs(lastPersistedScroll.current.left - nextLeft) < 1 && Math.abs(lastPersistedScroll.current.top - nextTop) < 1) {
      return;
    }

    lastPersistedScroll.current = { left: nextLeft, top: nextTop };
    persistViewport({ scrollLeft: nextLeft, scrollTop: nextTop });
  }, [persistViewport, windowId]);

  const handleModeChange = useCallback((nextMode: InteractionMode) => {
    setMode(nextMode);
    persistViewport({ mode: nextMode });
  }, [persistViewport]);

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

    updateWindow(windowId, { pageNumber: clampedPage, title: `第 ${clampedPage} 页` });
  }, [isMain, setCurrentPage, totalPages, updateWindow, windowId]);

  const handleViewportFocus = useCallback(() => {
    if (windowId) {
      setActiveWindow(windowId);
    }
  }, [setActiveWindow, windowId]);

  const handleViewportKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ignore if any modifier keys are pressed (except shift for screenshot)
    if (e.altKey || e.metaKey || e.ctrlKey) {
      return;
    }

    // Only handle arrow keys and Enter, let other keys propagate normally
    if (e.target instanceof Element && e.target.closest('button, input, textarea, select, a')) return;
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      updateActivePage(e.key === 'Home' ? 1 : totalPages);
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
      return;
    }

    // Don't preventDefault for other keys to allow normal mouse operations
  }, [activePage, holdPage, totalPages, updateActivePage]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--surface)]" onFocusCapture={handleViewportFocus} onPointerDownCapture={handleViewportFocus}>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1 sm:px-4">
        <div className="flex items-center gap-3">
          <div className="flex bg-[#f0ede9] p-[2px]">
            <button className={modeButtonClasses(mode === 'pointer')} onClick={() => handleModeChange('pointer')} title="选择文字" aria-label="选择文字" aria-pressed={mode === 'pointer'}>
              <MousePointer2 size={16} strokeWidth={2.5} />
            </button>
            <button className={modeButtonClasses(mode === 'grab')} onClick={() => handleModeChange('grab')} title="拖动页面" aria-label="拖动页面" aria-pressed={mode === 'grab'}>
              <Hand size={16} strokeWidth={2.5} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="此窗口上一页" className="p-1 text-stone-600 disabled:opacity-30" disabled={activePage <= 1} onClick={() => updateActivePage(activePage - 1)}><ChevronLeft size={16} /></button>
          <div className="text-xs font-medium text-stone-600">
            {isMain ? '主视角' : `参考 P.${activePage}`}
          </div>
            <button aria-label="此窗口下一页" className="p-1 text-stone-600 disabled:opacity-30" disabled={activePage >= totalPages} onClick={() => updateActivePage(activePage + 1)}><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-stone-500">
          <button aria-label="缩小" title="缩小" disabled={scale <= 0.1} className="border border-[var(--border)] px-2 py-1 text-stone-900 transition hover:bg-[#f0ede9] disabled:opacity-40" onClick={() => updateScale((value) => value * 0.8)}><ZoomOut size={14} /></button>
          <button aria-label="恢复适合宽度" title="恢复适合宽度" className="flex items-center gap-1 text-[0.75rem] text-stone-700" onClick={() => { zoomPivot.current = null; updateScale(1); persistViewport({ scale: 1, scrollLeft: 0, scrollTop: 0 }); if (containerRef.current) { containerRef.current.scrollLeft = 0; containerRef.current.scrollTop = 0; } }}><RotateCcw size={12} />{Math.round(scale * 100)}%</button>
          <button aria-label="放大" title="放大" disabled={scale >= 4} className="border border-[var(--border)] px-2 py-1 text-stone-900 transition hover:bg-[#f0ede9] disabled:opacity-40" onClick={() => updateScale((value) => value * 1.2)}><ZoomIn size={14} /></button>
        </div>
      </div>

      <div 
        ref={containerRef}
        tabIndex={0}
        role="region"
        aria-label={isMain ? '主阅读区' : `参考阅读区，第 ${activePage} 页`}
        className={`flex min-h-0 min-w-0 flex-1 overflow-auto bg-[#edece9] ${mode === 'grab' ? 'select-none' : 'select-text'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPanning}
        onMouseLeave={stopPanning}
        onFocus={handleViewportFocus}
        onMouseDownCapture={handleViewportFocus}
        onKeyDown={handleViewportKeyDown}
        onScroll={handleScroll}
        style={{ cursor: mode === 'grab' ? (isPanning ? 'grabbing' : 'grab') : 'default', touchAction: 'pan-x pan-y' }}
      >
        <div
          className={`flex min-h-full min-w-full px-4 py-6 sm:px-10 sm:py-[60px] ${shouldCenterHorizontally ? 'justify-center' : 'justify-start'} ${shouldCenterVertically ? 'items-center' : 'items-start'}`}
        >
          <div ref={contentFrameRef} className="w-max shrink-0">
            {file ? (
              <Document
                file={file}
                options={options}
                error={<div role="alert" className="max-w-xs p-6 text-sm text-red-800">页面暂时无法显示，请重新导入这本 PDF。</div>}
                loading={<div role="status" className="mt-24 text-sm italic text-stone-500" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>正在渲染...</div>}
              >
                <Page
                  pageNumber={activePage}
                  width={pageWidth}
                  scale={scale}
                  className="border border-[#e0ddd5] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.05),0_30px_100px_rgba(0,0,0,0.1)]"
                  renderTextLayer={true}
                  onRenderSuccess={handleRenderSuccess}
                  loading={<div role="status" className="p-6 text-sm text-stone-500">正在渲染页面…</div>}
                  error={<div role="alert" className="p-6 text-sm text-red-800">这一页无法渲染，请试试其他页面或重新导入。</div>}
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
