import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const buildCommit = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
  catch { return 'local' }
})()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), { name: 'build-identity', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'leafspace-build', content: buildCommit }, injectTo: 'head' }] }],
})
