import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

const DEFAULT_MAX_CONCURRENT_RENDERS = 2;

export interface RenderPageParams {
  pageNumber: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  scale?: number;
  signal?: AbortSignal;
}

export interface RenderPageResult {
  pageNumber: number;
  width: number;
  height: number;
}

interface PdfJsRuntime {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (src: { data: Uint8Array }) => PDFDocumentLoadingTask;
}

interface QueuedRender {
  reject: (reason?: unknown) => void;
  run: () => void;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === 'string' ? error : 'Unknown PDF error');
}

function createAbortError(message: string): Error {
  return new DOMException(message, 'AbortError');
}

export class PDFService {
  static readonly shared = new PDFService();

  private activeDocument: PDFDocumentProxy | null = null;
  private documentBytes: Uint8Array | null = null;
  private documentFingerprint: string | null = null;
  private activeRenderCount = 0;
  private loadSequence = 0;
  private maxConcurrentRenders: number;
  private pendingLoadTask: PDFDocumentLoadingTask | null = null;
  private runtimePromise: Promise<PdfJsRuntime> | null = null;
  private readonly queuedRenders: QueuedRender[] = [];

  constructor(maxConcurrentRenders = DEFAULT_MAX_CONCURRENT_RENDERS) {
    this.maxConcurrentRenders = maxConcurrentRenders;
  }

  async loadDocument(fileOrUrl: File | string): Promise<PDFDocumentProxy> {
    const requestId = ++this.loadSequence;
    const source = await this.readSource(fileOrUrl);
    const runtime = await this.getRuntime();

    if (requestId !== this.loadSequence) {
      throw createAbortError('PDF load request was superseded by a newer request.');
    }

    const loadingTask = runtime.getDocument({ data: source });
    this.pendingLoadTask = loadingTask;

    try {
      const nextDocument = await loadingTask.promise;

      if (requestId !== this.loadSequence) {
        await loadingTask.destroy();
        throw createAbortError('PDF load request was superseded by a newer request.');
      }

      await this.destroyLoadedDocument();

      this.activeDocument = nextDocument;
      this.documentBytes = source;
      this.documentFingerprint = nextDocument.fingerprints[0] ?? loadingTask.docId;

      return nextDocument;
    } catch (error) {
      throw normalizeError(error);
    } finally {
      if (this.pendingLoadTask === loadingTask) {
        this.pendingLoadTask = null;
      }
    }
  }

  async getPage(pageNumber: number): Promise<PDFPageProxy> {
    const document = this.ensureDocument();

    if (pageNumber < 1 || pageNumber > document.numPages) {
      throw new RangeError(`Page ${pageNumber} is outside the loaded document bounds.`);
    }

    return document.getPage(pageNumber);
  }

  async renderPage({ pageNumber, canvas, scale = 1, signal }: RenderPageParams): Promise<RenderPageResult> {
    if (signal?.aborted) {
      throw createAbortError('Render request was aborted before it started.');
    }

    return this.scheduleRender(async () => {
      const page = await this.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const context = canvas.getContext('2d', { alpha: false }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;

      if (!context) {
        throw new Error('Unable to acquire a 2D canvas context for PDF rendering.');
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const renderTask = page.render({
        canvas: canvas as HTMLCanvasElement,
        canvasContext: context as CanvasRenderingContext2D,
        viewport,
      });

      const abortHandler = () => {
        renderTask.cancel();
      };

      signal?.addEventListener('abort', abortHandler, { once: true });

      try {
        await renderTask.promise;

        return {
          pageNumber,
          width: canvas.width,
          height: canvas.height,
        };
      } catch (error) {
        if (signal?.aborted) {
          throw createAbortError('Render request was aborted.');
        }

        throw normalizeError(error);
      } finally {
        signal?.removeEventListener('abort', abortHandler);
        this.cleanupPageRender(page, renderTask);
      }
    });
  }

  getTotalPages(): number {
    return this.activeDocument?.numPages ?? 0;
  }

  getDocumentFingerprint(): string | null {
    return this.documentFingerprint;
  }

  getDocumentData(): Uint8Array | null {
    return this.documentBytes ? new Uint8Array(this.documentBytes) : null;
  }

  hasLoadedDocument(): boolean {
    return this.activeDocument !== null;
  }

  async destroy(): Promise<void> {
    this.loadSequence += 1;

    if (this.pendingLoadTask) {
      const task = this.pendingLoadTask;
      this.pendingLoadTask = null;
      await task.destroy();
    }

    await this.destroyLoadedDocument();
  }

  private async readSource(fileOrUrl: File | string): Promise<Uint8Array> {
    if (typeof fileOrUrl === 'string') {
      const response = await fetch(fileOrUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch PDF document: ${response.status} ${response.statusText}`.trim());
      }

      return new Uint8Array(await response.arrayBuffer());
    }

    return new Uint8Array(await fileOrUrl.arrayBuffer());
  }

  private ensureDocument(): PDFDocumentProxy {
    if (!this.activeDocument) {
      throw new Error('No PDF document has been loaded yet.');
    }

    return this.activeDocument;
  }

  private async destroyLoadedDocument(): Promise<void> {
    this.rejectQueuedRenders(new Error('The active PDF document was replaced or destroyed.'));

    if (this.activeDocument) {
      await this.activeDocument.destroy();
    }

    this.activeDocument = null;
    this.documentBytes = null;
    this.documentFingerprint = null;
  }

  private scheduleRender<T>(factory: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.activeRenderCount += 1;

        factory()
          .then(resolve, reject)
          .finally(() => {
            this.activeRenderCount -= 1;
            this.flushRenderQueue();
          });
      };

      if (this.activeRenderCount < this.maxConcurrentRenders) {
        run();
        return;
      }

      this.queuedRenders.push({ reject, run });
    });
  }

  private flushRenderQueue(): void {
    while (this.activeRenderCount < this.maxConcurrentRenders && this.queuedRenders.length > 0) {
      this.queuedRenders.shift()?.run();
    }
  }

  private rejectQueuedRenders(reason: Error): void {
    while (this.queuedRenders.length > 0) {
      this.queuedRenders.shift()?.reject(reason);
    }
  }

  private cleanupPageRender(page: PDFPageProxy, renderTask: RenderTask): void {
    void renderTask;
    page.cleanup();
  }

  private async getRuntime(): Promise<PdfJsRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = import('pdfjs-dist').then((module) => {
        module.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

        return {
          GlobalWorkerOptions: module.GlobalWorkerOptions,
          getDocument: module.getDocument,
        };
      });
    }

    return this.runtimePromise;
  }

  static loadDocument(fileOrUrl: File | string): Promise<PDFDocumentProxy> {
    return PDFService.shared.loadDocument(fileOrUrl);
  }

  static getPage(pageNumber: number): Promise<PDFPageProxy> {
    return PDFService.shared.getPage(pageNumber);
  }

  static renderPage(params: RenderPageParams): Promise<RenderPageResult> {
    return PDFService.shared.renderPage(params);
  }

  static getTotalPages(): number {
    return PDFService.shared.getTotalPages();
  }

  static getDocumentFingerprint(): string | null {
    return PDFService.shared.getDocumentFingerprint();
  }

  static getDocumentData(): Uint8Array | null {
    return PDFService.shared.getDocumentData();
  }

  static hasLoadedDocument(): boolean {
    return PDFService.shared.hasLoadedDocument();
  }

  static destroy(): Promise<void> {
    return PDFService.shared.destroy();
  }
}

export const pdfService = PDFService.shared;
