import React, { useEffect, useRef, useState } from 'react';
import { pdfService } from '../../services/PDFService';
import '../../styles/ReaderViewport.css';

interface Props {
  initialPage?: number;
}

/**
 * ReaderViewport (主阅读视口)
 * 职责：渲染 PDF 核心内容，管理缩放与滚动。
 */
export const ReaderViewport: React.FC<Props> = ({ initialPage = 1 }) => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0); // 1.0 = 100%
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 渲染 PDF 页面
  useEffect(() => {
    if (canvasRef.current && pdfService.hasLoadedDocument()) {
      void pdfService.renderPage({
        pageNumber: currentPage,
        scale,
        canvas: canvasRef.current,
      }).catch(() => undefined);
    }
  }, [currentPage, scale]);

  // 处理缩放逻辑
  const handleZoom = (delta: number) => {
    setScale((prev) => {
      const next = prev + delta;
      return Math.min(Math.max(next, 0.5), 4.0); // 50% - 400%
    });
  };

  return (
    <div className="reader-viewport-container" ref={containerRef}>
      <div className="reader-toolbar">
        <button onClick={() => handleZoom(-0.1)}>Zoom -</button>
        <span>{(scale * 100).toFixed(0)}%</span>
        <button onClick={() => handleZoom(0.1)}>Zoom +</button>
        <div className="page-nav">
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>Prev</button>
          <span>Page {currentPage}</span>
          <button onClick={() => setCurrentPage(p => p + 1)}>Next</button>
        </div>
      </div>
      
      <div className="canvas-wrapper">
        <canvas 
          ref={canvasRef} 
          width={800 * scale} 
          height={1100 * scale}
          className="pdf-canvas"
        />
      </div>
    </div>
  );
};
