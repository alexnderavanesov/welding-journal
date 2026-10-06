import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, Printer, X } from 'lucide-react'
import { buildPrintableReportHtml, type PrintableReport } from '@/lib/printable-report'
import { getPrintableReportPage } from '@/lib/printable-report-page'
import { prepareFullReportPrint } from '@/lib/print-full-report'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'

/** Same escaped, print-ready document as a separate report tab, without popup permission. */
export function PrintableReportPreview({ report, busy, error, onClose, onRetry, onDownloadExcel }: {
  report: PrintableReport | null; busy: boolean; error: string; onClose: () => void; onRetry: () => void
  onDownloadExcel?: () => Promise<void>
}) {
  const panel = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null), detachFrame = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false), [printError, setPrintError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const downloadingRef = useRef(false)
  const [downloadError, setDownloadError] = useState('')
  const [pageState, setPageState] = useState({ report, page: 0 })
  const page = useMemo(() => report ? getPrintableReportPage(report, pageState.report === report ? pageState.page : 0) : null, [report, pageState])
  const html = useMemo(() => page ? buildPrintableReportHtml(page.report, { embedded: true }) : '', [page])
  const disposePrint = useRef<(() => void) | null>(null)
  const printAction = useRef<() => void>(() => {})
  const printingRef = useRef(false)
  const [printing, setPrinting] = useState(false)
  useLayoutEffect(() => { setReady(false); setPrintError('') }, [html])
  useEffect(() => {
    printingRef.current = false; setPrinting(false)
    return () => { disposePrint.current?.(); disposePrint.current = null }
  }, [report])
  useEffect(() => {
    closeButton.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); printAction.current(); return
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const targets = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), iframe')
      if (!targets?.length) return
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); detachFrame.current?.() }
  }, [onClose])
  const loaded = () => {
    detachFrame.current?.()
    const doc = frame.current?.contentDocument
    if (!doc || !report) return
    // Keyboard events inside an iframe do not bubble to the containing dialog.
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); printAction.current(); return
      }
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        event.preventDefault()
        const targets = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        targets?.[event.shiftKey ? targets.length - 1 : 0]?.focus()
      }
    }
    doc.addEventListener('keydown', keydown)
    detachFrame.current = () => doc.removeEventListener('keydown', keydown)
    setReady(true)
  }
  const print = () => {
    if (!report || !ready || busy || printingRef.current) return
    setPrintError('')
    if (page && page.pageCount > 1) {
      printingRef.current = true; setPrinting(true)
      disposePrint.current?.()
      const done = () => { printingRef.current = false; setPrinting(false); closeButton.current?.focus() }
      disposePrint.current = prepareFullReportPrint(report, done, () => {
        done(); setPrintError('Не удалось открыть печать. Повторите действие в браузере.')
      })
      return
    }
    try {
      const target = frame.current?.contentWindow
      if (!target || !ready) return
      target.focus(); target.print(); setPrintError('')
    } catch { setPrintError('Не удалось открыть печать. Повторите действие в браузере.') }
  }
  printAction.current = print
  const download = async () => {
    if (!onDownloadExcel || downloadingRef.current) return
    downloadingRef.current = true; setDownloading(true); setDownloadError('')
    try { await onDownloadExcel() }
    catch { setDownloadError('Не удалось скачать Excel. Повторите действие.') }
    finally { downloadingRef.current = false; setDownloading(false) }
  }
  return <LargeDialogShell ariaLabel="Предпросмотр отчёта" maxWidthClassName="max-w-[1480px]" panelClassName="h-[92vh]">
    <div ref={panel} className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-800">Предпросмотр отчёта</h2>
        <div className="flex flex-wrap items-center gap-2">
          {onDownloadExcel ? <Button variant="outline" disabled={busy || downloading} onClick={() => { void download() }}><Download className="mr-2 h-4 w-4" />{downloading ? 'Подготавливаем Excel…' : 'Скачать Excel'}</Button> : null}
          <Button variant="outline" disabled={!report || !ready || busy || printing} onClick={print}><Printer className="mr-2 h-4 w-4" />{printing ? 'Подготавливаем печать…' : 'Печать / Сохранить PDF'}</Button>
          <Button ref={closeButton} variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть предпросмотр"><X className="h-5 w-5" /></Button>
        </div>
      </header>
      {!busy && !error && page && page.total > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2 text-sm text-slate-600">
        <span>Показаны {page.start + 1}–{page.end} из {page.total}. Excel и печать/PDF — весь отчёт.</span>
        {page.pageCount > 1 ? <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page.page === 0 || printing} onClick={() => setPageState({ report, page: page.page - 1 })}>Назад</Button>
          <Button variant="outline" size="sm" disabled={page.page === page.pageCount - 1 || printing} onClick={() => setPageState({ report, page: page.page + 1 })}>Далее</Button>
        </div> : null}
      </div> : null}
      {printError ? <p role="alert" className="px-5 py-2 text-sm text-rose-700">{printError}</p> : null}
      {downloadError ? <p role="alert" className="px-5 py-2 text-sm text-rose-700">{downloadError}</p> : null}
      {busy ? <p role="status" className="p-6 text-sm text-slate-500">Подготавливаем отчёт по сохранённым данным…</p> : error ? <div className="space-y-3 p-6"><p role="alert" className="text-sm text-rose-700">{error}</p><Button variant="outline" onClick={onRetry}>Повторить</Button></div> : report ?
        <iframe ref={frame} title={report.title} srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={loaded} className="min-h-0 w-full flex-1 border-0 bg-slate-50" /> : null}
    </div>
  </LargeDialogShell>
}
