import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerCanvasFactory } from '../../workers/WorkerCanvasFactory';

class OffscreenCanvasMock {
  width: number;
  height: number;
  getContext = vi.fn().mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() });
  constructor(width: number, height: number) { this.width = width; this.height = height; }
}

describe('worker temporary PDF canvases', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('creates and resets canvases without a document and releases their backing size', () => {
    vi.stubGlobal('document', undefined); vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);
    const factory = new WorkerCanvasFactory();
    const target = factory.create(128, 128);
    const canvas = target.canvas as unknown as OffscreenCanvasMock;
    expect(canvas).toBeInstanceOf(OffscreenCanvasMock);
    expect(canvas.getContext).toHaveBeenCalledExactlyOnceWith('2d', { willReadFrequently: true });
    factory.reset(target, 64, 32);
    expect(canvas).toMatchObject({ width: 64, height: 32 });
    factory.destroy(target);
    expect(canvas).toMatchObject({ width: 0, height: 0 });
    expect(target).toEqual({ canvas: null, context: null });
  });
  it('retains PDF.js context hints and rejects invalid or already-retired canvases', () => {
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);
    const factory = new WorkerCanvasFactory({ enableHWA: true });
    const target = factory.create(64, 64);
    expect((target.canvas as unknown as OffscreenCanvasMock).getContext).toHaveBeenCalledExactlyOnceWith('2d', { willReadFrequently: false });
    expect(() => factory.create(0, 64)).toThrow('Invalid canvas size');
    expect(() => factory.reset(target, 64, 0)).toThrow('Invalid canvas size');
    factory.destroy(target);
    expect(() => factory.reset(target, 64, 64)).toThrow('Canvas is not specified');
    expect(() => factory.destroy(target)).toThrow('Canvas is not specified');
  });
});
