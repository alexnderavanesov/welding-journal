import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import type { Plugin } from 'vite'

/** PDF.js resolves auxiliary files by name, so serve the versioned directory
 * locally in dev and emit the same paths in the client build. No CDN requests. */
export function pdfAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const files = new Map<string, string>()
  files.set(`pdfjs/${version}/LICENSE`, join(root, 'LICENSE'))
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.isFile() && !/\.map$/.test(entry.name)) files.set(`pdfjs/${version}/${directory}/${entry.name}`, join(root, directory, entry.name))
    }
  }
  return {
    name: 'local-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0].slice(1), file = files.get(path)
        if (!file || !['GET', 'HEAD'].includes(request.method ?? '')) return next()
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        response.end(request.method === 'HEAD' ? undefined : readFileSync(file))
      })
    },
    generateBundle() {
      if (this.environment.name !== 'client') return
      for (const [fileName, file] of files) this.emitFile({ type: 'asset', fileName, source: readFileSync(file) })
    },
  }
}
