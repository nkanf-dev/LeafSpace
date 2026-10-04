async function fetchBytes(baseUrl: string | null, filename: string): Promise<Uint8Array> {
  if (!baseUrl || !filename || !/^[A-Za-z0-9_.-]+$/.test(filename) || filename.includes('..')) throw new Error('PDF font resource URL is invalid');
  const response = await fetch(new URL(filename, baseUrl));
  if (!response.ok) throw new Error(`PDF font resource could not be loaded (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The default DOM factories consult document.baseURI, absent in this worker. */
export class WorkerCMapReaderFactory {
  private readonly baseUrl: string | null;
  private readonly isCompressed: boolean;
  constructor({ baseUrl = null, isCompressed = false }: { baseUrl?: string | null; isCompressed?: boolean }) {
    this.baseUrl = baseUrl; this.isCompressed = isCompressed;
  }
  async fetch({ name }: { name: string }) {
    if (!name) throw new Error('PDF CMap name is missing');
    return { cMapData: await fetchBytes(this.baseUrl, `${name}${this.isCompressed ? '.bcmap' : ''}`), compressionType: this.isCompressed ? 1 : 0 };
  }
}

export class WorkerStandardFontDataFactory {
  private readonly baseUrl: string | null;
  constructor({ baseUrl = null }: { baseUrl?: string | null }) { this.baseUrl = baseUrl; }
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> { return fetchBytes(this.baseUrl, filename); }
}
