import { buildPrintableReportHtml, type PrintableReport } from './printable-report'

/** The large printable DOM exists only after an explicit print request. */
export function prepareFullReportPrint(report: PrintableReport, onReady: () => void, onError: () => void) {
  let frame: HTMLIFrameElement | null = document.createElement('iframe')
  frame.title = 'Полный отчёт для печати'
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
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
    frame.srcdoc = buildPrintableReportHtml(report, { embedded: true, compactPrint: true })
    document.body.appendChild(frame)
  } catch { dispose(); onError() }
  return dispose
}
