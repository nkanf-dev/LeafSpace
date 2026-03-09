import React, { useEffect, useRef, useState } from 'react';
import '../../styles/ReaderViewport.css';

interface Props {
  initialPage?: number;
}

/**
 * ReaderViewport (主阅读视口)
 * 职责：渲染 PDF 内容，管理缩放与滚动。
 * 状态隔离：内部实现 Mock 渲染，不依赖外部 Service。
 */
export const ReaderViewport: React.FC<Props> = ({ initialPage = 1 }) => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 内部 Mock 渲染逻辑 (代替 PDFService)
  const mockRender = (page: number, s: number, canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 清除画布
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 绘制模拟页面背景
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.height; i += 20 * s) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // 绘制页码文本
    ctx.fillStyle = '#333';
    ctx.font = `bold ${24 * s}px sans-serif`;
    ctx.fillText(`PDF PAGE ${page}`, 40 * s, 60 * s);
    
    ctx.font = `${14 * s}px serif`;
    const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Spatial reading allows you to keep context while diving deep.";
    ctx.fillText(lorem, 40 * s, 100 * s);
  };

  useEffect(() => {
    if (canvasRef.current) {
      mockRender(currentPage, scale, canvasRef.current);
    }
  }, [currentPage, scale]);

  const handleZoom = (delta: number) => {
    setScale((prev) => Math.min(Math.max(prev + delta, 0.5), 4.0));
  };

  return (
    <div className="reader-viewport-container">
      <div className="reader-toolbar">
        <div className="zoom-ctrl">
          <button onClick={() => handleZoom(-0.1)}>-</button>
          <span>{(scale * 100).toFixed(0)}%</span>
          <button onClick={() => handleZoom(0.1)}>+</button>
        </div>
        <div className="page-nav">
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>Prev</button>
          <span>P. {currentPage}</span>
          <button onClick={() => setCurrentPage(p => p + 1)}>Next</button>
        </div>
      </div>
      
      <div className="canvas-wrapper">
        <canvas 
          ref={canvasRef} 
          width={600 * scale} 
          height={800 * scale}
          className="pdf-canvas"
        />
      </div>
    </div>
  );
};
