import { buildPrintableReportHtml, type PrintableReport } from './printable-report'

/** The large printable DOM exists only after an explicit print request. */
export function prepareFullReportPrint(report: PrintableReport, onReady: () => void, onError: () => void) {
  const frame = document.createElement('iframe')
  frame.title = 'Полный отчёт для печати'
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
  frame.tabIndex = -1
  // A display:none frame is not printable in some browsers.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1480px;height:900px;border:0;'
  let disposed = false
  const dispose = () => { disposed = true; frame.onload = null; frame.remove() }
  frame.onload = () => {
    if (disposed) return
    const target = frame.contentWindow
    if (!target) { dispose(); onError(); return }
    target.addEventListener('afterprint', dispose, { once: true })
    try { target.focus(); target.print(); onReady() }
    catch { dispose(); onError() }
  }
  try {
    frame.srcdoc = buildPrintableReportHtml(report, { embedded: true })
    document.body.appendChild(frame)
  } catch { dispose(); onError() }
  return dispose
}
