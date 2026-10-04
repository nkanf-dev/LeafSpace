import { OPS, type PDFPageProxy } from 'pdfjs-dist';

/**
 * PDF.js 5.4 exposes resolved display fonts through PDFPageProxy.commonObjs.
 * A worker cannot safely draw system-font-dependent glyphs. Font loading errors
 * may resolve as strings instead of rejecting render(), so check both cases.
 * Keep this small adapter covered when upgrading PDF.js; data is deliberately
 * NOT inspected because FontLoader clears embedded bytes after binding.
 */
export async function assertPdfFontSupport(page: PDFPageProxy): Promise<void> {
  const operators = await page.getOperatorList(), fonts = new Set<string>(), dependencies = new Set<string>();
  for (let index = 0; index < operators.fnArray.length; index++) {
    const args: unknown[] = operators.argsArray[index];
    // PDF.js propagates dependencies from tiling patterns and Type3 glyphs to
    // this list. CanvasGraphics uses this same prefix for commonObjs; page-local
    // image IDs must not be awaited there. Shared images are not font objects.
    if (operators.fnArray[index] === OPS.dependency) {
      for (const name of args) if (typeof name === 'string' && name.startsWith('g_')) dependencies.add(name);
    }
    if (operators.fnArray[index] === OPS.setFont && typeof args[0] === 'string') fonts.add(args[0]);
    if (operators.fnArray[index] === OPS.setGState && Array.isArray(args[0])) {
      for (const entry of args[0]) {
        if (Array.isArray(entry) && entry[0] === 'Font' && Array.isArray(entry[1]) && typeof entry[1][0] === 'string') fonts.add(entry[1][0]);
      }
    }
  }
  for (const name of new Set([...fonts, ...dependencies])) {
    const font: unknown = await new Promise(resolve => page.commonObjs.get(name, resolve));
    if (typeof font === 'string' || (fonts.has(name) && (!font || typeof font !== 'object'))) throw new Error('PDF font could not be loaded');
    if (font && typeof font === 'object' && 'missingFile' in font && font.missingFile === true) {
      throw new Error('PDF font requires the main-thread font renderer');
    }
  }
}
