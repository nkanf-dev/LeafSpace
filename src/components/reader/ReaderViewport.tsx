import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useBookStore } from '../../stores/bookStore';
import { MousePointer2, Hand, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '../../styles/ReaderViewport.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface Props {
  pageNumber?: number;
  isMain?: boolean;
}

type InteractionMode = 'grab' | 'pointer';

export const ReaderViewport: React.FC<Props> = ({ pageNumber, isMain = false }) => {
  const documentUrl = useBookStore(state => state.documentUrl);
  const globalCurrentPage = useBookStore(state => state.currentPage);
  const activePage = isMain ? globalCurrentPage : (pageNumber || 1);
  
  const [scale, setScale] = useState(isMain ? 1.3 : 1.0);
  const [mode, setMode] = useState<InteractionMode>('grab');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const startPos = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  
  // 用于存储缩放中心的物理参考点
  const zoomPivot = useRef<{ x: number, y: number, scrollX: number, scrollY: number, oldScale: number } | null>(null);

  // 物理锁定：以光标为中心缩放
  useLayoutEffect(() => {
    if (!zoomPivot.current || !containerRef.current) return;
    const { x, y, scrollX, scrollY, oldScale } = zoomPivot.current;
    const container = containerRef.current;

    // 计算鼠标相对于内容的比例位置
    const mouseRelativeX = (x + scrollX) / oldScale;
    const mouseRelativeY = (y + scrollY) / oldScale;

    // 应用新滚动位置
    container.scrollLeft = mouseRelativeX * scale - x;
    container.scrollTop = mouseRelativeY * scale - y;

    zoomPivot.current = null; // 清空参考点
  }, [scale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (mode === 'grab') {
        e.preventDefault();
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
  }, [mode, scale]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode !== 'grab' || !containerRef.current) return;
    setIsPanning(true);
    startPos.current = {
      x: e.pageX - containerRef.current.offsetLeft,
      y: e.pageY - containerRef.current.offsetTop,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !containerRef.current) return;
    e.preventDefault();
    const x = e.pageX - containerRef.current.offsetLeft;
    const y = e.pageY - containerRef.current.offsetTop;
    const walkX = (x - startPos.current.x) * 1.5;
    const walkY = (y - startPos.current.y) * 1.5;
    containerRef.current.scrollLeft = startPos.current.scrollLeft - walkX;
    containerRef.current.scrollTop = startPos.current.scrollTop - walkY;
  };

  const stopPanning = () => setIsPanning(false);

  const file = useMemo(() => documentUrl ? { data: documentUrl } : null, [documentUrl]);
  const options = useMemo(() => ({
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
  }), []);

  return (
    <div className={`kindle-viewport ${isMain ? 'is-main' : 'is-ref'} interaction-${mode}`}>
      <div className="kindle-viewer-header">
        <div className="toolbar-left-group">
          <div className="mode-switcher">
            <button className={`mode-btn ${mode === 'pointer' ? 'active' : ''}`} onClick={() => setMode('pointer')} title="滚动模式">
              <MousePointer2 size={16} strokeWidth={2.5} />
            </button>
            <button className={`mode-btn ${mode === 'grab' ? 'active' : ''}`} onClick={() => setMode('grab')} title="抓手模式">
              <Hand size={16} strokeWidth={2.5} />
            </button>
          </div>
          <div className="badge">{isMain ? '主视角' : `参考 P.${activePage}`}</div>
        </div>
        <div className="controls">
          <button className="ux-btn" onClick={() => setScale(s => Math.max(0.1, s * 0.8))}><ZoomOut size={14} /></button>
          <span className="scale-val">{Math.round(scale * 100)}%</span>
          <button className="ux-btn" onClick={() => setScale(s => Math.min(8, s * 1.2))}><ZoomIn size={14} /></button>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="kindle-scroll-canvas" 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPanning}
        onMouseLeave={stopPanning}
        style={{ cursor: mode === 'grab' ? (isPanning ? 'grabbing' : 'grab') : 'default', overflow: mode === 'grab' ? 'hidden' : 'auto' }}
      >
        <div className="canvas-centering-fix">
          {file ? (
            <Document file={documentUrl} options={options} loading={<div className="kindle-status-loading">正在渲染...</div>}>
              <Page pageNumber={activePage} scale={scale} className="kindle-page-rendering" renderTextLayer={true} />
            </Document>
          ) : (
            <div className="kindle-status-empty">等待载入...</div>
          )}
        </div>
      </div>
    </div>
  );
};
