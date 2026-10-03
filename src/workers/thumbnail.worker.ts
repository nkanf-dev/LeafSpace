import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/build/pdf.worker.mjs';
import { WorkerCanvasFactory } from './WorkerCanvasFactory';
import { WorkerWasmFactory } from './WorkerWasmFactory';
import type { ThumbnailRenderRequest, ThumbnailWorkerRequest, ThumbnailWorkerResponse } from '../services/thumbnailProtocol';

// 在 Worker 内部，我们直接从核心库加载，不再设置 GlobalWorkerOptions.workerSrc
// 并且通过 side-effect import 将 WorkerMessageHandler 挂到 globalThis.pdfjsWorker，
// 让 getDocument 在当前 worker 内走 fake-worker 模式，而不是再尝试启动二级 worker。

const worker = self as unknown as {
  postMessage: (message: ThumbnailWorkerResponse) => void;
  onmessage: ((event: MessageEvent<ThumbnailWorkerRequest>) => void) | null;
};
let currentDocumentId: string | null = null;
let currentLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
let currentDocument: pdfjsLib.PDFDocumentProxy | null = null;
let renderQueue = Promise.resolve();

async function disposeCurrentDocument() {
  if (currentDocument) {
    await currentDocument.destroy();
    currentDocument = null;
  }

  if (currentLoadingTask && typeof currentLoadingTask.destroy === 'function') {
    await currentLoadingTask.destroy();
    currentLoadingTask = null;
  }

  currentDocumentId = null;
}

async function ensureDocumentLoaded(documentId: string, source: ArrayBuffer, wasmUrl: string) {
  if (currentDocumentId === documentId && currentDocument) {
    worker.postMessage({ type: 'document-ready', documentId });
    return;
  }

  await disposeCurrentDocument();

  currentLoadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(source),
    cMapUrl: `https://unpkg.com/pdfjs-dist@5.4.296/cmaps/`,
    cMapPacked: true,
    wasmUrl,
    WasmFactory: WorkerWasmFactory,
    CanvasFactory: WorkerCanvasFactory,
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  currentDocument = await currentLoadingTask.promise;
  currentDocumentId = documentId;
  worker.postMessage({ type: 'document-ready', documentId });
}

async function renderThumbnail(message: ThumbnailRenderRequest) {
  if (message.documentId !== currentDocumentId || !currentDocument) {
    throw new Error('Thumbnail document is not ready.');
  }

  let page: pdfjsLib.PDFPageProxy | null = null;

  try {
    page = await currentDocument.getPage(message.pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = message.maxWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = new OffscreenCanvas(
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height)),
    );

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Worker Canvas Context Null');

    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      // PDF.js accepts the compatible offscreen 2D context at runtime;
      // its published DOM-only type does not include OffscreenCanvas yet.
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: null,
    }).promise;

    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });

    worker.postMessage({
      type: 'success',
      blob,
      height: canvas.height,
      id: message.id,
      key: message.key,
      pageNumber: message.pageNumber,
      width: canvas.width,
    });
  } finally {
    page?.cleanup();
  }
}

worker.onmessage = (event: MessageEvent<ThumbnailWorkerRequest>) => {
  const message = event.data;
  // Loading and rendering must share a queue: a new document cannot destroy
  // the PDF proxy while an earlier thumbnail is still being rendered.
  renderQueue = renderQueue.then(async () => {
    if (message.type === 'load-document') {
      try {
        await ensureDocumentLoaded(message.documentId, message.source, message.wasmUrl);
      } catch (error) {
        worker.postMessage({
          type: 'document-error', documentId: message.documentId,
          error: error instanceof Error ? error.message : 'Failed to load thumbnail document',
        });
      }
      return;
    }
    try {
      await renderThumbnail(message);
    } catch (error) {
      worker.postMessage({
        type: 'error', id: message.id, key: message.key, pageNumber: message.pageNumber,
        error: error instanceof Error ? error.message : 'Unknown worker error',
      });
    }
  }).catch(() => undefined);
};
