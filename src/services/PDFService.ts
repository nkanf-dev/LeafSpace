import * as pdfjsLib from 'pdfjs-dist';

export class PDFService {
  static readonly shared = new PDFService();
  private fingerprint: string | null = null;
  private numPages: number = 0;
  private hasDoc: boolean = false;
  private documentData: Uint8Array | null = null;

  async loadDocument(input: string | File): Promise<{ numPages: number }> {
    let bytes: Uint8Array;
    if (typeof input === 'string') {
      const response = await fetch(input);
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      bytes = new Uint8Array(await input.arrayBuffer());
    }

    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      useWorkerFetch: false,
      isEvalSupported: false,
    });

    let doc: Awaited<typeof loadingTask.promise>;
    try {
      doc = await loadingTask.promise;
    } catch (err) {
      // Best-effort cleanup of the loading task; ignore any secondary errors.
      try { await loadingTask.destroy(); } catch { /* ignore */ }
      this.fingerprint = null;
      this.numPages = 0;
      this.hasDoc = false;
      this.documentData = null;
      throw err;
    }

    this.fingerprint = doc.fingerprints[0] || `doc_${Date.now()}`;
    this.numPages = doc.numPages;
    this.hasDoc = true;
    this.documentData = bytes;
    await doc.destroy();
    return { numPages: this.numPages };
  }

  getDocumentFingerprint(): string | null { return this.fingerprint; }
  getTotalPages(): number { return this.numPages; }
  hasLoadedDocument(): boolean { return this.hasDoc; }
  getDocumentData(): Uint8Array | null { return this.documentData; }
  async destroy(): Promise<void> {
    this.hasDoc = false;
    this.fingerprint = null;
    this.documentData = null;
  }

  static getDocumentFingerprint() { return this.shared.getDocumentFingerprint(); }
}

export const pdfService = PDFService.shared;
