interface WorkerCanvas {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

/** PDF.js also needs temporary canvases for image downscaling and masks. */
export class WorkerCanvasFactory {
  private readonly enableHWA: boolean;

  constructor({ enableHWA = false }: { enableHWA?: boolean } = {}) {
    this.enableHWA = enableHWA;
  }

  create(width: number, height: number): WorkerCanvas {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: !this.enableHWA });
    if (!context) throw new Error('Worker canvas context unavailable');
    return { canvas, context };
  }

  reset(target: WorkerCanvas, width: number, height: number) {
    if (!target.canvas) throw new Error('Canvas is not specified');
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    target.canvas.width = width;
    target.canvas.height = height;
  }

  destroy(target: WorkerCanvas) {
    if (!target.canvas) throw new Error('Canvas is not specified');
    target.canvas.width = 0;
    target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}
