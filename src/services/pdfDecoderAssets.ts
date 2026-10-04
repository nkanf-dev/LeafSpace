/** Resolve on the page: worker scripts live under /assets/, not the app base. */
export function pdfDecoderAssetsUrl(version: string, base = import.meta.env.BASE_URL, documentUrl = document.baseURI): string {
  return new URL(`pdfjs/${version}/wasm/`, new URL(base || '/', documentUrl)).href;
}

export function pdfCMapAssetsUrl(version: string, base = import.meta.env.BASE_URL, documentUrl = document.baseURI): string {
  return new URL(`pdfjs/${version}/cmaps/`, new URL(base || '/', documentUrl)).href;
}

export function pdfStandardFontAssetsUrl(version: string, base = import.meta.env.BASE_URL, documentUrl = document.baseURI): string {
  return new URL(`pdfjs/${version}/standard_fonts/`, new URL(base || '/', documentUrl)).href;
}
