import { thumbnailStore } from '../stores/thumbnailStore';
import type { ThumbnailEntry } from '../types/domain';
import { pdfService } from './PDFService';
import type { PDFService } from './PDFService';
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
  private readonly inflight = new Map<string, Promise<string | undefined>>();
  private readonly pending = new Map<string, PendingWorkerRequest>();
  private pdf: PDFService;
  private requestSequence = 0;
  private worker: Worker | null = null;

  constructor(pdf: PDFService = pdfService) {
    this.pdf = pdf;
  }

  async ensureThumbnail(pageNumber: number, maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<string | undefined> {
    const source = this.pdf.getDocumentData();
    const key = this.getThumbnailKey(pageNumber, maxWidth);

    if (!source || !key) {
      return undefined;
    }

    const cached = thumbnailStore.getState().getEntry(key);

    if (cached?.status === 'ready' && cached.blobUrl) {
      thumbnailStore.getState().touchEntry(key);
      return cached.blobUrl;
    }

    const pendingRender = this.inflight.get(key);

    if (pendingRender) {
      return pendingRender;
    }

    thumbnailStore.getState().markQueued({
      key,
      pageNumber,
      width: maxWidth,
    });

    const renderPromise = this.renderThumbnail({
      id: `${Date.now()}-${++this.requestSequence}`,
      key,
      maxWidth,
      pageNumber,
      source: this.cloneBuffer(source),
      type: 'render',
    })
      .then((payload) => {
        const current = thumbnailStore.getState().getEntry(key);

        if (current?.blobUrl) {
          URL.revokeObjectURL(current.blobUrl);
        }

        const blobUrl = URL.createObjectURL(payload.blob);
        thumbnailStore.getState().markReady({
          blobUrl,
          height: payload.height,
          key,
          width: payload.width,
        });

        return blobUrl;
      })
      .catch((error) => {
        thumbnailStore.getState().markError(key);
        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    thumbnailStore.getState().markRendering(key);
    this.inflight.set(key, renderPromise);

    return renderPromise;
  }

  async ensureThumbnails(pageNumbers: number[], maxWidth = DEFAULT_THUMBNAIL_WIDTH): Promise<void> {
    await Promise.all(pageNumbers.map((pageNumber) => this.ensureThumbnail(pageNumber, maxWidth)));
  }

  getEntry(key: string): ThumbnailEntry | undefined {
    return thumbnailStore.getState().getEntry(key);
  }

  getThumbnailKey(pageNumber: number, maxWidth = DEFAULT_THUMBNAIL_WIDTH): string | undefined {
    const fingerprint = this.pdf.getDocumentFingerprint();

    if (!fingerprint) {
      return undefined;
    }

    return `${fingerprint}_${pageNumber}_${maxWidth}`;
  }

  releaseThumbnail(key: string): void {
    const entry = thumbnailStore.getState().getEntry(key);

    if (entry?.blobUrl) {
      URL.revokeObjectURL(entry.blobUrl);
    }

    thumbnailStore.getState().removeEntry(key);
    this.inflight.delete(key);
  }

  dispose(): void {
    for (const entry of Object.values(thumbnailStore.getState().entries)) {
      if (entry.blobUrl) {
        URL.revokeObjectURL(entry.blobUrl);
      }
    }

    thumbnailStore.getState().reset();
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

  private cloneBuffer(source: Uint8Array): ArrayBuffer {
    return source.slice().buffer as ArrayBuffer;
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
    thumbnailStore.getState().markRendering(request.key);

    return new Promise<ThumbnailRenderSuccess>((resolve, reject) => {
      this.pending.set(request.id, { reject, resolve });
      worker.postMessage(request);
    });
  }
}

export const thumbnailService = new ThumbnailService();
