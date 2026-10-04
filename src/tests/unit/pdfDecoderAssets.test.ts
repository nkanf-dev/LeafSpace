import { afterEach, describe, expect, it, vi } from 'vitest';
import { pdfCMapAssetsUrl, pdfDecoderAssetsUrl, pdfStandardFontAssetsUrl } from '../../services/pdfDecoderAssets';
import { WorkerWasmFactory } from '../../workers/WorkerWasmFactory';
import { WorkerCMapReaderFactory, WorkerStandardFontDataFactory } from '../../workers/WorkerFontResources';

describe('local PDF decoder assets', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['/', 'https://reader.example/reader', 'https://reader.example/pdfjs/5.4.296/wasm/'],
    ['/leafspace-test/', 'https://reader.example/leafspace-test/', 'https://reader.example/leafspace-test/pdfjs/5.4.296/wasm/'],
    ['./', 'https://reader.example/local/index.html', 'https://reader.example/local/pdfjs/5.4.296/wasm/'],
  ])('resolves %s to a page-owned absolute trailing-slash directory', (base, documentUrl, expected) => {
    expect(pdfDecoderAssetsUrl('5.4.296', base, documentUrl)).toBe(expected);
    expect(pdfCMapAssetsUrl('5.4.296', base, documentUrl)).toBe(expected.replace('/wasm/', '/cmaps/'));
    expect(pdfStandardFontAssetsUrl('5.4.296', base, documentUrl)).toBe(expected.replace('/wasm/', '/standard_fonts/'));
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
  it('fetches packed CMaps and standard fonts without a document global', async () => {
    vi.stubGlobal('document', undefined);
    const bytes = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });
    vi.stubGlobal('fetch', fetch);
    const cMaps = new WorkerCMapReaderFactory({ baseUrl: 'https://reader.example/local/pdfjs/test/cmaps/', isCompressed: true });
    expect(await cMaps.fetch({ name: 'UniGB-UTF16-H' })).toEqual({ cMapData: bytes, compressionType: 1 });
    expect(await new WorkerStandardFontDataFactory({ baseUrl: 'https://reader.example/local/pdfjs/test/standard_fonts/' }).fetch({ filename: 'FoxitSerif.pfb' })).toEqual(bytes);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['https://reader.example/local/pdfjs/test/cmaps/UniGB-UTF16-H.bcmap', 'https://reader.example/local/pdfjs/test/standard_fonts/FoxitSerif.pfb']);
  });
  it('rejects missing resources and HTTP failures instead of resolving font bytes', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }); vi.stubGlobal('fetch', fetch);
    await expect(new WorkerCMapReaderFactory({}).fetch({ name: 'UniGB-UTF16-H' })).rejects.toThrow('URL is invalid');
    await expect(new WorkerStandardFontDataFactory({ baseUrl: 'https://reader.example/fonts/' }).fetch({ filename: '../secret' })).rejects.toThrow('URL is invalid');
    expect(fetch).not.toHaveBeenCalled();
    await expect(new WorkerCMapReaderFactory({ baseUrl: 'https://reader.example/cmaps/', isCompressed: true }).fetch({ name: 'UniGB-UTF16-H' })).rejects.toThrow('404');
    await expect(new WorkerStandardFontDataFactory({ baseUrl: 'https://reader.example/fonts/' }).fetch({ filename: 'FoxitSerif.pfb' })).rejects.toThrow('404');
  });
});
