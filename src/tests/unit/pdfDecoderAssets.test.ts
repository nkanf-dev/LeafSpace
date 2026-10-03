import { afterEach, describe, expect, it, vi } from 'vitest';
import { pdfDecoderAssetsUrl } from '../../services/pdfDecoderAssets';
import { WorkerWasmFactory } from '../../workers/WorkerWasmFactory';

describe('local PDF decoder assets', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['/', 'https://reader.example/reader', 'https://reader.example/pdfjs/5.4.296/wasm/'],
    ['/leafspace-test/', 'https://reader.example/leafspace-test/', 'https://reader.example/leafspace-test/pdfjs/5.4.296/wasm/'],
    ['./', 'https://reader.example/local/index.html', 'https://reader.example/local/pdfjs/5.4.296/wasm/'],
  ])('resolves %s to a page-owned absolute trailing-slash directory', (base, documentUrl, expected) => {
    expect(pdfDecoderAssetsUrl('5.4.296', base, documentUrl)).toBe(expected);
  });
  it('fetches WASM bytes without a document global', async () => {
    vi.stubGlobal('document', undefined);
    const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([0, 97, 115, 109]).buffer });
    vi.stubGlobal('fetch', fetch);
    const factory = new WorkerWasmFactory({ baseUrl: 'https://reader.example/local/pdfjs/test/wasm/' });
    expect(await factory.fetch({ filename: 'openjpeg.wasm' })).toEqual(new Uint8Array([0, 97, 115, 109]));
    expect(String(fetch.mock.calls[0][0])).toBe('https://reader.example/local/pdfjs/test/wasm/openjpeg.wasm');
  });
  it('rejects missing URLs and non-success HTTP responses rather than treating them as a decoder', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }); vi.stubGlobal('fetch', fetch);
    await expect(new WorkerWasmFactory({}).fetch({ filename: 'openjpeg.wasm' })).rejects.toThrow('URL is missing');
    expect(fetch).not.toHaveBeenCalled();
    await expect(new WorkerWasmFactory({ baseUrl: 'https://reader.example/wasm/' }).fetch({ filename: 'openjpeg.wasm' })).rejects.toThrow('404');
  });
});
