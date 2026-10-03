import * as pdfjsLib from 'pdfjs-dist';
import type { TOCItem } from '../types/domain';

export type PDFDocumentSource = File | Blob | string;

export class PDFPasswordRequiredError extends Error {
  constructor() {
    super('这份 PDF 需要打开密码，页境暂不支持。请先在本机另存一份无需打开密码的 PDF，再重新导入。');
    this.name = 'PDFPasswordRequiredError';
  }
}


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

  async loadDocument(source: PDFDocumentSource): Promise<{ numPages: number; toc?: TOCItem[] }> {
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
      const doc = await loadingTask.promise.catch((error: unknown) => {
        // Classify only a typed parser rejection, never file-read errors or text.
        // Owner-permission encryption can open without a user password and must
        // remain supported; PDF.js rejects only when an opening password is needed.
        if (error && typeof error === 'object' && 'name' in error && error.name === 'PasswordException'
          && 'code' in error && (error.code === pdfjsLib.PasswordResponses.NEED_PASSWORD || error.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD)) {
          throw new PDFPasswordRequiredError();
        }
        throw error;
      });
      if (generation !== this.loadGeneration) {
        throw new DOMException('文档加载已取消', 'AbortError');
      }
      const toc: TOCItem[] = [];
      // A broken or missing outline must never prevent reading the PDF.
      try {
        const walk = async (items: Awaited<ReturnType<typeof doc.getOutline>>, level = 0): Promise<void> => {
          for (const item of items ?? []) {
            if (toc.length >= 1000 || level > 20) break;
            try {
              const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
              if (Array.isArray(dest) && dest[0] != null) {
                const index = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
                if (Number.isInteger(index) && index >= 0 && index < doc.numPages) toc.push({ id: `outline-${toc.length}`, title: item.title, page: index + 1, level });
              }
            } catch { /* Keep valid siblings and children of broken destinations. */ }
            await walk(item.items, level + 1);
          }
        };
        await walk(await doc.getOutline());
      } catch { /* PDFs without a readable outline still load normally. */ }
      if (generation !== this.loadGeneration) throw new DOMException('文档加载已取消', 'AbortError');
      this.fingerprint = doc.fingerprints[0] || `doc_${crypto.randomUUID()}`;
      this.numPages = doc.numPages;
      this.documentData = cacheBytes;
      this.hasDoc = true;
      return { numPages: doc.numPages, toc };
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
