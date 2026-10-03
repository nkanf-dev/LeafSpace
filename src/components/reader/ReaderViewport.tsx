import React, { useCallback, useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFPageProxy } from 'pdfjs-dist';
import { useBookStore } from '../../stores/bookStore';
import { useHeldStore } from '../../stores/heldStore';
import { useWindowStore } from '../../stores/windowStore';
import { useQuickFlipStore } from '../../stores/quickFlipStore';
import { useReaderGestures } from '../../hooks/useReaderGestures';
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
  // PDF.js defaults to enableHWA:false and requests this context hint. Context
  // attributes are fixed by the first getContext call, before the drawing effect.
  const initializeCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvas?.getContext('2d', { alpha: false });
  }, []);
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
  const activeWindowId = useWindowStore(state => state.activeWindowId);
  const quickFlipVisible = useQuickFlipStore(state => state.isOpen);
  const activePage = isMain ? globalCurrentPage : (pageNumber || 1);
  const storedMode = currentWindow?.viewport?.mode ?? 'grab';
  const storedScale = isMain ? globalScale : (currentWindow?.viewport?.scale ?? 1);
  
  const scale = storedScale;
  const [pageWidth, setPageWidth] = useState(612);
  const [pageGeometry, setPageGeometry] = useState<{ documentUrl: string | null; page: number; ratio: number } | null>(null);
  const paperRatio = pageGeometry?.documentUrl === documentUrl && pageGeometry.page === activePage ? pageGeometry.ratio : null;
  const requestedScale = useRef(scale);
  useLayoutEffect(() => { requestedScale.current = scale; }, [scale]);
  const [mode, setMode] = useState<InteractionMode>(storedMode);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const contentFrameRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [shouldCenterHorizontally, setShouldCenterHorizontally] = useState(true);
  const startPos = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const panTarget = useRef({ scrollLeft: 0, scrollTop: 0 });
  const panAnimationFrame = useRef<number | null>(null);
  const lastAppliedScroll = useRef({ left: 0, top: 0 });
  const renderGeneration = useRef(0);
  const renderToken = useMemo(() => ({ documentUrl, activePage, scale, pageWidth }), [documentUrl, activePage, scale, pageWidth]);
  const currentRenderToken = useRef(renderToken);
  const renderReady = useRef(false);
  const viewportRef = useRef(currentWindow?.viewport);
  useLayoutEffect(() => { viewportRef.current = currentWindow?.viewport; }, [currentWindow?.viewport]);
  
  // 用于存储缩放中心的物理参考点
  const zoomPivot = useRef<{ x: number, y: number, frameX: number, frameY: number, oldScale: number; centered?: boolean } | null>(null);
  const zoomCorrectionFrame = useRef<number | null>(null);

  useEffect(() => {
    setMode(storedMode);
  }, [storedMode]);


  const persistViewport = useCallback((partial: Record<string, number | string>) => {
    if (!windowId) {
      return;
    }

    // Scale/mode changes must not copy transient DOM clamps while PDF pixels load.
    const nextViewport = { ...viewportRef.current, ...partial };
    viewportRef.current = nextViewport;
    updateWindow(windowId, { viewport: nextViewport });
  }, [updateWindow, windowId]);

  const updateScale = useCallback((updater: number | ((value: number) => number)) => {
    const currentScale = requestedScale.current;
    const nextScale = typeof updater === 'function' ? updater(currentScale) : updater;
    const clampedScale = Math.min(4, Math.max(0.1, nextScale));
    if (Math.abs(clampedScale - currentScale) <= 0.0001) return;
    requestedScale.current = clampedScale;
    renderReady.current = false;

    if (isMain) {
      setGlobalScale(clampedScale);
    }

    persistViewport({ scale: clampedScale });
  }, [isMain, persistViewport, setGlobalScale]);

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
    // 100% is a paper-sized page that fits the current reader. Zoom stays relative
    // to that baseline so mobile and narrow comparison panes are readable by default.
    if (container.clientWidth > 0) setPageWidth(Math.min(612, Math.max(1, container.clientWidth - horizontalPadding)));
    const availableWidth = Math.max(0, container.clientWidth - horizontalPadding);

    setShouldCenterHorizontally(contentFrame.offsetWidth <= availableWidth + 2);
  }, []);

  const applyZoomPivot = useCallback(() => {
    if (!zoomPivot.current || !containerRef.current) {
      return;
    }

    const { x, y, frameX, frameY, oldScale, centered } = zoomPivot.current;
    const container = containerRef.current;
    const bounds = container.getBoundingClientRect();
    const frame = contentFrameRef.current?.getBoundingClientRect();
    if (!frame) return;
    // Anchor the same point on the paper, including fit-width centering/padding.
    container.scrollLeft += frame.left - bounds.left + ((x - frameX) / oldScale) * scale - (centered ? container.clientWidth / 2 : x);
    container.scrollTop += frame.top - bounds.top + ((y - frameY) / oldScale) * scale - (centered ? container.clientHeight / 2 : y);
    syncPanTargetToContainer();
    zoomPivot.current = null;
  }, [scale, syncPanTargetToContainer]);

  useLayoutEffect(() => {
    updateContentAlignment();
  }, [activePage, scale, updateContentAlignment]);

  const captureScrollIntent = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const actual = { left: container.scrollLeft, top: container.scrollTop };
    const baseline = lastAppliedScroll.current;
    lastAppliedScroll.current = actual;
    if (!container.clientWidth || !container.clientHeight) return;
    const desired = { left: viewportRef.current?.scrollLeft ?? 0, top: viewportRef.current?.scrollTop ?? 0 };
    const clampLeft = Math.min(desired.left, Math.max(0, container.scrollWidth - container.clientWidth));
    const clampTop = Math.min(desired.top, Math.max(0, container.scrollHeight - container.clientHeight));
    // A layout clamp is not a request to forget a restored position. Every other
    // change, including a single scroll before paint or a genuine return to zero,
    // becomes the new desired position before any observer can restore over it.
    const changedLeft = Math.abs(actual.left - baseline.left) > 0.01 && Math.abs(actual.left - clampLeft) >= 1;
    const changedTop = Math.abs(actual.top - baseline.top) > 0.01 && Math.abs(actual.top - clampTop) >= 1;
    if (!changedLeft && !changedTop) return;
    zoomPivot.current = null;
    persistViewport({ scrollLeft: changedLeft ? actual.left : desired.left, scrollTop: changedTop ? actual.top : desired.top });
  }, [persistViewport]);

  const restoreScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || !viewportRef.current) return;
    captureScrollIntent();
    container.scrollLeft = viewportRef.current.scrollLeft ?? 0;
    container.scrollTop = viewportRef.current.scrollTop ?? 0;
    lastAppliedScroll.current = { left: container.scrollLeft, top: container.scrollTop };
    syncPanTargetToContainer();
  }, [captureScrollIntent, syncPanTargetToContainer]);

  useLayoutEffect(() => {
    // A new paper owns a new scroll intent. Old-paper DOM movement or a queued
    // layout clamp must not overwrite an explicitly restored page position.
    const container = containerRef.current;
    if (container) lastAppliedScroll.current = { left: container.scrollLeft, top: container.scrollTop };
    zoomPivot.current = null;
    cancelPanAnimation();
  }, [documentUrl, activePage, cancelPanAnimation]);

  useLayoutEffect(() => {
    currentRenderToken.current = renderToken;
    renderGeneration.current += 1;
    if (zoomCorrectionFrame.current !== null) window.cancelAnimationFrame(zoomCorrectionFrame.current);
    zoomCorrectionFrame.current = null;
    renderReady.current = false;
  }, [renderToken]);

  useLayoutEffect(() => {
    // Reserve the new paper's geometry before React-PDF replaces its canvas.
    // Correct synchronously, so the next input never anchors against stale pixels.
    if (zoomPivot.current && paperRatio && containerRef.current?.clientWidth && containerRef.current.clientHeight) {
      applyZoomPivot();
      lastAppliedScroll.current = { left: containerRef.current.scrollLeft, top: containerRef.current.scrollTop };
      persistViewport({ scrollLeft: containerRef.current.scrollLeft, scrollTop: containerRef.current.scrollTop });
    } else restoreScroll();
  }, [applyZoomPivot, paperRatio, persistViewport, renderToken, restoreScroll]);

  useLayoutEffect(() => {
    if (renderReady.current && !zoomPivot.current) restoreScroll();
  }, [currentWindow?.viewport, restoreScroll]);

  const handleRenderSuccess = useCallback(() => {
    if (renderToken !== currentRenderToken.current) return;
    const generation = renderGeneration.current;
    updateContentAlignment();
    if (zoomCorrectionFrame.current !== null) window.cancelAnimationFrame(zoomCorrectionFrame.current);
    zoomCorrectionFrame.current = window.requestAnimationFrame(() => {
      zoomCorrectionFrame.current = null;
      if (generation !== renderGeneration.current || renderToken !== currentRenderToken.current) return;
      captureScrollIntent();
      if (!containerRef.current?.clientWidth || !containerRef.current.clientHeight) {
        // A hidden mobile pane has no meaningful zoom geometry. Preserve its
        // desired offsets and let ResizeObserver restore them when shown again.
        zoomPivot.current = null;
        renderReady.current = true;
        return;
      }
      const zooming = !!zoomPivot.current;
      if (zooming) applyZoomPivot();
      else restoreScroll();
      renderReady.current = true;
      if (zooming && containerRef.current) {
        lastAppliedScroll.current = { left: containerRef.current.scrollLeft, top: containerRef.current.scrollTop };
        persistViewport({ scrollLeft: containerRef.current.scrollLeft, scrollTop: containerRef.current.scrollTop });
      }
    });
  }, [applyZoomPivot, captureScrollIntent, persistViewport, renderToken, restoreScroll, updateContentAlignment]);

  useEffect(() => {
    const container = containerRef.current;
    const contentFrame = contentFrameRef.current;

    if (!container || !contentFrame || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateContentAlignment();
      if (!zoomPivot.current) restoreScroll();
    });

    observer.observe(container);
    observer.observe(contentFrame);

    return () => observer.disconnect();
  }, [applyZoomPivot, restoreScroll, updateContentAlignment]);

  const zoomAt = useCallback((factor: number, clientPoint?: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) return;
    const nextScale = Math.min(4, Math.max(0.1, requestedScale.current * factor));
    if (Math.abs(nextScale - requestedScale.current) <= 0.0001) return;
    cancelPanAnimation();
    captureScrollIntent();
    syncPanTargetToContainer();
    const bounds = container.getBoundingClientRect();
    const frame = contentFrameRef.current?.getBoundingClientRect();
    if (!frame?.width || !frame.height || !container.clientWidth || !container.clientHeight) {
      updateScale(nextScale);
      return;
    }
    const x = clientPoint ? clientPoint.x - bounds.left : container.clientWidth / 2;
    const y = clientPoint ? clientPoint.y - bounds.top : container.clientHeight / 2;
    // Several wheel events can arrive in the same task, before React commits.
    // Keep the original paper anchor and accumulate the requested scale.
    if (!zoomPivot.current) zoomPivot.current = {
      x, y, frameX: (frame?.left ?? bounds.left) - bounds.left,
      frameY: (frame?.top ?? bounds.top) - bounds.top, oldScale: scale, centered: !clientPoint,
    };
    updateScale(nextScale);
  }, [cancelPanAnimation, captureScrollIntent, scale, syncPanTargetToContainer, updateScale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(event.deltaY > 0 ? 1 / 1.15 : 1.15, { x: event.clientX, y: event.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const handlePageLoad = useCallback((page: PDFPageProxy) => {
    if (currentRenderToken.current.documentUrl !== documentUrl || currentRenderToken.current.activePage !== activePage || page.pageNumber !== activePage) return;
    const viewport = page.getViewport({ scale: 1 });
    setPageGeometry({ documentUrl, page: activePage, ratio: viewport.height / viewport.width });
  }, [activePage, documentUrl]);

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
    if (windowId) captureScrollIntent();
  }, [captureScrollIntent, windowId]);

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

  useReaderGestures({
    containerRef, frameRef: contentFrameRef, scale, canSwipe: mode === 'grab', isActive: activeWindowId === (windowId ?? 'main'),
    contextKey: `${documentUrl}:${activePage}:${quickFlipVisible}:${scale}:${mode}`,
    onActivate: handleViewportFocus,
    onTurn: direction => updateActivePage(activePage + direction),
    onZoom: (nextScale, anchor, midpoint) => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      cancelPanAnimation();
      captureScrollIntent();
      const x = midpoint.x - bounds.left;
      const y = midpoint.y - bounds.top;
      zoomPivot.current = { x, y, frameX: x - anchor.x * scale, frameY: y - anchor.y * scale, oldScale: scale };
      updateScale(nextScale);
    },
  });

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
          <button aria-label="缩小" title="缩小" disabled={scale <= 0.1} className="border border-[var(--border)] px-2 py-1 text-stone-900 transition hover:bg-[#f0ede9] disabled:opacity-40" onClick={() => zoomAt(0.8)}><ZoomOut size={14} /></button>
          <button aria-label="恢复适合宽度" title="恢复适合宽度" className="flex items-center gap-1 text-[0.75rem] text-stone-700" onClick={() => { zoomPivot.current = null; updateScale(1); persistViewport({ scale: 1, scrollLeft: 0, scrollTop: 0 }); if (containerRef.current) { containerRef.current.scrollLeft = 0; containerRef.current.scrollTop = 0; } }}><RotateCcw size={12} />{Math.round(scale * 100)}%</button>
          <button aria-label="放大" title="放大" disabled={scale >= 4} className="border border-[var(--border)] px-2 py-1 text-stone-900 transition hover:bg-[#f0ede9] disabled:opacity-40" onClick={() => zoomAt(1.2)}><ZoomIn size={14} /></button>
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
        style={{ cursor: mode === 'grab' ? (isPanning ? 'grabbing' : 'grab') : 'default', overflowAnchor: 'none', touchAction: mode === 'grab' && shouldCenterHorizontally ? 'pan-y' : 'pan-x pan-y' }}
      >
        <div
          className="flex h-max min-h-full w-fit min-w-full shrink-0 px-4 py-6 sm:px-10 sm:py-[60px]"
        >
          <div ref={contentFrameRef} className="m-auto w-max shrink-0"
            style={paperRatio ? { width: Math.floor(pageWidth * scale) + 2, height: Math.floor(pageWidth * scale * paperRatio) + 2 } : undefined}>
            {file ? (
              <Document
                file={file}
                options={options}
                error={<div role="alert" className="max-w-xs p-6 text-sm text-red-800">页面暂时无法显示，请重新导入这本 PDF。</div>}
                loading={<div role="status" className="mt-24 text-sm italic text-stone-500" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>正在渲染...</div>}
              >
                <Page
                  canvasRef={initializeCanvas}
                  pageNumber={activePage}
                  width={pageWidth}
                  scale={scale}
                  className="border border-[#e0ddd5] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.05),0_30px_100px_rgba(0,0,0,0.1)]"
                  renderTextLayer={true}
                  onLoadSuccess={handlePageLoad}
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
