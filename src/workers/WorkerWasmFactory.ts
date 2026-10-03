/** PDF.js's DOM factory reads document.baseURI, which does not exist here. */
export class WorkerWasmFactory {
  private readonly baseUrl: string | null;

  constructor({ baseUrl = null }: { baseUrl?: string | null }) {
    this.baseUrl = baseUrl;
  }

  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    if (!this.baseUrl || !filename) throw new Error('PDF decoder asset URL is missing');
    const response = await fetch(new URL(filename, this.baseUrl));
    if (!response.ok) throw new Error(`PDF decoder asset could not be loaded (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
