import * as pdfjsLib from 'pdfjs-dist';

export type PDFDocumentSource = File | Blob | string;

export class PDFService {
  static readonly shared = new PDFService();
  private fingerprint: string | null = null;
  private numPages: number = 0;
  private hasDoc: boolean = false;
  private documentData: Uint8Array | null = null;

  private async resolveSource(source: PDFDocumentSource): Promise<Uint8Array> {
    if (typeof source === 'string') {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    }

    return new Uint8Array(await source.arrayBuffer());
  }

  async loadDocument(source: PDFDocumentSource): Promise<{ numPages: number }> {
    const bytes = await this.resolveSource(source);
    const loadingTask = pdfjsLib.getDocument({ 
      data: bytes,
      useWorkerFetch: false,
      isEvalSupported: false
    });

    try {
      const doc = await loadingTask.promise;
      this.fingerprint = doc.fingerprints[0] || `doc_${Date.now()}`;
      this.numPages = doc.numPages;
      this.documentData = bytes;
      this.hasDoc = true;
      await doc.destroy();
      return { numPages: this.numPages };
    } catch (error) {
      this.fingerprint = null;
      this.numPages = 0;
      this.documentData = null;
      this.hasDoc = false;
      throw error;
    } finally {
      if (typeof loadingTask.destroy === 'function') {
        await loadingTask.destroy();
      }
    }
  }

  getDocumentFingerprint(): string | null { return this.fingerprint; }
  getTotalPages(): number { return this.numPages; }
  hasLoadedDocument(): boolean { return this.hasDoc; }
  getDocumentData(): Uint8Array | null { return this.documentData; }
  async destroy(): Promise<void> {
    this.hasDoc = false;
    this.fingerprint = null;
    this.numPages = 0;
    this.documentData = null;
  }

  static getDocumentFingerprint() { return this.shared.getDocumentFingerprint(); }
}

export const pdfService = PDFService.shared;
