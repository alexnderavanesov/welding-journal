import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import rendererUrl from 'pdfjs-dist/build/pdf.renderer.min.mjs?url'

// Imported only from the lazy drawing component. The engine is evaluated in a
// browser effect, never in SSR or when viewing the journal / scheme registry.
export async function loadSchemePdfEngine() {
  const pdf = await import('pdfjs-dist')
  pdf.GlobalWorkerOptions.workerSrc = workerUrl
  pdf.GlobalWorkerOptions.rendererSrc = rendererUrl
  const base = `${import.meta.env.BASE_URL}pdfjs/${pdf.version}/`
  return {
    open: (url: string) => pdf.getDocument({ url, cMapUrl: `${base}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`,
      // Only demand bytes for opened pages. Same-origin authenticated Range
      // requests already exist; no new server rendering or background fetch.
      disableAutoFetch: true, disableStream: true, rangeChunkSize: 256 * 1024,
      enableXfa: false, canvasMaxAreaInBytes: 64 * 1024 * 1024 }),
  }
}
