import * as pdfjsLib from 'pdfjs-dist';
import { pdfDecoderAssetsUrl } from './pdfDecoderAssets';
import { thumbnailStore } from '../stores/thumbnailStore';
import type { ThumbnailWorkerRequest, ThumbnailWorkerResponse } from './thumbnailProtocol';

const DEFAULT_THUMBNAIL_WIDTH = 180;
const MAX_CACHE_ENTRIES = 120;
const THUMBNAIL_RENDER_TIMEOUT_MS = 1800;

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
}

interface Completion {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}
function completion(): Completion {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
interface ThumbnailRequest extends Completion { key: string; pageNumber: number; width: number }
interface WorkerRender extends Completion { id: string }
interface DocumentSession {
  documentId: string;
  totalPages: number;
  source: Uint8Array | null;
  retired: boolean;
  worker: Worker | null;
  workerReady: boolean;
  fallback: boolean;
  loading: Completion | null;
  requests: Map<string, ThumbnailRequest>;
  renders: Map<string, WorkerRender>;
}
interface FallbackJob extends Completion { request: ThumbnailRequest }
interface FallbackSlot {
  session: DocumentSession;
  document: pdfjsLib.PDFDocumentProxy | null;
  loadingTask: pdfjsLib.PDFDocumentLoadingTask | null;
  renderTask: pdfjsLib.RenderTask | null;
  jobs: FallbackJob[];
  draining: boolean;
  disposalError: unknown;
  disposalFailed: boolean;
}
export class ThumbnailUnavailableError extends Error {
  readonly code: 'retiring-document' | 'cleanup-failed';
  constructor(code: 'retiring-document' | 'cleanup-failed') {
    super('上一份文档的预览仍在释放，请稍后重试预览');
    this.name = 'ThumbnailUnavailableError';
    this.code = code;
  }
}
export interface ThumbnailDocument { documentId: string; totalPages: number; source: Uint8Array }

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Thumbnail worker timeout')), THUMBNAIL_RENDER_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

export class ThumbnailService {
  static readonly shared = new ThumbnailService();
  private session: DocumentSession | null = null;
  // A retired main-thread parse retains this single slot until it settles. New
  // sessions may use their worker, but cannot accumulate additional fallback PDFs.
  private fallbackSlot: FallbackSlot | null = null;

  activateDocument({ documentId, totalPages, source }: ThumbnailDocument) {
    this.releaseDocument();
    this.session = {
      documentId, totalPages, source, retired: false, worker: null, workerReady: false,
      fallback: false, loading: null, requests: new Map(), renders: new Map(),
    };
  }

  releaseDocument() {
    const session = this.session;
    this.session = null;
    if (session) {
      session.retired = true;
      session.source = null;
      this.stopWorker(session, new Error('Thumbnail document retired'));
      session.requests.forEach(request => request.resolve());
      session.requests.clear();
      const slot = this.fallbackSlot;
      if (slot?.session === session) {
        slot.jobs.splice(0).forEach(job => job.resolve());
        try { slot.renderTask?.cancel(); }
        catch { /* Keep observing the original render before attempting disposal. */ }
        this.drainFallback(slot);
      }
    }
    thumbnailStore.getState().reset();
  }

  private current(session: DocumentSession): boolean { return this.session === session && !session.retired; }

  private stopWorker(session: DocumentSession, error: Error) {
    const worker = session.worker;
    session.worker = null;
    session.workerReady = false;
    session.loading?.reject(error);
    session.loading = null;
    session.renders.forEach(pending => pending.reject(error));
    session.renders.clear();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  }

  private ensureWorker(session: DocumentSession): Worker | null {
    if (!this.current(session) || session.fallback || typeof Worker === 'undefined') return null;
    if (!session.worker) {
      let worker: Worker;
      try { worker = new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), { type: 'module' }); }
      catch { session.fallback = true; return null; }
      session.worker = worker;
      worker.onmessage = (event: MessageEvent<ThumbnailWorkerResponse>) => {
        if (this.current(session) && session.worker === worker) this.handleWorkerMessage(session, event.data);
      };
      worker.onerror = (event) => {
        if (!this.current(session) || session.worker !== worker) return;
        session.fallback = true;
        this.stopWorker(session, new Error(event.message || 'Thumbnail worker failed'));
      };
    }
    return session.worker;
  }

  private handleWorkerMessage(session: DocumentSession, message: ThumbnailWorkerResponse) {
    if (message.type === 'document-ready' || message.type === 'document-error') {
      if (message.documentId !== session.documentId || !session.loading) return;
      const pending = session.loading;
      session.loading = null;
      if (message.type === 'document-ready') { session.workerReady = true; pending.resolve(); }
      else pending.reject(new Error(message.error));
      return;
    }
    const pending = session.renders.get(message.key);
    if (!pending || pending.id !== message.id) return;
    session.renders.delete(message.key);
    if (message.type === 'error') { pending.reject(new Error(message.error)); return; }
    if (session.requests.has(message.key)) this.publish(session, message.key, message.blob, message.width, message.height);
    pending.resolve();
  }

  private ensureWorkerDocument(session: DocumentSession, worker: Worker): Promise<void> {
    if (session.workerReady) return Promise.resolve();
    if (session.loading) return session.loading.promise;
    const pending = completion();
    session.loading = pending;
    const sourceCopy = Uint8Array.from(session.source!);
    try {
      worker.postMessage({ documentId: session.documentId, source: sourceCopy.buffer, wasmUrl: pdfDecoderAssetsUrl(pdfjsLib.version), type: 'load-document' } satisfies ThumbnailWorkerRequest, [sourceCopy.buffer]);
    } catch (error) { pending.reject(error); }
    return pending.promise;
  }

  private async render(session: DocumentSession, request: ThumbnailRequest) {
    if (!this.current(session)) return;
    const worker = this.ensureWorker(session);
    if (worker) {
      try {
        await withTimeout(this.ensureWorkerDocument(session, worker));
        if (!this.current(session)) return;
        if (session.worker !== worker || session.fallback) throw new Error('Thumbnail worker retired before render');
        const pending = { ...completion(), id: crypto.randomUUID() };
        session.renders.set(request.key, pending);
        try {
          worker.postMessage({ documentId: session.documentId, id: pending.id, key: request.key,
            maxWidth: request.width, pageNumber: request.pageNumber, type: 'render' } satisfies ThumbnailWorkerRequest);
        } catch (error) { pending.reject(error); }
        await withTimeout(pending.promise);
        return;
      } catch (error) {
        if (!this.current(session)) return;
        if (session.worker === worker) {
          session.fallback = true;
          this.stopWorker(session, error instanceof Error ? error : new Error('Thumbnail worker failed'));
        }
      }
    }
    if (this.current(session)) await this.enqueueFallback(session, request);
  }

  private enqueueFallback(session: DocumentSession, request: ThumbnailRequest): Promise<void> {
    let slot = this.fallbackSlot;
    if (slot && (slot.session !== session || slot.disposalFailed)) {
      return Promise.reject(new ThumbnailUnavailableError(slot.disposalFailed ? 'cleanup-failed' : 'retiring-document'));
    }
    if (!slot) {
      slot = { session, document: null, loadingTask: null, renderTask: null, jobs: [], draining: false, disposalError: null, disposalFailed: false };
      this.fallbackSlot = slot;
    }
    const job = { ...completion(), request };
    slot.jobs.push(job);
    this.drainFallback(slot);
    return job.promise;
  }

  private drainFallback(slot: FallbackSlot) {
    if (slot.draining || slot.disposalFailed) return;
    slot.draining = true;
    void (async () => {
      try {
        while (slot.jobs.length && this.current(slot.session)) {
          const job = slot.jobs.shift()!;
          try { await this.renderFallback(slot, job.request); job.resolve(); }
          catch (error) { job.reject(error); }
          if (slot.disposalFailed) break;
        }
      } finally {
        if (slot.session.retired) {
          if (!slot.disposalFailed) {
            try { await this.disposeFallback(slot); }
            catch (error) { slot.disposalError = error; slot.disposalFailed = true; }
          }
          if (!slot.disposalFailed && this.fallbackSlot === slot) this.fallbackSlot = null;
        }
        slot.draining = false;
        if (slot.disposalFailed) slot.jobs.splice(0).forEach(job => job.reject(slot.disposalError));
      }
    })();
  }

  private async disposeFallback(slot: FallbackSlot) {
    // Only called after the loading promise and the active page/render operation
    // have settled. Destroying an in-flight PDF.js parse can detach a rejection.
    await slot.loadingTask?.destroy();
    slot.loadingTask = null;
    slot.document = null;
  }

  private async renderFallback(slot: FallbackSlot, request: ThumbnailRequest) {
    const session = slot.session;
    if (!this.current(session)) return;
    if (!slot.document) {
      slot.loadingTask = pdfjsLib.getDocument({ data: Uint8Array.from(session.source!), wasmUrl: pdfDecoderAssetsUrl(pdfjsLib.version), isEvalSupported: false, useWorkerFetch: false });
      try { slot.document = await slot.loadingTask.promise; }
      catch (error) {
        try { await this.disposeFallback(slot); }
        catch (cleanupError) { slot.disposalError = cleanupError; slot.disposalFailed = true; }
        throw error;
      }
    }
    if (!this.current(session)) return;
    const page = await slot.document.getPage(request.pageNumber);
    let canvas: HTMLCanvasElement | null = null;
    try {
      if (!this.current(session)) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: request.width / base.width });
      canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Thumbnail canvas context unavailable');
      context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
      slot.renderTask = page.render({ canvas, canvasContext: context, viewport });
      try { await slot.renderTask.promise; } finally { slot.renderTask = null; }
      if (!this.current(session)) return;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas!.toBlob(value => value ? resolve(value) : reject(new Error('Failed to encode thumbnail blob')), 'image/webp', 0.82);
      });
      if (this.current(session)) this.publish(session, request.key, blob, canvas.width, canvas.height);
    } finally {
      try { page.cleanup(); }
      finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
    }
  }

  private publish(session: DocumentSession, key: string, blob: Blob, width: number, height: number) {
    if (!this.current(session)) return;
    thumbnailStore.getState().markReady({ blobUrl: URL.createObjectURL(blob), height, key, width });
    thumbnailStore.getState().touchEntry(key);
    this.trimCache(session);
  }

  private trimCache(session: DocumentSession) {
    if (!this.current(session)) return;
    thumbnailStore.getState().lruKeys.slice(MAX_CACHE_ENTRIES)
      .filter(key => !session.requests.has(key)).forEach(key => thumbnailStore.getState().removeEntry(key));
  }

  ensureThumbnail(pageNumber: number, maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<void> {
    const session = this.session;
    if (!session || !Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > session.totalPages) return Promise.resolve();
    pageNumber = Math.round(pageNumber);
    const width = Number.isFinite(maxWidth) ? Math.max(48, Math.round(maxWidth)) : DEFAULT_THUMBNAIL_WIDTH;
    const key = this.getThumbnailKey(pageNumber, width);
    if (thumbnailStore.getState().getEntry(key)?.status === 'ready') {
      thumbnailStore.getState().touchEntry(key); return Promise.resolve();
    }
    const pending = session.requests.get(key);
    if (pending) return pending.promise;
    const request = { ...completion(), key, pageNumber, width };
    session.requests.set(key, request);
    thumbnailStore.getState().markQueued({ key, pageNumber, width });
    thumbnailStore.getState().markRendering(key);
    const finish = (failed: boolean, error?: unknown) => {
      if (session.requests.get(key) === request) session.requests.delete(key);
      this.trimCache(session);
      if (failed && this.current(session)) {
        thumbnailStore.getState().markError(key); request.reject(error);
      } else request.resolve();
    };
    void Promise.resolve().then(() => this.render(session, request)).then(() => finish(false), error => finish(true, error));
    return request.promise;
  }

  async ensureThumbnails(pages: number[], maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<void> {
    await Promise.allSettled(Array.from(new Set(pages.filter(page => Number.isFinite(page) && page > 0)))
      .map(page => this.ensureThumbnail(page, maxWidth)));
  }

  getThumbnailKey(pageNumber: number, width = DEFAULT_THUMBNAIL_WIDTH): string {
    return `${this.session?.documentId ?? 'unloaded'}_${Math.max(1, Math.round(pageNumber))}_${Math.max(48, Math.round(width))}`;
  }
}
export const thumbnailService = ThumbnailService.shared;
