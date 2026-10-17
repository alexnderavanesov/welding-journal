import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, Printer, X } from 'lucide-react'
import { buildPrintableReportHtml, type PrintableReport } from '@/lib/printable-report'
import { getPrintableReportPage } from '@/lib/printable-report-page'
import { prepareFullReportPrint, prepareHtmlDocumentPrint } from '@/lib/print-full-report'
import { getReportPrintRestriction } from '@/lib/report-print-policy'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'

/** Same escaped, print-ready document as a separate report tab, without popup permission. */
export type TemplatePreviewDocument = {
  title: string
  html: string
  buildPrintHtml: () => string
  printRestriction: string
  navigation: ReactNode
  /** Screen-only zoom; automatic sizing keeps small sheets at most 150%. */
  scale?: number | 'auto'
}

export function PrintableReportPreview({ report, templateDocument, busy, error, onClose, onRetry, onDownloadExcel }: {
  report: PrintableReport | null; busy: boolean; error: string; onClose: () => void; onRetry: () => void
  onDownloadExcel?: () => Promise<void>
  templateDocument?: TemplatePreviewDocument | null
}) {
  const panel = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null), detachFrame = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false), [printError, setPrintError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const downloadingRef = useRef(false)
  const [downloadError, setDownloadError] = useState('')
  const [pageState, setPageState] = useState({ report, page: 0 })
  const restrictionId = useId()
  const printRestriction = useMemo(() => templateDocument?.printRestriction ?? (report ? getReportPrintRestriction(report) : ''), [report, templateDocument])
  const page = useMemo(() => report ? getPrintableReportPage(report, pageState.report === report ? pageState.page : 0) : null, [report, pageState])
  const html = useMemo(() => templateDocument?.html ?? (page ? buildPrintableReportHtml(page.report, { embedded: true }) : ''), [page, templateDocument])
  const previewTitle = templateDocument !== undefined ? 'Предпросмотр документа' : 'Предпросмотр отчёта'
  const disposePrint = useRef<(() => void) | null>(null)
  const printAction = useRef<() => void>(() => {})
  const printingRef = useRef(false)
  const [printing, setPrinting] = useState(false)
  useLayoutEffect(() => { setReady(false); setPrintError('') }, [html])
  useLayoutEffect(() => {
    const iframe = frame.current, doc = iframe?.contentDocument, scale = templateDocument?.scale
    if (!ready || !iframe || !doc || scale === undefined) return
    const paper = doc.querySelector<HTMLElement>('[data-document-preview-page]')
    if (!paper) return
    const resize = () => {
      if (scale !== 'auto') { paper.style.zoom = String(scale / 100); return }
      const style = iframe.contentWindow?.getComputedStyle(doc.body)
      const padding = (parseFloat(style?.paddingLeft ?? '') || 0) + (parseFloat(style?.paddingRight ?? '') || 0)
      const available = doc.documentElement.clientWidth - padding
      // offsetWidth is the unscaled Excel layout width. Changing zoom scales
      // both axes without stretching columns or rebuilding the workbook/iframe.
      if (paper.offsetWidth > 0 && available > 0) paper.style.zoom = String(Math.min(1.5, available / paper.offsetWidth))
    }
    resize()
    if (scale !== 'auto' || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(iframe)
    return () => observer.disconnect()
  }, [ready, html, templateDocument?.scale])
  useEffect(() => {
    printingRef.current = false; setPrinting(false)
    return () => { disposePrint.current?.(); disposePrint.current = null }
  }, [report, templateDocument?.buildPrintHtml])
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    closeButton.current?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); printAction.current(); return
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const targets = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), iframe')
      if (!targets?.length) return
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }) }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }) }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); detachFrame.current?.(); previousFocus?.focus({ preventScroll: true }) }
  }, [onClose])
  const loaded = () => {
    detachFrame.current?.()
    const doc = frame.current?.contentDocument
    if (!doc || (!report && !templateDocument)) return
    // Keyboard events inside an iframe do not bubble to the containing dialog.
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); printAction.current(); return
      }
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
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
    if ((!report && !templateDocument) || !ready || busy || printingRef.current) return
    setPrintError('')
    if (templateDocument || (page && page.pageCount > 1)) {
      printingRef.current = true; setPrinting(true)
      disposePrint.current?.()
      const done = () => { printingRef.current = false; setPrinting(false); closeButton.current?.focus({ preventScroll: true }) }
      const failed = (message?: string) => {
        done(); setPrintError(message || 'Не удалось открыть печать. Повторите действие в браузере.')
      }
      disposePrint.current = templateDocument
        ? prepareHtmlDocumentPrint(templateDocument.buildPrintHtml, done, failed)
        : prepareFullReportPrint(report!, done, failed)
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
  return <LargeDialogShell ariaLabel={previewTitle} overlayClassName="z-[100] bg-slate-950/30" maxWidthClassName="max-w-[1480px]" panelClassName="h-[92vh]">
    <div ref={panel} data-document-preview="true" className="flex min-h-0 flex-1 flex-col">
      <header className={`flex flex-wrap items-center justify-between border-b border-slate-200 ${templateDocument !== undefined ? 'gap-2 px-4 py-2' : 'gap-3 px-5 py-3'}`}>
        <h2 className={`min-w-0 font-semibold text-slate-800 ${templateDocument !== undefined ? 'text-sm' : 'text-base'}`}>{previewTitle}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {onDownloadExcel ? <Button variant="outline" size={templateDocument !== undefined ? 'sm' : 'default'} disabled={busy || downloading} onClick={() => { void download() }}><Download className={templateDocument !== undefined ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />{downloading ? 'Подготавливаем Excel…' : 'Скачать Excel'}</Button> : null}
          <Button variant="outline" size={templateDocument !== undefined ? 'sm' : 'default'} disabled={(!report && !templateDocument) || !ready || busy || printing || Boolean(printRestriction)} aria-describedby={printRestriction ? restrictionId : undefined} onClick={print}><Printer className={templateDocument !== undefined ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />{printing ? 'Подготавливаем печать…' : 'Печать / Сохранить PDF'}</Button>
          <Button ref={closeButton} variant="ghost" size="icon" className={templateDocument !== undefined ? 'h-8 w-8' : undefined} onClick={onClose} aria-label="Закрыть предпросмотр"><X className="h-5 w-5" /></Button>
        </div>
      </header>
      {!busy && !error && printRestriction ? <p id={restrictionId} role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">{printRestriction}</p> : null}
      {!busy && !error && templateDocument ? <fieldset disabled={printing} className="min-w-0 border-b border-slate-200 px-4 py-2 text-xs text-slate-600">{templateDocument.navigation}</fieldset> : null}
      {!busy && !error && page && page.total > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2 text-sm text-slate-600">
        <span>Показаны {page.start + 1}–{page.end} из {page.total}. {printRestriction ? 'Excel — весь отчёт.' : onDownloadExcel ? 'Excel и печать/PDF — весь отчёт.' : 'Печать/PDF — весь отчёт.'}</span>
        {page.pageCount > 1 ? <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page.page === 0 || printing} onClick={() => setPageState({ report, page: page.page - 1 })}>Назад</Button>
          <Button variant="outline" size="sm" disabled={page.page === page.pageCount - 1 || printing} onClick={() => setPageState({ report, page: page.page + 1 })}>Далее</Button>
        </div> : null}
      </div> : null}
      {printError ? <p role="alert" className="px-5 py-2 text-sm text-rose-700">{printError}</p> : null}
      {downloadError ? <p role="alert" className="px-5 py-2 text-sm text-rose-700">{downloadError}</p> : null}
      {busy ? <p role="status" className="p-6 text-sm text-slate-500">Подготавливаем {templateDocument !== undefined ? 'документ' : 'отчёт'} по сохранённым данным…</p> : error ? <div className="space-y-3 p-6"><p role="alert" className="text-sm text-rose-700">{error}</p><Button variant="outline" onClick={onRetry}>Повторить</Button></div> : report || templateDocument ?
        <iframe ref={frame} title={templateDocument?.title ?? report!.title} srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={loaded} className="min-h-0 w-full flex-1 border-0 bg-slate-50" /> : null}
    </div>
  </LargeDialogShell>
}
