import { describe, expect, it, vi } from 'vitest';
import { OPS, type PDFPageProxy } from 'pdfjs-dist';
import { assertPdfFontSupport } from '../../services/pdfFontSupport';

function pageWithFonts(fnArray: number[], argsArray: unknown[][], resolved: Record<string, unknown>) {
  const get = vi.fn((name: string, callback: (font: unknown) => void) => { queueMicrotask(() => callback(resolved[name])); });
  const page = { getOperatorList: vi.fn().mockResolvedValue({ fnArray, argsArray }), commonObjs: { get } } as unknown as PDFPageProxy;
  return { page, get };
}

describe('PDF font support before publishing thumbnails', () => {
  it('accepts embedded fonts after their bytes have been released and checks each font once', async () => {
    const { page, get } = pageWithFonts([OPS.setFont, OPS.setFont], [['embedded', 12], ['embedded', 24]], { embedded: { missingFile: false, data: null } });
    await expect(assertPdfFontSupport(page)).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('waits for asynchronous font resolution before declaring support', async () => {
    const { page } = pageWithFonts([OPS.setFont], [['font', 12]], {});
    let resolveFont!: (font: unknown) => void;
    vi.mocked(page.commonObjs.get).mockImplementation((_name, callback) => { resolveFont = font => callback!(font); return null; });
    let completed = false;
    const check = assertPdfFontSupport(page).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    resolveFont({ missingFile: false });
    await check;
    expect(completed).toBe(true);
  });

  it('checks fonts selected by extended graphics state, including after unrelated state', async () => {
    const { page } = pageWithFonts([OPS.setGState], [[[['LW', 1], ['Font', ['system', 14]]]]], { system: { missingFile: true } });
    await expect(assertPdfFontSupport(page)).rejects.toThrow('main-thread font renderer');
  });

  it.each(['Font could not be translated', null, undefined])('rejects unresolved font errors: %s', async font => {
    const { page } = pageWithFonts([OPS.setFont], [['broken', 12]], { broken: font });
    await expect(assertPdfFontSupport(page)).rejects.toThrow('font could not be loaded');
  });

  it('does not reject scanned pages without font operators', async () => {
    const { page, get } = pageWithFonts([OPS.paintImageXObject], [['image']], {});
    await expect(assertPdfFontSupport(page)).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('checks propagated nested font dependencies without awaiting page-local images', async () => {
    const { page, get } = pageWithFonts([OPS.dependency, OPS.setFillColorN], [['img_p0_1', 'g_d0_f1'], []], { g_d0_f1: { missingFile: true } });
    await expect(assertPdfFontSupport(page)).rejects.toThrow('main-thread font renderer');
    expect(get.mock.calls.map(([name]) => name)).toEqual(['g_d0_f1']);
  });

  it('does not misclassify shared images as fonts but rejects nested font errors', async () => {
    const { page } = pageWithFonts([OPS.dependency], [['g_img_1', 'g_img_2', 'g_d0_f1']], { g_img_1: { data: new Uint8Array() }, g_img_2: null, g_d0_f1: 'Font could not be translated' });
    await expect(assertPdfFontSupport(page)).rejects.toThrow('font could not be loaded');
  });
});
