import * as pdfjsLib from 'pdfjs-dist';

export type PDFDocumentSource = File | Blob | string;

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

export class PDFService {
  static readonly shared = new PDFService();
  private fingerprint: string | null = null;
  private numPages = 0;
  private hasDoc = false;
  private documentData: Uint8Array | null = null;
  private loadGeneration = 0;

  private clearDocument() {
    this.fingerprint = null;
    this.numPages = 0;
    this.documentData = null;
    this.hasDoc = false;
  }

  private async resolveSource(source: PDFDocumentSource): Promise<Uint8Array> {
    if (typeof source === 'string') {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`读取 PDF 失败：${response.status} ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    return new Uint8Array(await source.arrayBuffer());
  }

  async loadDocument(source: PDFDocumentSource): Promise<{ numPages: number }> {
    const generation = ++this.loadGeneration;
    this.clearDocument();
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | undefined;

    try {
      const sourceBytes = await this.resolveSource(source);
      if (generation !== this.loadGeneration) {
        throw new DOMException('文档加载已取消', 'AbortError');
      }
      // PDF.js transfers its input buffer. Keep a separate source for thumbnails.
      const cacheBytes = cloneBytes(sourceBytes);
      loadingTask = pdfjsLib.getDocument({
        data: cloneBytes(sourceBytes),
        useWorkerFetch: false,
        isEvalSupported: false,
      });
      const doc = await loadingTask.promise;
      if (generation !== this.loadGeneration) {
        throw new DOMException('文档加载已取消', 'AbortError');
      }
      this.fingerprint = doc.fingerprints[0] || `doc_${crypto.randomUUID()}`;
      this.numPages = doc.numPages;
      this.documentData = cacheBytes;
      this.hasDoc = true;
      return { numPages: doc.numPages };
    } catch (error) {
      if (generation === this.loadGeneration) this.clearDocument();
      throw error;
    } finally {
      // A cleanup failure must not hide the load error or reject a ready document.
      try {
        await loadingTask?.destroy();
      } catch {
        // The parsed bytes are independent of this temporary loading task.
      }
    }
  }

  getDocumentFingerprint(): string | null { return this.fingerprint; }
  getTotalPages(): number { return this.numPages; }
  hasLoadedDocument(): boolean { return this.hasDoc; }
  getDocumentData(): Uint8Array | null { return this.documentData; }
  async destroy(): Promise<void> {
    this.loadGeneration += 1;
    this.clearDocument();
  }

  static getDocumentFingerprint() { return this.shared.getDocumentFingerprint(); }
}

export const pdfService = PDFService.shared;
