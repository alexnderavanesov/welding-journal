// Start code loading on the drawing click, alongside the fresh access/metadata request.
// The PDF bytes and worker still belong to the mounted, authorized viewer.
export function prepareSchemeDrawing() {
  void Promise.all([
    import('./line-scheme-dialog'),
    import('./line-scheme-pdf'),
    import('@/lib/line-scheme-pdf-engine').then(module => module.loadSchemePdfEngine()),
  ]).catch(() => { /* The normal viewer load handles failure and retry. */ })
}
