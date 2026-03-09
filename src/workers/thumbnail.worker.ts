import * as pdfjsLib from 'pdfjs-dist';

// 在 Worker 内部，我们直接从核心库加载，不再设置 GlobalWorkerOptions.workerSrc
// 因为 Worker 本身就是执行环境，不需要再指定另一个 worker 路径

const worker = self as any;

worker.onmessage = async (event: MessageEvent<any>) => {
  const message = event.data;
  if (message.type !== 'render') return;

  try {
    const loadingTask = pdfjsLib.getDocument({
      url: message.source,
      cMapUrl: `https://unpkg.com/pdfjs-dist@5.4.296/cmaps/`,
      cMapPacked: true,
    });

    const document = await loadingTask.promise;
    const page = await document.getPage(message.pageNumber);
    
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = message.maxWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });
    
    // 使用 Worker 自带的 OffscreenCanvas
    const canvas = new OffscreenCanvas(
      Math.floor(viewport.width), 
      Math.floor(viewport.height)
    );
    
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Worker Canvas Context Null');

    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context as any,
      viewport,
      canvas: null as any
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

    page.cleanup();
    await document.destroy();
  } catch (error: any) {
    worker.postMessage({
      type: 'error',
      error: error.message || 'Unknown Worker Error',
      id: message.id,
      key: message.key,
      pageNumber: message.pageNumber,
    });
  }
};
