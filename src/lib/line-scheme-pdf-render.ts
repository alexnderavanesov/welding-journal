import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { profileSchemePdf } from './line-scheme-pdf-profile'
import { keepSchemePdfPreview, takeSchemePdfPreview } from './line-scheme-pdf-preview'
import { createPdfCamera, pdfFitScale, pdfFootprint, type PdfSize, type PdfView } from './line-scheme-pdf-camera'

/** One modest whole-page preview plus a sharp visible region. Increasing zoom
 * never allocates a canvas for an entire A0 sheet at that magnification. */
export function mountSchemePdfPage(page: PDFPageProxy, stage: HTMLDivElement, space: HTMLDivElement,
  sheet: HTMLDivElement, drawing: HTMLDivElement, onReady: () => void, onError: (error: unknown) => void, initial?: PdfView | null, previewKey?: string) {
  const cssUnits = 96 / 72
  const viewport = page.getViewport({ scale: cssUnits, rotation: 0 }), size: PdfSize = viewport
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, detailTask: RenderTask | undefined
  let baseTask: RenderTask | undefined, detailCanvas: HTMLCanvasElement | undefined, pendingCanvas: HTMLCanvasElement | undefined
  let baseReady = false, generation = 0
  let detailRegion: { left: number; top: number; right: number; bottom: number; scale: number } | undefined
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const fit = pdfFitScale(pdfFootprint(size, page.rotate), { width: stage.clientWidth, height: stage.clientHeight }, 'fit-page')
  let baseScale = Math.min(fit * dpr, Math.sqrt(4_000_000 / (size.width * size.height)), 4096 / Math.max(size.width, size.height))
  const baseWidth = Math.max(1, Math.ceil(size.width * baseScale)), baseHeight = Math.max(1, Math.ceil(size.height * baseScale))
  const reused = previewKey ? takeSchemePdfPreview(previewKey, baseWidth, baseHeight) : undefined
  const base = reused ?? document.createElement('canvas')
  if (reused) baseScale = Math.min(base.width / size.width, base.height / size.height)
  base.className = 'line-scheme-pdf-preview'; drawing.append(base)
  const camera = createPdfCamera(stage, space, sheet, size, page.rotate, schedule, initial)
  function release(canvas?: HTMLCanvasElement) { if (canvas) { canvas.remove(); canvas.width = canvas.height = 0 } }
  function schedule() {
    generation++; if (timer) clearTimeout(timer)
    detailTask?.cancel()
    if (!disposed) timer = setTimeout(() => void sharpen(), 50)
  }
  async function sharpen() {
    if (disposed || !baseReady) return
    const epoch = generation, desired = camera.getSnapshot().scale * dpr
    if (desired <= baseScale * 1.001) { release(detailCanvas); detailCanvas = undefined; detailRegion = undefined; return }
    const visible = camera.visible(0)
    if (detailRegion && detailRegion.scale >= desired * .999 && visible.left >= detailRegion.left && visible.top >= detailRegion.top && visible.right <= detailRegion.right && visible.bottom <= detailRegion.bottom) {
      profileSchemePdf('detail-reused'); profileSchemePdf('detail-ready'); return
    }
    const crop = camera.visible(), width = (crop.right - crop.left) * size.width, height = (crop.bottom - crop.top) * size.height
    if (width <= 0 || height <= 0) return
    const scale = Math.min(desired, Math.sqrt(12_000_000 / (width * height)), 8192 / Math.max(width, height))
    const canvas = document.createElement('canvas'); pendingCanvas = canvas
    canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale))
    canvas.className = 'line-scheme-pdf-detail'
    Object.assign(canvas.style, { left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${(crop.right - crop.left) * 100}%`, height: `${(crop.bottom - crop.top) * 100}%` })
    const task = page.render({ canvas, viewport: page.getViewport({ scale: scale * cssUnits, rotation: 0 }),
      transform: [1, 0, 0, 1, -crop.left * size.width * scale, -crop.top * size.height * scale] })
    detailTask = task
    profileSchemePdf('detail-start')
    try {
      await task.promise
      if (disposed || epoch !== generation) { release(canvas); return }
      canvas.dataset.pdfRendered = 'detail'; drawing.append(canvas)
      profileSchemePdf('detail-ready')
      release(detailCanvas); detailCanvas = canvas
      detailRegion = { ...crop, scale }
    } catch (error) {
      release(canvas)
      if (!disposed && epoch === generation && (error as Error).name !== 'RenderingCancelledException') onError(error)
    } finally { if (detailTask === task) detailTask = undefined; if (pendingCanvas === canvas) pendingCanvas = undefined }
  }
  const ready = () => {
    if (disposed) return
    baseReady = true; base.dataset.pdfRendered = 'preview'; onReady(); schedule()
    profileSchemePdf('preview-ready')
  }
  if (reused) {
    profileSchemePdf('preview-reused'); ready()
    // Prepare the ordinary render intent while the cached pixels are visible.
    // getOperatorList uses a separate intent in PDF.js and would parse twice.
    const warming = document.createElement('canvas')
    warming.width = base.width; warming.height = base.height
    baseTask = page.render({ canvas: warming, viewport: page.getViewport({ scale: baseScale * cssUnits, rotation: 0 }) })
    profileSchemePdf('warm-start')
    void baseTask.promise.then(() => { if (!disposed) profileSchemePdf('warm-ready') })
      .catch(error => { if (!disposed && (error as Error).name !== 'RenderingCancelledException') onError(error) })
      .finally(() => release(warming))
  } else {
    base.width = baseWidth; base.height = baseHeight
    baseTask = page.render({ canvas: base, viewport: page.getViewport({ scale: baseScale * cssUnits, rotation: 0 }) })
    profileSchemePdf('preview-start')
    void baseTask.promise.then(ready).catch(error => { if (!disposed && (error as Error).name !== 'RenderingCancelledException') onError(error) })
  }
  stage.addEventListener('scroll', schedule, { passive: true })
  return {
    camera,
    destroy() {
      disposed = true; generation++; if (timer) clearTimeout(timer)
      stage.removeEventListener('scroll', schedule); camera.destroy(); baseTask?.cancel(); detailTask?.cancel()
      // Wait until cancelled rendering releases the surface before clearing it.
      const pending = pendingCanvas
      void Promise.allSettled([baseTask?.promise, detailTask?.promise]).then(() => {
        if (baseReady && previewKey) keepSchemePdfPreview(previewKey, base); else release(base)
        release(detailCanvas); release(pending); page.cleanup()
      })
    },
  }
}
