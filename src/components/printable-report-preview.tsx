import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, Printer, X } from 'lucide-react'
import { buildPrintableReportHtml, type PrintableReport } from '@/lib/printable-report'
import { getPrintableReportPage } from '@/lib/printable-report-page'
import { prepareFullReportPrint } from '@/lib/print-full-report'
import { limitReportPreview, REPORT_PREVIEW_ROW_LIMIT } from '@/lib/report-preview-limit'
import { getReportPrintRestriction } from '@/lib/report-print-policy'
import { buildPreviewFrameHtml, PREVIEW_FRAME_SANDBOX } from '@/lib/document-preview-frame'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'

export function PrintableReportPreview({ report: fullReport, busy, error, onClose, onRetry, onDownloadExcel, generatedAt }: {
  report: PrintableReport | null; busy: boolean; error: string; onClose: () => void; onRetry: () => void
  onDownloadExcel?: (signal?: AbortSignal) => Promise<void>
  generatedAt?: string
}) {
  const report = useMemo(() => fullReport ? limitReportPreview(fullReport) : null, [fullReport])
  const panel = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null), detachFrame = useRef<(() => void) | null>(null)
  const closeAction = useRef(onClose)
  useLayoutEffect(() => { closeAction.current = onClose }, [onClose])
  const [ready, setReady] = useState(false), [printError, setPrintError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const downloadingRef = useRef(false)
  const downloadController = useRef<AbortController | null>(null)
  useEffect(() => () => downloadController.current?.abort(), [])
  const [downloadError, setDownloadError] = useState('')
  const [pageState, setPageState] = useState({ report, page: 0 })
  const restrictionId = useId()
  const printRestriction = useMemo(() => report ? getReportPrintRestriction(report) : '', [report])
  const page = useMemo(() => report ? getPrintableReportPage(report, pageState.report === report ? pageState.page : 0) : null, [report, pageState])
  const html = useMemo(() => page ? buildPrintableReportHtml(page.report, { embedded: true }) : '', [page])
  const frameHtml = useMemo(() => buildPreviewFrameHtml(html), [html])
  const previewTitle = 'Предпросмотр отчёта'
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
    const previousFocus = document.activeElement as HTMLElement | null
    closeButton.current?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); printAction.current(); return
      }
      if (event.key === 'Escape') { if (document.querySelector('[data-select-listbox]')) return; event.preventDefault(); event.stopImmediatePropagation(); closeAction.current(); return }
      if (event.key !== 'Tab') return
      const targets = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), iframe')
      if (!targets?.length) return
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }) }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }) }
    }
    // Keep the iframe listener and original return focus until the dialog closes,
    // even when the parent renders a new close callback.
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); detachFrame.current?.(); previousFocus?.focus({ preventScroll: true }) }
  }, [])
  const loaded = () => {
    detachFrame.current?.()
    const doc = frame.current?.contentDocument
    if (!doc || !report) return
    // Keyboard events inside an iframe do not bubble to the containing dialog.
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); printAction.current(); return
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeAction.current(); return }
      if (event.key === 'Tab') {
        event.preventDefault()
        const targets = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        targets?.[event.shiftKey ? targets.length - 1 : 0]?.focus({ preventScroll: true })
      }
    }
    doc.addEventListener('keydown', keydown)
    detachFrame.current = () => doc.removeEventListener('keydown', keydown)
    setReady(true)
  }
  const print = () => {
    if (printRestriction) return
    if (!report || !ready || busy || printingRef.current) return
    setPrintError('')
    // Even one preview page may need several horizontal print parts.
    printingRef.current = true; setPrinting(true)
    disposePrint.current?.()
    const done = () => { printingRef.current = false; setPrinting(false); closeButton.current?.focus({ preventScroll: true }) }
    const failed = (message?: string) => {
      done(); setPrintError(message || 'Не удалось открыть печать. Повторите действие в браузере.')
    }
    disposePrint.current = prepareFullReportPrint(report, done, failed)
  }
  printAction.current = print
  const download = async () => {
    if (!onDownloadExcel || downloadingRef.current) return
    downloadingRef.current = true; setDownloading(true); setDownloadError('')
    downloadController.current = new AbortController()
    try { await onDownloadExcel(downloadController.current.signal) }
    catch (error) { setDownloadError(`Не удалось скачать Excel. ${error instanceof Error ? error.message : 'Повторите действие.'}`) }
    finally { downloadingRef.current = false; setDownloading(false) }
  }
  return <LargeDialogShell ariaLabel={previewTitle} overlayClassName="z-[100] bg-slate-950/30" maxWidthClassName="max-w-[1480px]" panelClassName="h-[92vh]">
    <div ref={panel} data-document-preview="true" className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between border-b border-slate-200 gap-3 px-5 py-3">
        <h2 className="min-w-0 font-semibold text-slate-800 text-base">{previewTitle}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {onDownloadExcel ? <Button variant="outline" size="default" disabled={busy || downloading} onClick={() => { void download() }}><Download className="mr-2 h-4 w-4" />{downloading ? 'Подготавливаем Excel…' : 'Скачать Excel'}</Button> : null}
          <Button variant="outline" size="default" disabled={!report || !ready || busy || printing || Boolean(printRestriction)} aria-describedby={printRestriction ? restrictionId : undefined} onClick={print}><Printer className="mr-2 h-4 w-4" />{printing ? 'Подготавливаем печать…' : 'Печать / Сохранить PDF'}</Button>
          <Button ref={closeButton} variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть предпросмотр"><X className="h-5 w-5" /></Button>
        </div>
      </header>
      {!busy && !error && report && generatedAt ? <p className="border-b border-slate-200 px-5 py-2 text-sm text-slate-600">
        Снимок сформирован: <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleString('ru-RU')}</time>.
        {' '}{report.preview?.freshExcel ? 'Предпросмотр и печать используют этот снимок. Excel содержит всю выборку по тем же фильтрам, столбцам и сортировке, но по данным на момент скачивания.' : 'Просмотр, Excel и печать используют этот снимок. Для новых данных закройте и откройте отчёт заново.'}
      </p> : null}
      {!busy && !error && report?.preview?.truncated ? <p className="border-b border-sky-200 bg-sky-50 px-5 py-2 text-sm text-sky-900">
        Предпросмотр ограничен первыми {REPORT_PREVIEW_ROW_LIMIT} строками. {report.preview.totalRows !== undefined ? `Всего строк в выборке: ${report.preview.totalRows}.` : `Стыков в исходной выборке: ${report.preview.sourceRows}; один стык может занимать несколько строк отчёта.`}
        {' '}Excel скачивается целиком.{report.preview.freshExcel ? ' При изменении данных количество строк в файле может отличаться.' : ''}
      </p> : null}
      {!busy && !error && printRestriction ? <p id={restrictionId} role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">{printRestriction}</p> : null}
      {!busy && !error && page && page.total > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2 text-sm text-slate-600">
        <span>Показаны {page.start + 1}–{page.end} из {page.total}{report?.preview?.truncated ? ' строк предпросмотра' : ''}. {printRestriction ? 'Excel — весь отчёт.' : onDownloadExcel ? 'Excel и печать/PDF — весь отчёт.' : 'Печать/PDF — весь отчёт.'}</span>
        {page.pageCount > 1 ? <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page.page === 0 || printing} onClick={() => setPageState({ report, page: page.page - 1 })}>Назад</Button>
          <Button variant="outline" size="sm" disabled={page.page === page.pageCount - 1 || printing} onClick={() => setPageState({ report, page: page.page + 1 })}>Далее</Button>
        </div> : null}
      </div> : null}
      {printError ? <p role="alert" className="px-5 py-2 text-sm text-rose-700">{printError}</p> : null}
      {downloadError ? <p role="alert" className="px-5 py-2 text-sm text-rose-700">{downloadError}</p> : null}
      {busy ? <p role="status" className="p-6 text-sm text-slate-500">Подготавливаем отчёт по сохранённым данным…</p> : error ? <div className="space-y-3 p-6"><p role="alert" className="text-sm text-rose-700">{error}</p><Button variant="outline" onClick={onRetry}>Повторить</Button></div> : report ?
        <iframe ref={frame} title={report.title} srcDoc={frameHtml} sandbox={PREVIEW_FRAME_SANDBOX} onLoad={loaded} className="min-h-0 w-full flex-1 border-0 bg-slate-50" /> : null}
    </div>
  </LargeDialogShell>
}
