import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadBlob } from '@/lib/generated-document-storage'
import { DOCUMENT_PREVIEW_PAGE_COLUMNS, DOCUMENT_PREVIEW_PAGE_ROWS, readHistoryDocumentWorkbook, type HistoryDocumentWorkbook } from '@/lib/history-document-preview'
import { PrintableReportPreview } from './printable-report-preview'
import { Button } from './ui/button'

export type HistoryDocumentPreviewRequest = { title: string; fileName: string; createBlob: () => Promise<Blob> }

export function HistoryDocumentPreview({ request, onClose }: { request: HistoryDocumentPreviewRequest; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<{ workbook: HistoryDocumentWorkbook; blob: Blob } | null>(null)
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [sheet, setSheet] = useState(0), [rowPage, setRowPage] = useState(0), [columnPage, setColumnPage] = useState(0), [zoom, setZoom] = useState<number | 'auto'>('auto')
  // Closing while loading never opens a late window or downloads anything.
  const pending = useRef<{ request: HistoryDocumentPreviewRequest; attempt: number; promise: Promise<{ workbook: HistoryDocumentWorkbook; blob: Blob }> } | null>(null)
  useEffect(() => {
    let active = true
    setSnapshot(null); setError(''); setSheet(0); setRowPage(0); setColumnPage(0)
    if (pending.current?.request !== request || pending.current.attempt !== attempt) {
      pending.current = { request, attempt, promise: request.createBlob().then(async blob => ({ blob, workbook: await readHistoryDocumentWorkbook(await blob.arrayBuffer()) })) }
    }
    void pending.current.promise.then(value => { if (active) setSnapshot(value) }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось подготовить документ.')
    })
    return () => { active = false }
  }, [request, attempt])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const print = useCallback(() => snapshot!.workbook.print(request.title), [snapshot, request.title])
  const download = useCallback(async () => { if (snapshot) downloadBlob(snapshot.blob, request.fileName) }, [snapshot, request.fileName])
  const html = useMemo(() => snapshot?.workbook.page(sheet, rowPage, columnPage, request.title) ?? '', [snapshot, sheet, rowPage, columnPage, request.title])
  const templateDocument = useMemo(() => {
    if (!snapshot) return null
    const workbook = snapshot.workbook, current = workbook.sheets[sheet]
    const rowPages = Math.max(1, Math.ceil(current.rowCount / DOCUMENT_PREVIEW_PAGE_ROWS)), columnPages = Math.max(1, Math.ceil(current.columnCount / DOCUMENT_PREVIEW_PAGE_COLUMNS))
    return {
      title: request.title,
      html,
      scale: zoom,
      buildPrintHtml: print,
      printRestriction: workbook.printRestriction,
      navigation: <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 flex-[1_1_240px] break-words text-[13px] font-medium text-slate-800">{request.title}</p>
          <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2">
          <label className="inline-flex min-w-0 items-center gap-1.5">Лист <select aria-label="Лист документа" className="h-7 min-w-0 max-w-56 rounded border border-slate-300 bg-white py-1 pl-2 pr-7 text-xs" value={sheet} onChange={event => { setSheet(Number(event.target.value)); setRowPage(0); setColumnPage(0) }}>{workbook.sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
          <label className="inline-flex items-center gap-1.5">Масштаб <select aria-label="Масштаб документа" className="h-7 rounded border border-slate-300 bg-white py-1 pl-2 pr-7 text-xs" value={zoom} onChange={event => setZoom(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}><option value="auto">Авто</option>{[50, 75, 100, 125, 150].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
          <span>Строки {current.rowCount ? rowPage * DOCUMENT_PREVIEW_PAGE_ROWS + 1 : 0}–{Math.min(current.rowCount, (rowPage + 1) * DOCUMENT_PREVIEW_PAGE_ROWS)} из {current.rowCount}</span>
          {rowPages > 1 ? <div className="flex gap-2"><Button variant="outline" size="sm" disabled={rowPage === 0} onClick={() => setRowPage(value => value - 1)}>Назад</Button><Button variant="outline" size="sm" disabled={rowPage === rowPages - 1} onClick={() => setRowPage(value => value + 1)}>Далее</Button></div> : null}
          {columnPages > 1 ? <div className="flex items-center gap-2"><span>Столбцы {columnPage * DOCUMENT_PREVIEW_PAGE_COLUMNS + 1}–{Math.min(current.columnCount, (columnPage + 1) * DOCUMENT_PREVIEW_PAGE_COLUMNS)} из {current.columnCount}</span><Button variant="outline" size="sm" disabled={columnPage === 0} onClick={() => setColumnPage(value => value - 1)}>Левее</Button><Button variant="outline" size="sm" disabled={columnPage === columnPages - 1} onClick={() => setColumnPage(value => value + 1)}>Правее</Button></div> : null}
          </div>
        </div>
        <p className="text-xs text-slate-500">Excel — весь документ. {workbook.printRestriction ? '' : 'Печать/PDF — все видимые листы, независимо от страницы просмотра.'} Оформление ячеек — из Excel-шаблона.</p>
        {workbook.sheets.some(item => item.hasDrawings) ? <p role="note" className="text-xs text-amber-800">Рисунки и диаграммы доступны в Excel; предпросмотр и PDF показывают ячейки.</p> : null}
      </div>,
    }
  }, [snapshot, sheet, rowPage, columnPage, zoom, request.title, print, html])
  return <PrintableReportPreview report={null} templateDocument={templateDocument} busy={!snapshot && !error} error={error} onClose={onClose} onRetry={retry} onDownloadExcel={snapshot ? download : undefined} />
}
