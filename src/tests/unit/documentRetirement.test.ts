import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThumbnailWorkerRequest, ThumbnailWorkerResponse } from '../../services/thumbnailProtocol';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, version: 'test', getDocument }));
import { pdfService } from '../../services/PDFService';
import { thumbnailService } from '../../services/ThumbnailService';
import { bookStore, resetBookStoreDependencies } from '../../stores/bookStore';
import { thumbnailStore } from '../../stores/thumbnailStore';

class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage: ((event: MessageEvent<ThumbnailWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: ThumbnailWorkerRequest[] = [];
  terminate = vi.fn();
  constructor() { WorkerMock.instances.push(this); }
  postMessage(request: ThumbnailWorkerRequest) { this.requests.push(request); }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  resetBookStoreDependencies();
  bookStore.getState().reset();
  thumbnailStore.getState().reset();
  WorkerMock.instances = [];
  getDocument.mockReset().mockImplementation(() => ({
    promise: Promise.resolve({ numPages: 12, fingerprints: ['same-book'], getOutline: vi.fn().mockResolvedValue(null) }),
    destroy: vi.fn().mockResolvedValue(undefined),
  }));
  vi.stubGlobal('Worker', WorkerMock);
});
afterEach(async () => {
  bookStore.getState().reset();
  await vi.advanceTimersByTimeAsync(2000);
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('document retirement boundary', () => {
  it('releases cached PDF bytes and fingerprint synchronously when returning to the library', async () => {
    vi.useFakeTimers();
    await bookStore.getState().loadDocument(new File([new Uint8Array(5 * 1024 * 1024)], 'memory.pdf'));
    expect(pdfService.getDocumentData()?.byteLength).toBe(5 * 1024 * 1024);
    bookStore.getState().reset();
    expect(pdfService.getDocumentData()?.byteLength ?? 0).toBe(0);
    expect(pdfService.getDocumentFingerprint()).toBeNull();
    expect(pdfService.hasLoadedDocument()).toBe(false);
  });

  it('does not create thumbnail work after close beats its first microtask', async () => {
    vi.useFakeTimers();
    await bookStore.getState().loadDocument(new File(['pdf'], 'memory.pdf'));
    const pending = thumbnailService.ensureThumbnail(2).catch(() => undefined);
    bookStore.getState().reset();
    await flush();
    expect(WorkerMock.instances).toHaveLength(0);
    expect(thumbnailStore.getState().entries).toEqual({});
    await pending;
  });
  it('clears source bytes before publishing the next loading state', async () => {
    vi.useFakeTimers();
    await bookStore.getState().loadDocument(new File(['pdf'], 'memory.pdf'));
    bookStore.getState().startLoading();
    expect(bookStore.getState().status).toBe('loading');
    expect(pdfService.getDocumentData()).toBeNull();
    expect(pdfService.getDocumentFingerprint()).toBeNull();
    await thumbnailService.ensureThumbnail(1);
    expect(WorkerMock.instances).toHaveLength(0);
  });

  it('never activates cached bytes for a mismatched or missing ready source', async () => {
    vi.useFakeTimers();
    await bookStore.getState().loadDocument(new File(['pdf'], 'memory.pdf'));
    const activate = vi.spyOn(thumbnailService, 'activateDocument');
    const release = vi.spyOn(thumbnailService, 'releaseDocument');
    bookStore.getState().setDocumentReady({ documentId: 'different-book', totalPages: 12 });
    expect(activate).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    await pdfService.destroy();
    vi.spyOn(pdfService, 'getDocumentFingerprint').mockReturnValue('same-book');
    bookStore.getState().setDocumentReady({ documentId: 'same-book', totalPages: 12 });
    expect(activate).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('does not reactivate cached source after an in-flight metadata load is reset', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const promise = new Promise(resolve => { finish = resolve; });
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValueOnce({ promise, destroy });
    const loading = bookStore.getState().loadDocument(new File(['pdf'], 'memory.pdf'));
    const cancelled = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(getDocument).toHaveBeenCalledOnce();
    bookStore.getState().reset();
    expect(destroy).not.toHaveBeenCalled();
    finish({ numPages: 12, fingerprints: ['same-book'], getOutline: vi.fn().mockResolvedValue(null) });
    await cancelled;
    expect(destroy).toHaveBeenCalledOnce();
    expect(pdfService.getDocumentData()).toBeNull();
    expect(bookStore.getState().status).toBe('idle');
    expect(thumbnailService.getThumbnailKey(1)).toBe('unloaded_1_180');
  });

});
