import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// PDF.js resolves fixed decoder filenames (including its JavaScript fallback).
// Prepare from this exact installed version for both Vite dev and build; do not
// rename individual files or fetch decoders from a third-party CDN at read time.
const pdfjsDirectory = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
const pdfjsVersion = JSON.parse(readFileSync(join(pdfjsDirectory, 'package.json'), 'utf8')).version as string
for (const name of ['openjpeg.wasm', 'openjpeg_nowasm_fallback.js', 'qcms_bg.wasm', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_QCMS', 'LICENSE_PDFJS_QCMS']) {
  readFileSync(join(pdfjsDirectory, 'wasm', name)) // Fail the build if installation is incomplete.
}
const generatedPdfjs = fileURLToPath(new URL('./public/pdfjs/', import.meta.url))
rmSync(generatedPdfjs, { recursive: true, force: true })
const decoderDirectory = join(generatedPdfjs, pdfjsVersion, 'wasm')
mkdirSync(decoderDirectory, { recursive: true })
cpSync(join(pdfjsDirectory, 'wasm'), decoderDirectory, { recursive: true })
cpSync(join(pdfjsDirectory, 'LICENSE'), join(decoderDirectory, 'LICENSE_PDFJS'))

const buildCommit = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
  catch { return 'local' }
})()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), { name: 'build-identity', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'leafspace-build', content: buildCommit }, injectTo: 'head' }] }],
})
