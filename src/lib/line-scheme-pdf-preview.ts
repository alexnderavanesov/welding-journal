// One first-page bitmap, at most the existing 4 MP preview budget. Never cache
// points, permissions, parsed PDFs or workers. A fresh authorized document is
// opened before this can be used; revision IDs identify immutable PDF files.
let currentKey: string | undefined
let cached: { key: string; canvas: HTMLCanvasElement } | undefined
function release(canvas: HTMLCanvasElement) { canvas.remove(); canvas.width = canvas.height = 0 }

export function takeSchemePdfPreview(key: string, width: number, height: number) {
  currentKey = key
  const previous = cached; cached = undefined
  if (!previous) return undefined
  if (previous.key === key && previous.canvas.width >= width && previous.canvas.height >= height) return previous.canvas
  release(previous.canvas)
  return undefined
}

export function keepSchemePdfPreview(key: string, canvas: HTMLCanvasElement) {
  canvas.remove()
  if (key !== currentKey) { release(canvas); return }
  if (cached) release(cached.canvas)
  cached = { key, canvas }
}
