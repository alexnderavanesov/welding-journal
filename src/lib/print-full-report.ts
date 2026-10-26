import { buildPrintableReportHtml, type PrintableReport } from './printable-report'
import { getReportPrintRestriction } from './report-print-policy'
import { buildPreviewFrameHtml, PREVIEW_FRAME_SANDBOX } from './document-preview-frame'

/** The large printable DOM exists only after an explicit print request. */
export function prepareFullReportPrint(report: PrintableReport, onReady: () => void, onError: (message?: string) => void) {
  const restriction = getReportPrintRestriction(report)
  if (restriction) { onError(restriction); return () => {} }
  return prepareHtmlDocumentPrint(() => buildPrintableReportHtml(report, { embedded: true, compactPrint: true }), onReady, onError)
}

export function prepareHtmlDocumentPrint(buildHtml: () => string, onReady: () => void, onError: (message?: string) => void) {
  let frame: HTMLIFrameElement | null = document.createElement('iframe')
  frame.title = 'Полный отчёт для печати'
  frame.setAttribute('aria-hidden', 'true')
  // As in the preview, WebKit needs parent-owned event listeners enabled.
  // The injected CSP still forbids document scripts and network access.
  frame.setAttribute('sandbox', PREVIEW_FRAME_SANDBOX)
  frame.tabIndex = -1
  // A display:none frame is not printable in some browsers.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1480px;height:900px;border:0;'
  let disposed = false
  const dispose = () => {
    disposed = true
    if (!frame) return
    frame.onload = null
    frame.remove()
    // The preview retains the disposer until its next print/close. Do not let
    // that callback retain a detached full-report frame and its large srcdoc.
    frame.removeAttribute('srcdoc')
    frame = null
  }
  frame.onload = () => {
    if (disposed) return
    const target = frame?.contentWindow
    if (!target) { dispose(); onError(); return }
    target.addEventListener('afterprint', dispose, { once: true })
    try { target.focus(); target.print(); onReady() }
    catch { dispose(); onError() }
  }
  try {
    frame.srcdoc = buildPreviewFrameHtml(buildHtml())
    document.body.appendChild(frame)
  } catch { dispose(); onError() }
  return dispose
}
