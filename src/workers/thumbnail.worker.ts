/// <reference lib="webworker" />

import { getDocument } from 'pdfjs-dist';
import type { ThumbnailWorkerRequest, ThumbnailWorkerResponse } from '../services/thumbnailProtocol';

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ThumbnailWorkerRequest>) => {
  const message = event.data;

  try {
    const response = await renderThumbnail(message);
    workerScope.postMessage(response);
  } catch (error) {
    const response: ThumbnailWorkerResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown thumbnail worker error.',
      id: message.id,
      key: message.key,
      pageNumber: message.pageNumber,
    };

    workerScope.postMessage(response);
  }
};

async function renderThumbnail(message: ThumbnailWorkerRequest): Promise<ThumbnailWorkerResponse> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available for thumbnail rendering.');
  }

  const loadingTask = getDocument({
    data: new Uint8Array(message.source),
  });

  try {
    const document = await loadingTask.promise;
    const page = await document.getPage(message.pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = message.maxWidth > 0 ? message.maxWidth / baseViewport.width : 1;
    const viewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });

    if (!context) {
      throw new Error('Unable to acquire OffscreenCanvas 2D context.');
    }

    const renderTask = page.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    });

    await renderTask.promise;

    const blob = await canvas.convertToBlob({
      quality: 0.85,
      type: 'image/webp',
    });

    page.cleanup();

    return {
      type: 'success',
      blob,
      height: canvas.height,
      id: message.id,
      key: message.key,
      pageNumber: message.pageNumber,
      width: canvas.width,
    };
  } finally {
    await loadingTask.destroy();
  }
}
