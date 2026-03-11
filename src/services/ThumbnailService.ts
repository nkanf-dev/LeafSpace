import * as pdfjsLib from 'pdfjs-dist';
import { pdfService } from './PDFService';
import { bookStore } from '../stores/bookStore';
import { thumbnailStore } from '../stores/thumbnailStore';
import type { ThumbnailWorkerRequest, ThumbnailWorkerResponse } from './thumbnailProtocol';

const DEFAULT_THUMBNAIL_WIDTH = 180;
const MAX_CACHE_ENTRIES = 120;
const THUMBNAIL_RENDER_TIMEOUT_MS = 1800;

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
}

interface PendingThumbnailRequest {
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
}

interface PendingWorkerRender {
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
}

interface PendingDocumentLoad {
  documentId: string;
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
}

function isActiveThumbnailStatus(status: string | undefined): status is 'queued' | 'rendering' {
  return status === 'queued' || status === 'rendering';
}

export class ThumbnailService {
  static readonly shared = new ThumbnailService();

  private activeDocumentId: string | null = null;
  private fallbackToMainThread = false;
  private mainThreadDocument: pdfjsLib.PDFDocumentProxy | null = null;
  private mainThreadDocumentId: string | null = null;
  private mainThreadDocumentPromise: Promise<pdfjsLib.PDFDocumentProxy> | null = null;
  private mainThreadLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  private pendingDocumentLoad: PendingDocumentLoad | null = null;
  private pendingByKey = new Map<string, PendingThumbnailRequest>();
  private pendingWorkerRenders = new Map<string, PendingWorkerRender>();
  private worker: Worker | null = null;

  private ensureWorker(): Worker | null {
    if (typeof Worker === 'undefined') {
      return null;
    }

    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<ThumbnailWorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = (event) => {
        const error = new Error(event.message || 'Thumbnail worker failed');
        this.fallbackToMainThread = true;

        if (this.pendingDocumentLoad) {
          this.pendingDocumentLoad.reject(error);
          this.pendingDocumentLoad = null;
        }
        this.activeDocumentId = null;

        this.pendingByKey.forEach((pending, key) => {
          thumbnailStore.getState().markError(key);
          pending.reject(error);
        });
        this.pendingWorkerRenders.forEach((pending) => pending.reject(error));

        this.pendingByKey.clear();
        this.pendingWorkerRenders.clear();
      };
    }

    return this.worker;
  }

  private async disposeMainThreadDocument() {
    if (this.mainThreadDocument) {
      await this.mainThreadDocument.destroy();
      this.mainThreadDocument = null;
    }

    if (this.mainThreadLoadingTask && typeof this.mainThreadLoadingTask.destroy === 'function') {
      await this.mainThreadLoadingTask.destroy();
      this.mainThreadLoadingTask = null;
    }

    this.mainThreadDocumentId = null;
    this.mainThreadDocumentPromise = null;
  }

  private getDocumentScope(): string | null {
    return bookStore.getState().documentId ?? pdfService.getDocumentFingerprint();
  }

  private handleWorkerMessage(message: ThumbnailWorkerResponse) {
    if (message.type === 'document-ready') {
      if (this.pendingDocumentLoad?.documentId === message.documentId) {
        this.activeDocumentId = message.documentId;
        this.pendingDocumentLoad.resolve();
        this.pendingDocumentLoad = null;
      }
      return;
    }

    if (message.type === 'document-error') {
      if (this.pendingDocumentLoad?.documentId === message.documentId) {
        this.activeDocumentId = null;
        this.fallbackToMainThread = true;
        this.pendingDocumentLoad.reject(new Error(message.error));
        this.pendingDocumentLoad = null;
      }
      return;
    }

    const pending = this.pendingByKey.get(message.key);
    const workerPending = this.pendingWorkerRenders.get(message.key);

    if (message.type === 'error') {
      this.pendingWorkerRenders.delete(message.key);

      if (workerPending) {
        workerPending.reject(new Error(message.error));
      }

      return;
    }

    if (!pending) {
      return;
    }

    this.pendingWorkerRenders.delete(message.key);
    workerPending?.resolve();

    const current = thumbnailStore.getState().getEntry(message.key);

    if (current?.blobUrl) {
      URL.revokeObjectURL(current.blobUrl);
    }

    thumbnailStore.getState().markReady({
      blobUrl: URL.createObjectURL(message.blob),
      height: message.height,
      key: message.key,
      width: message.width,
    });
    thumbnailStore.getState().touchEntry(message.key);
    this.trimCache();
    pending.resolve();
  }

  private async ensureMainThreadDocument(documentId: string, source: Uint8Array): Promise<pdfjsLib.PDFDocumentProxy> {
    if (this.mainThreadDocumentId === documentId && this.mainThreadDocument) {
      return this.mainThreadDocument;
    }

    if (this.mainThreadDocumentId === documentId && this.mainThreadDocumentPromise) {
      return this.mainThreadDocumentPromise;
    }

    await this.disposeMainThreadDocument();

    const sourceCopy = new Uint8Array(source.byteLength);
    sourceCopy.set(source);

    this.mainThreadLoadingTask = pdfjsLib.getDocument({
      data: sourceCopy,
      isEvalSupported: false,
      useWorkerFetch: false,
    });

    this.mainThreadDocumentId = documentId;
    this.mainThreadDocumentPromise = this.mainThreadLoadingTask.promise.then((document) => {
      this.mainThreadDocument = document;
      return document;
    });

    return this.mainThreadDocumentPromise;
  }

  private async renderThumbnailOnMainThread(key: string, documentId: string, pageNumber: number, width: number, source: Uint8Array): Promise<void> {
    const pdfDocument = await this.ensureMainThreadDocument(documentId, source);
    const page = await pdfDocument.getPage(pageNumber);

    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = width / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Thumbnail canvas context unavailable');
      }

      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas: null as any,
        canvasContext: context,
        viewport,
      }).promise;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) {
            resolve(value);
            return;
          }

          reject(new Error('Failed to encode thumbnail blob'));
        }, 'image/webp', 0.82);
      });

      const current = thumbnailStore.getState().getEntry(key);
      if (current?.blobUrl) {
        URL.revokeObjectURL(current.blobUrl);
      }

      thumbnailStore.getState().markReady({
        blobUrl: URL.createObjectURL(blob),
        height: canvas.height,
        key,
        width: canvas.width,
      });
      thumbnailStore.getState().touchEntry(key);
      this.trimCache();
    } finally {
      page.cleanup();
    }
  }

  private createPendingWorkerRender(key: string): PendingWorkerRender {
    let resolvePending!: () => void;
    let rejectPending!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePending = () => {
        this.pendingWorkerRenders.delete(key);
        resolve();
      };
      rejectPending = (error) => {
        this.pendingWorkerRenders.delete(key);
        reject(error);
      };
    });

    const pending = {
      promise,
      reject: rejectPending,
      resolve: resolvePending,
    };

    this.pendingWorkerRenders.set(key, pending);

    return pending;
  }

  private async renderThumbnailWithFallback(key: string, documentId: string, pageNumber: number, width: number, source: Uint8Array, worker: Worker): Promise<void> {
    if (this.fallbackToMainThread) {
      await this.renderThumbnailOnMainThread(key, documentId, pageNumber, width, source);
      return;
    }

    try {
      await this.ensureWorkerDocument(documentId, source, worker);

      const request: ThumbnailWorkerRequest = {
        documentId,
        id: crypto.randomUUID(),
        key,
        maxWidth: width,
        pageNumber,
        type: 'render',
      };

      const pendingWorkerRender = this.createPendingWorkerRender(key);

      worker.postMessage(request);

      await Promise.race([
        pendingWorkerRender.promise,
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Thumbnail worker render timeout')), THUMBNAIL_RENDER_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.fallbackToMainThread = true;
      this.pendingWorkerRenders.delete(key);
      await this.renderThumbnailOnMainThread(key, documentId, pageNumber, width, source);
    }
  }

  private async ensureWorkerDocument(documentId: string, source: Uint8Array, worker: Worker): Promise<void> {
    if (this.activeDocumentId === documentId) {
      return;
    }

    if (this.pendingDocumentLoad?.documentId === documentId) {
      return this.pendingDocumentLoad.promise;
    }

    if (this.pendingDocumentLoad) {
      this.pendingDocumentLoad.reject(new Error('Thumbnail document load superseded by a new document.'));
      this.pendingDocumentLoad = null;
    }

    let resolvePending!: () => void;
    let rejectPending!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });

    this.pendingDocumentLoad = {
      documentId,
      promise,
      reject: rejectPending,
      resolve: resolvePending,
    };

    const sourceCopy = new Uint8Array(source.byteLength);
    sourceCopy.set(source);

    worker.postMessage(
      {
        documentId,
        source: sourceCopy.buffer,
        type: 'load-document',
      },
      [sourceCopy.buffer],
    );

    return promise;
  }

  private trimCache() {
    const state = thumbnailStore.getState();
    const removableKeys = state.lruKeys.slice(MAX_CACHE_ENTRIES).filter((key) => !this.pendingByKey.has(key));

    removableKeys.forEach((key) => {
      const entry = state.entries[key];

      if (entry?.blobUrl) {
        URL.revokeObjectURL(entry.blobUrl);
      }

      thumbnailStore.getState().removeEntry(key);
    });
  }

  async ensureThumbnail(pageNumber: number, maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<void> {
    const width = Math.max(48, Math.round(maxWidth));
    const source = pdfService.getDocumentData();
    const documentId = this.getDocumentScope();
    const worker = this.ensureWorker();
    const key = this.getThumbnailKey(pageNumber, width);
    const existing = thumbnailStore.getState().getEntry(key);

    if (!source || !worker || !documentId) {
      return;
    }

    if (existing?.status === 'ready') {
      thumbnailStore.getState().touchEntry(key);
      return;
    }

    const pending = this.pendingByKey.get(key);

    if (pending) {
      return pending.promise;
    }

    if (!existing || !isActiveThumbnailStatus(existing.status)) {
      thumbnailStore.getState().markQueued({ key, pageNumber, width });
    }
    thumbnailStore.getState().markRendering(key);

    let resolvePending!: () => void;
    let rejectPending!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePending = () => {
        this.pendingByKey.delete(key);
        resolve();
      };
      rejectPending = (error) => {
        this.pendingByKey.delete(key);
        reject(error);
      };
    });

    this.pendingByKey.set(key, {
      promise,
      reject: rejectPending,
      resolve: resolvePending,
    });

    try {
      await this.renderThumbnailWithFallback(key, documentId, pageNumber, width, source, worker);
      resolvePending();
    } catch (error) {
      thumbnailStore.getState().markError(key);
      rejectPending(error instanceof Error ? error : new Error('Thumbnail render failed'));
      throw error;
    }

    return promise;
  }

  async ensureThumbnails(pages: number[], maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<void> {
    const uniquePages = Array.from(new Set(pages.filter((page) => Number.isFinite(page) && page > 0)));
    await Promise.allSettled(uniquePages.map((page) => this.ensureThumbnail(page, maxWidth)));
  }

  getThumbnailKey(pageNumber: number, width = DEFAULT_THUMBNAIL_WIDTH): string {
    const documentScope = this.getDocumentScope() ?? 'unloaded';
    return `${documentScope}_${Math.max(1, Math.round(pageNumber))}_${Math.max(48, Math.round(width))}`;
  }
}

export const thumbnailService = ThumbnailService.shared;
