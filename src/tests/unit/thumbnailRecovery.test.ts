import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThumbnailRenderRequest, ThumbnailWorkerRequest, ThumbnailWorkerResponse } from '../../services/thumbnailProtocol';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, version: 'test', getDocument }));
import { ThumbnailService } from '../../services/ThumbnailService';
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

const services: ThumbnailService[] = [];
function createService() {
  const service = new ThumbnailService();
  services.push(service);
  service.activateDocument({ documentId: 'book', totalPages: 20, source: new Uint8Array([1, 2, 3]) });
  return service;
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
  thumbnailStore.getState().reset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
  vi.stubGlobal('Worker', ThumbnailWorkerMock);
});
afterEach(async () => { services.splice(0).forEach(service => service.releaseDocument()); await flushMicrotasks(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('thumbnail recovery', () => {
  it('renders on the main thread when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const render = mockMainThreadRender();
    const service = createService();
    await service.ensureThumbnail(2);
    expect(render).toHaveBeenCalledOnce();
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ wasmUrl: new URL('/pdfjs/test/wasm/', document.baseURI).href, useWorkerFetch: false, isEvalSupported: false }));
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(2))).toMatchObject({ status: 'ready', blobUrl: 'blob:thumbnail' });
  });

  it('falls back when creating or messaging a worker throws', async () => {
    const render = mockMainThreadRender();
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('Workers are blocked'); }
    });
    await createService().ensureThumbnail(7);
    expect(render).toHaveBeenCalledOnce();
    vi.stubGlobal('Worker', ThumbnailWorkerMock);
    vi.spyOn(ThumbnailWorkerMock.prototype, 'postMessage').mockImplementation(() => { throw new Error('DataCloneError'); });
    await createService().ensureThumbnail(8);
    expect(render).toHaveBeenCalledTimes(2);
    expect(ThumbnailWorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('retries loading the fallback PDF after a temporary parser failure', async () => {
    vi.stubGlobal('Worker', undefined);
    const render = mockMainThreadRender();
    getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('temporary parse failure')), destroy: vi.fn().mockResolvedValue(undefined),
    }));
    const service = createService();
    await expect(service.ensureThumbnail(9)).rejects.toThrow('temporary parse failure');
    await service.ensureThumbnail(9);
    expect(render).toHaveBeenCalledOnce();
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(9))?.status).toBe('ready');
  });

  it('falls back when worker document initialization never finishes', async () => {
    vi.useFakeTimers();
    const render = mockMainThreadRender();
    const service = createService();
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
    const service = createService();
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
    const service = createService();
    const promise = service.ensureThumbnail(6);
    await flushMicrotasks();
    const worker = ThumbnailWorkerMock.instances[0];
    expect(worker.requests[0]).toMatchObject({ type: 'load-document', wasmUrl: new URL('/pdfjs/test/wasm/', document.baseURI).href });
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fallbackFixture() {
  mockMainThreadRender();
  const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
  const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 300 * scale }),
    render: vi.fn().mockReturnValue(renderTask), cleanup: vi.fn() };
  const document = { getPage: vi.fn().mockResolvedValue(page) };
  const loadingTask = { promise: Promise.resolve(document), destroy: vi.fn().mockResolvedValue(undefined) };
  getDocument.mockReturnValue(loadingTask);
  return { document, page, loadingTask, renderTask };
}
function reopen(service: ThumbnailService, documentId = 'book') {
  service.activateDocument({ documentId, totalPages: 20, source: new Uint8Array([4, 5, 6]) });
}

describe('thumbnail session retirement', () => {
  it('does not infer a source when no document session has been activated', async () => {
    const service = new ThumbnailService();
    await service.ensureThumbnail(1);
    expect(ThumbnailWorkerMock.instances).toHaveLength(0);
    expect(getDocument).not.toHaveBeenCalled();
    expect(service.getThumbnailKey(1)).toBe('unloaded_1_180');
  });

  it('settles worker callers immediately and ignores captured same-book callbacks after reopening', async () => {
    vi.useFakeTimers();
    const service = createService();
    const oldRequest = service.ensureThumbnail(3);
    await flushMicrotasks();
    const oldWorker = ThumbnailWorkerMock.instances[0];
    const oldMessage = oldWorker.onmessage!;
    const oldError = oldWorker.onerror!;
    service.releaseDocument();
    await oldRequest;
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    expect(oldWorker.onmessage).toBeNull();
    reopen(service);
    const fresh = service.ensureThumbnail(3);
    await flushMicrotasks();
    const worker = ThumbnailWorkerMock.instances[1];
    oldMessage({ data: { type: 'document-ready', documentId: 'book' } } as MessageEvent<ThumbnailWorkerResponse>);
    oldError({ message: 'late error' } as ErrorEvent);
    await flushMicrotasks();
    expect(worker.requests.filter(request => request.type === 'render')).toHaveLength(0);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(service.ensureThumbnail(3)).toBe(fresh);
    worker.send({ type: 'document-ready', documentId: 'book' });
    await flushMicrotasks();
    const request = worker.requests.find((request): request is ThumbnailRenderRequest => request.type === 'render')!;
    worker.send({ type: 'success', id: request.id, key: request.key, pageNumber: 3, width: 180, height: 270, blob: new Blob(['new']) });
    await fresh;
    await vi.advanceTimersByTimeAsync(2000);
    expect(getDocument).not.toHaveBeenCalled();
    expect(thumbnailStore.getState().getEntry(request.key)?.status).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('old render success and failure cannot publish into a same-key fresh request', async () => {
    const service = createService();
    const old = service.ensureThumbnail(5);
    await flushMicrotasks();
    const worker = ThumbnailWorkerMock.instances[0];
    expect(worker.requests[0]).toMatchObject({ type: 'load-document', wasmUrl: new URL('/pdfjs/test/wasm/', document.baseURI).href });
    worker.send({ type: 'document-ready', documentId: 'book' });
    await flushMicrotasks();
    const request = worker.requests.find((request): request is ThumbnailRenderRequest => request.type === 'render')!;
    const deliver = worker.onmessage!;
    reopen(service);
    const fresh = service.ensureThumbnail(5);
    await old; await flushMicrotasks();
    deliver({ data: { type: 'success', id: request.id, key: request.key, pageNumber: 5, width: 180, height: 270, blob: new Blob(['stale']) } } as MessageEvent<ThumbnailWorkerResponse>);
    deliver({ data: { type: 'error', id: request.id, key: request.key, pageNumber: 5, error: 'stale failure' } } as MessageEvent<ThumbnailWorkerResponse>);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(thumbnailStore.getState().getEntry(request.key)?.status).toBe('rendering');
    expect(service.ensureThumbnail(5)).toBe(fresh);
    service.releaseDocument(); await fresh;
  });

  it('bounds pending fallback parses across repeated same-book and A-to-B-to-A reopen attempts', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    const load = deferred<typeof fixture.document>();
    getDocument.mockReturnValueOnce({ ...fixture.loadingTask, promise: load.promise });
    const service = createService();
    const first = service.ensureThumbnail(1);
    const queued = service.ensureThumbnail(2);
    await flushMicrotasks();
    service.releaseDocument();
    await Promise.all([first, queued]);
    expect(fixture.loadingTask.destroy).not.toHaveBeenCalled();
    for (const id of ['book', 'other', 'book']) {
      reopen(service, id);
      await expect(service.ensureThumbnail(1)).rejects.toMatchObject({ name: 'ThumbnailUnavailableError', code: 'retiring-document' });
      expect(getDocument).toHaveBeenCalledOnce();
    }
    load.resolve(fixture.document); await flushMicrotasks();
    expect(fixture.document.getPage).not.toHaveBeenCalled();
    expect(fixture.loadingTask.destroy).toHaveBeenCalledOnce();
    await service.ensureThumbnail(1);
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(1))?.status).toBe('ready');
  });

  it('waits for getPage before disposing and never renders its stale page', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    const page = deferred<typeof fixture.page>();
    fixture.document.getPage.mockReturnValueOnce(page.promise);
    const service = createService();
    const pending = service.ensureThumbnail(2);
    await flushMicrotasks(); service.releaseDocument(); await pending;
    expect(fixture.loadingTask.destroy).not.toHaveBeenCalled();
    page.resolve(fixture.page); await flushMicrotasks();
    expect(fixture.page.cleanup).toHaveBeenCalledOnce();
    expect(fixture.page.render).not.toHaveBeenCalled();
    expect(fixture.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('cancels the recorded render and waits for settlement before destroying the PDF', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    const render = deferred<void>();
    fixture.renderTask.promise = render.promise;
    const service = createService();
    const pending = service.ensureThumbnail(2);
    await flushMicrotasks(); service.releaseDocument(); await pending;
    expect(fixture.renderTask.cancel).toHaveBeenCalledOnce();
    expect(fixture.loadingTask.destroy).not.toHaveBeenCalled();
    render.reject(new Error('RenderingCancelledException')); await flushMicrotasks();
    expect(fixture.page.cleanup).toHaveBeenCalledOnce();
    expect(fixture.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('discards delayed blob encoding without replacing a new session cache entry', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    let encode!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => { encode = callback; });
    const service = createService();
    const pending = service.ensureThumbnail(2);
    await flushMicrotasks(); reopen(service); await pending;
    await expect(service.ensureThumbnail(2)).rejects.toMatchObject({ code: 'retiring-document' });
    encode(new Blob(['old'])); await flushMicrotasks();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(2))?.status).toBe('error');
    expect(fixture.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('does not admit a new fallback parser while destruction remains pending', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    const destroyed = deferred<void>();
    fixture.loadingTask.destroy.mockReturnValueOnce(destroyed.promise);
    const service = createService();
    await service.ensureThumbnail(1); reopen(service);
    await expect(service.ensureThumbnail(1)).rejects.toMatchObject({ code: 'retiring-document' });
    expect(getDocument).toHaveBeenCalledOnce();
    destroyed.resolve(); await flushMicrotasks();
    await service.ensureThumbnail(1);
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it('retains a blocked owner when cleanup fails instead of multiplying parsers', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    fixture.loadingTask.destroy.mockRejectedValueOnce(new Error('cleanup failed'));
    const service = createService();
    await service.ensureThumbnail(1); reopen(service); await flushMicrotasks();
    await expect(service.ensureThumbnail(1)).rejects.toMatchObject({ code: 'cleanup-failed' });
    expect(getDocument).toHaveBeenCalledOnce();
    expect(fixture.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('releases completed thumbnail URLs once when a document retires', async () => {
    vi.stubGlobal('Worker', undefined);
    fallbackFixture();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const service = createService();
    await service.ensureThumbnail(1);
    service.releaseDocument(); service.releaseDocument(); await flushMicrotasks();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:thumbnail');
    expect(thumbnailStore.getState().entries).toEqual({});
  });
  it('allows a fresh custom worker while a retired fallback parse is still pending', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    const load = deferred<typeof fixture.document>();
    getDocument.mockReturnValueOnce({ ...fixture.loadingTask, promise: load.promise });
    const service = createService();
    const retired = service.ensureThumbnail(1); await flushMicrotasks();
    vi.stubGlobal('Worker', ThumbnailWorkerMock);
    reopen(service); await retired;
    const fresh = service.ensureThumbnail(1); await flushMicrotasks();
    const worker = ThumbnailWorkerMock.instances[0];
    expect(worker.requests[0]).toMatchObject({ type: 'load-document', wasmUrl: new URL('/pdfjs/test/wasm/', document.baseURI).href });
    worker.send({ type: 'document-ready', documentId: 'book' }); await flushMicrotasks();
    const request = worker.requests.find((value): value is ThumbnailRenderRequest => value.type === 'render')!;
    worker.send({ type: 'success', id: request.id, key: request.key, pageNumber: 1, width: 180, height: 270, blob: new Blob(['fresh']) });
    await fresh;
    load.resolve(fixture.document); await flushMicrotasks();
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(thumbnailStore.getState().getEntry(request.key)?.status).toBe('ready');
    expect(fixture.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('falls back without posting a render if worker ownership changes at readiness', async () => {
    const render = mockMainThreadRender();
    const service = createService();
    const request = service.ensureThumbnail(1); await flushMicrotasks();
    const worker = ThumbnailWorkerMock.instances[0];
    expect(worker.requests[0]).toMatchObject({ type: 'load-document', wasmUrl: new URL('/pdfjs/test/wasm/', document.baseURI).href });
    worker.send({ type: 'document-ready', documentId: 'book' });
    worker.onerror!({ message: 'worker failed after readiness' } as ErrorEvent);
    await request;
    expect(worker.requests.filter(request => request.type === 'render')).toHaveLength(0);
    expect(render).toHaveBeenCalledOnce();
  });

  it('treats undefined parser and disposal rejections as failures', async () => {
    vi.stubGlobal('Worker', undefined);
    const fixture = fallbackFixture();
    getDocument.mockReturnValueOnce({ ...fixture.loadingTask, promise: Promise.reject(undefined) });
    fixture.loadingTask.destroy.mockRejectedValueOnce(undefined);
    const service = createService();
    await expect(service.ensureThumbnail(1)).rejects.toBeUndefined();
    expect(thumbnailStore.getState().getEntry(service.getThumbnailKey(1))?.status).toBe('error');
    await expect(service.ensureThumbnail(1)).rejects.toMatchObject({ code: 'cleanup-failed' });
    expect(getDocument).toHaveBeenCalledOnce();
  });

});
