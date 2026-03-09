import * as pdfjsLib from 'pdfjs-dist';

export class PDFService {
  static readonly shared = new PDFService();
  private fingerprint: string | null = null;
  private numPages: number = 0;
  private hasDoc: boolean = false;

  async loadDocument(file: File): Promise<{ numPages: number }> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ 
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      isEvalSupported: false
    });

    const doc = await loadingTask.promise;
    this.fingerprint = doc.fingerprints[0] || `doc_${Date.now()}`;
    this.numPages = doc.numPages;
    this.hasDoc = true;
    await doc.destroy();
    return { numPages: this.numPages };
  }

  getDocumentFingerprint(): string | null { return this.fingerprint; }
  getTotalPages(): number { return this.numPages; }
  hasLoadedDocument(): boolean { return this.hasDoc; }
  getDocumentData(): Uint8Array | null { return null; } // 现在主要使用 Blob URL
  async destroy(): Promise<void> { this.hasDoc = false; this.fingerprint = null; }

  static getDocumentFingerprint() { return this.shared.getDocumentFingerprint(); }
}

export const pdfService = PDFService.shared;
