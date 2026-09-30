import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThumbnailRenderRequest, ThumbnailWorkerRequest, ThumbnailWorkerResponse } from '../../services/thumbnailProtocol';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument }));
import { pdfService } from '../../services/PDFService';
import { ThumbnailService } from '../../services/ThumbnailService';
import { bookStore } from '../../stores/bookStore';
import { thumbnailStore } from '../../stores/thumbnailStore';

class ThumbnailWorkerMock {
  static instances: ThumbnailWorkerMock[] = [];
  onmessage: ((event: MessageEvent<ThumbnailWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: ThumbnailWorkerRequest[] = [];
  terminate = vi.fn();
  constructor() { ThumbnailWorkerMock.instances.push(this); }
  postMessage(request: ThumbnailWorkerRequest) { this.requests.push(request); }
  send(message: ThumbnailWorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<ThumbnailWorkerResponse>); }
}

function mockMainThreadRender() {
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
  const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 300 * scale }), render, cleanup: vi.fn() };
  getDocument.mockReturnValue({
    promise: Promise.resolve({ getPage: vi.fn().mockResolvedValue(page), destroy: vi.fn().mockResolvedValue(undefined) }),
    destroy: vi.fn().mockResolvedValue(undefined),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '', fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['thumbnail'], { type: 'image/webp' })));
  return render;
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
  getDocument.mockReset();
  ThumbnailWorkerMock.instances = [];
  bookStore.getState().reset();
  thumbnailStore.getState().reset();
  bookStore.getState().setDocumentReady({ documentId: 'book', totalPages: 20 });
  vi.spyOn(pdfService, 'getDocumentData').mockReturnValue(new Uint8Array([1, 2, 3]));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
  vi.stubGlobal('Worker', ThumbnailWorkerMock);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('thumbnail recovery', () => {
  it('renders on the main thread when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const render = mockMainThreadRender();
    const service = new ThumbnailService();
    await service.ensureThumbnail(2);
    expect(render).toHaveBeenCalledOnce();
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(2))).toMatchObject({ status: 'ready', blobUrl: 'blob:thumbnail' });
  });

  it('falls back when creating or messaging a worker throws', async () => {
    const render = mockMainThreadRender();
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('Workers are blocked'); }
    });
    await new ThumbnailService().ensureThumbnail(7);
    expect(render).toHaveBeenCalledOnce();
    vi.stubGlobal('Worker', ThumbnailWorkerMock);
    vi.spyOn(ThumbnailWorkerMock.prototype, 'postMessage').mockImplementation(() => { throw new Error('DataCloneError'); });
    await new ThumbnailService().ensureThumbnail(8);
    expect(render).toHaveBeenCalledTimes(2);
    expect(ThumbnailWorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('retries loading the fallback PDF after a temporary parser failure', async () => {
    vi.stubGlobal('Worker', undefined);
    const render = mockMainThreadRender();
    getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('temporary parse failure')), destroy: vi.fn().mockResolvedValue(undefined),
    }));
    const service = new ThumbnailService();
    await expect(service.ensureThumbnail(9)).rejects.toThrow('temporary parse failure');
    await service.ensureThumbnail(9);
    expect(render).toHaveBeenCalledOnce();
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(9))?.status).toBe('ready');
  });

  it('falls back when worker document initialization never finishes', async () => {
    vi.useFakeTimers();
    const render = mockMainThreadRender();
    const service = new ThumbnailService();
    const promise = service.ensureThumbnail(3);
    await vi.advanceTimersByTimeAsync(1801);
    await promise;
    expect(render).toHaveBeenCalledOnce();
    expect(ThumbnailWorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(3))?.status).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deduplicates callers and rejects a failed render without an orphaned rejection', async () => {
    vi.stubGlobal('Worker', undefined);
    const render = mockMainThreadRender();
    render.mockReturnValue({ promise: Promise.reject(new Error('render failed')) });
    const service = new ThumbnailService();
    const first = service.ensureThumbnail(4);
    const second = service.ensureThumbnail(4);
    expect(first).toBe(second);
    await expect(first).rejects.toThrow('render failed');
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(4))?.status).toBe('error');
    render.mockReturnValue({ promise: Promise.resolve() });
    await service.ensureThumbnail(4);
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(4))?.status).toBe('ready');
  });

  it('ignores a worker result with a stale request id', async () => {
    const service = new ThumbnailService();
    const promise = service.ensureThumbnail(6);
    await flushMicrotasks();
    const worker = ThumbnailWorkerMock.instances[0];
    worker.send({ type: 'document-ready', documentId: 'book' });
    await flushMicrotasks();
    const request = worker.requests.find((value): value is ThumbnailRenderRequest => value.type === 'render')!;
    const result = { type: 'success' as const, id: request.id, key: request.key, pageNumber: 6, width: 180, height: 270, blob: new Blob(['image']) };
    worker.send({ ...result, id: 'superseded' });
    expect(thumbnailStore.getState().getEntry(request.key)?.status).toBe('rendering');
    worker.send(result);
    await promise;
    expect(thumbnailStore.getState().getEntry(request.key)?.status).toBe('ready');
  });

  it('releases object URLs on replacement, removal, reset, and discarded results', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const store = thumbnailStore.getState();
    store.markQueued({ key: 'a', pageNumber: 1, width: 180 });
    store.markReady({ key: 'a', blobUrl: 'blob:first', height: 200, width: 180 });
    store.markReady({ key: 'a', blobUrl: 'blob:second', height: 200, width: 180 });
    store.removeEntry('a');
    store.markReady({ key: 'removed', blobUrl: 'blob:discarded', height: 200, width: 180 });
    store.markQueued({ key: 'b', pageNumber: 2, width: 180 });
    store.markReady({ key: 'b', blobUrl: 'blob:reset', height: 200, width: 180 });
    store.reset();
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:first', 'blob:second', 'blob:discarded', 'blob:reset']);
  });
});
