import type { ThumbnailEntry } from '../types/domain';
import { pdfService, type PDFService } from './PDFService';
import type {
  ThumbnailRenderSuccess,
  ThumbnailWorkerRequest,
  ThumbnailWorkerResponse,
} from './thumbnailProtocol';

const DEFAULT_THUMBNAIL_WIDTH = 240;

interface PendingWorkerRequest {
  reject: (reason?: unknown) => void;
  resolve: (payload: ThumbnailRenderSuccess) => void;
}

export class ThumbnailService {
  private readonly entries = new Map<string, ThumbnailEntry>();
  private readonly inflight = new Map<string, Promise<string | undefined>>();
  private pdf: PDFService;
  private readonly pending = new Map<string, PendingWorkerRequest>();
  private requestSequence = 0;
  private worker: Worker | null = null;

  constructor(pdf: PDFService = pdfService) {
    this.pdf = pdf;
  }

  async ensureThumbnail(pageNumber: number, maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<string | undefined> {
    const source = this.pdf.getDocumentData();
    const fingerprint = this.pdf.getDocumentFingerprint();

    if (!source || !fingerprint) {
      return undefined;
    }

    const key = this.buildKey(fingerprint, pageNumber, maxWidth);
    const cached = this.entries.get(key);

    if (cached?.status === 'ready' && cached.blobUrl) {
      cached.lastAccessedAt = Date.now();
      return cached.blobUrl;
    }

    const pendingRender = this.inflight.get(key);

    if (pendingRender) {
      return pendingRender;
    }

    const entry: ThumbnailEntry = cached ?? {
      key,
      pageNumber,
      width: maxWidth,
      height: 0,
      status: 'queued',
      lastAccessedAt: Date.now(),
    };

    entry.status = 'queued';
    entry.lastAccessedAt = Date.now();
    this.entries.set(key, entry);

    const renderPromise = this.renderThumbnail({
      id: `${Date.now()}-${++this.requestSequence}`,
      key,
      maxWidth,
      pageNumber,
      source: this.cloneBuffer(source),
      type: 'render',
    })
      .then((payload) => {
        const current = this.entries.get(key);

        if (!current) {
          return undefined;
        }

        if (current.blobUrl) {
          URL.revokeObjectURL(current.blobUrl);
        }

        current.status = 'ready';
        current.width = payload.width;
        current.height = payload.height;
        current.blobUrl = URL.createObjectURL(payload.blob);
        current.lastAccessedAt = Date.now();

        return current.blobUrl;
      })
      .catch((error) => {
        const current = this.entries.get(key);

        if (current) {
          current.status = 'error';
          current.lastAccessedAt = Date.now();
        }

        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    entry.status = 'rendering';
    this.inflight.set(key, renderPromise);

    return renderPromise;
  }

  async ensureThumbnails(pageNumbers: number[], maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<void> {
    await Promise.all(pageNumbers.map((pageNumber) => this.ensureThumbnail(pageNumber, maxWidth)));
  }

  releaseThumbnail(key: string): void {
    const entry = this.entries.get(key);

    if (entry?.blobUrl) {
      URL.revokeObjectURL(entry.blobUrl);
    }

    this.entries.delete(key);
    this.inflight.delete(key);
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.blobUrl) {
        URL.revokeObjectURL(entry.blobUrl);
      }
    }

    this.entries.clear();
    this.inflight.clear();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    const error = new Error('Thumbnail service was disposed.');

    for (const { reject } of this.pending.values()) {
      reject(error);
    }

    this.pending.clear();
  }

  getEntry(key: string): ThumbnailEntry | undefined {
    return this.entries.get(key);
  }

  private buildKey(fingerprint: string, pageNumber: number, maxWidth: number): string {
    return `${fingerprint}_${pageNumber}_${maxWidth}`;
  }

  private cloneBuffer(source: Uint8Array): ArrayBuffer {
    return source.slice().buffer;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = (event: MessageEvent<ThumbnailWorkerResponse>) => {
        const message = event.data;
        const pending = this.pending.get(message.id);

        if (!pending) {
          return;
        }

        this.pending.delete(message.id);

        if (message.type === 'success') {
          pending.resolve(message);
          return;
        }

        pending.reject(new Error(message.error));
      };

      this.worker.onerror = (event) => {
        const error = new Error(event.message || 'Thumbnail worker failed.');

        for (const { reject } of this.pending.values()) {
          reject(error);
        }

        this.pending.clear();
      };
    }

    return this.worker;
  }

  private renderThumbnail(request: ThumbnailWorkerRequest): Promise<ThumbnailRenderSuccess> {
    if (typeof Worker === 'undefined') {
      return Promise.reject(new Error('Thumbnail worker is not available in this runtime.'));
    }

    const worker = this.ensureWorker();
    this.entries.get(request.key)!.status = 'rendering';

    return new Promise<ThumbnailRenderSuccess>((resolve, reject) => {
      this.pending.set(request.id, { reject, resolve });
      worker.postMessage(request);
    });
  }
}

export const thumbnailService = new ThumbnailService();
