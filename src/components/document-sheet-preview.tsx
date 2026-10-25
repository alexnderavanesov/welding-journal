import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DOCUMENT_PREVIEW_PAGE_COLUMNS, DOCUMENT_PREVIEW_PAGE_ROWS, type HistoryDocumentWorkbook } from '@/lib/history-document-preview'
import { attachPreviewZoom, previewZoomAnchor } from '@/lib/preview-zoom'
import { buildPreviewFrameHtml, PREVIEW_FRAME_SANDBOX } from '@/lib/document-preview-frame'
import { Select } from './ui/select'
import { Button } from './ui/button'

export function DocumentSheetPreview({ workbook, title, onClose, onPrint }: {
  workbook: HistoryDocumentWorkbook; title: string; onClose: () => void; onPrint: () => void
}) {
  const [sheet, setSheet] = useState(0), [row, setRow] = useState(0), [column, setColumn] = useState(0)
  const [zoom, setZoom] = useState<number | 'auto'>('auto'), [loaded, setLoaded] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null), actions = useRef({ onClose, onPrint })
  actions.current = { onClose, onPrint }
  const html = useMemo(() => buildPreviewFrameHtml(workbook.page(sheet, row, column, title)), [workbook, sheet, row, column, title])
  const current = workbook.sheets[sheet]
  useLayoutEffect(() => {
    const iframe = frame.current, doc = iframe?.contentDocument
    const paper = doc?.querySelector<HTMLElement>('[data-document-preview-page]')
    if (!iframe || !paper) return
    const resize = () => {
      const available = iframe.clientWidth - 32
      if (available > 0) paper.style.zoom = String(zoom === 'auto' ? Math.max(.25, Math.min(1, available / paper.offsetWidth)) : zoom / 100)
    }
    resize()
    const observer = new ResizeObserver(resize); observer.observe(iframe)
    return () => observer.disconnect()
  }, [loaded, zoom])
  useEffect(() => {
    const doc = frame.current?.contentDocument, win = doc?.defaultView
    const paper = doc?.querySelector<HTMLElement>('[data-document-preview-page]')
    if (!doc || !win || !paper) return
    const detach = attachPreviewZoom(doc.documentElement, { min: .25, max: 3, getScale: () => Number(paper.style.zoom) || 1,
      onZoom: (scale, point) => {
        const anchor = previewZoomAnchor(paper, point, scale / (Number(paper.style.zoom) || 1))
        paper.style.zoom = String(scale); win.scrollBy(anchor()); setZoom(Math.round(scale * 100))
      } })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); actions.current.onClose() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); actions.current.onPrint() }
      if (event.key === 'Tab') { event.preventDefault(); frame.current?.closest('[role="dialog"]')?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }
    }
    doc.addEventListener('keydown', keydown)
    return () => { detach(); doc.removeEventListener('keydown', keydown) }
  }, [loaded])
  return <div className="flex min-h-0 flex-1 flex-col" data-sheet-preview>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
      <label className="flex items-center gap-2">Лист <Select aria-label="Лист документа" className="h-8 w-auto max-w-64 text-xs" value={sheet} onChange={event => { setSheet(Number(event.target.value)); setRow(0); setColumn(0) }}>
        {workbook.sheets.map((item, i) => <option key={item.name} value={i}>{item.name}</option>)}
      </Select></label>
      <label className="flex items-center gap-2">Масштаб <Select aria-label="Масштаб листа" className="h-8 w-32 text-xs" value={zoom} onChange={event => setZoom(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}>
        <option value="auto">По ширине</option>{[...new Set([25, 50, 75, 100, 125, 150, 200, 300, ...(typeof zoom === 'number' ? [zoom] : [])])].sort((a,b) => a-b).map(value => <option key={value} value={value}>{value}%</option>)}
      </Select></label>
      {current.rowCount > DOCUMENT_PREVIEW_PAGE_ROWS ? <div className="flex items-center gap-2"><span>Строки {row * DOCUMENT_PREVIEW_PAGE_ROWS + 1}–{Math.min((row + 1) * DOCUMENT_PREVIEW_PAGE_ROWS, current.rowCount)} из {current.rowCount}</span>
        <Button size="sm" variant="ghost" disabled={!row} onClick={() => setRow(value => value - 1)}>Назад</Button><Button size="sm" variant="ghost" disabled={(row + 1) * DOCUMENT_PREVIEW_PAGE_ROWS >= current.rowCount} onClick={() => setRow(value => value + 1)}>Далее</Button></div> : null}
      {current.columnCount > DOCUMENT_PREVIEW_PAGE_COLUMNS ? <div className="flex items-center gap-2"><span>Столбцы {column * DOCUMENT_PREVIEW_PAGE_COLUMNS + 1}–{Math.min((column + 1) * DOCUMENT_PREVIEW_PAGE_COLUMNS, current.columnCount)} из {current.columnCount}</span>
        <Button size="sm" variant="ghost" disabled={!column} onClick={() => setColumn(value => value - 1)}>Левее</Button><Button size="sm" variant="ghost" disabled={(column + 1) * DOCUMENT_PREVIEW_PAGE_COLUMNS >= current.columnCount} onClick={() => setColumn(value => value + 1)}>Правее</Button></div> : null}
      <span className="ml-auto text-slate-500">Ctrl/Cmd + колесо — масштаб</span>
    </div>
    {current.unsupported ? <p role="note" className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">Некоторые рисунки или объекты этого листа доступны только в Excel.</p> : null}
    <iframe ref={frame} title={`Лист документа: ${title}`} srcDoc={html} sandbox={PREVIEW_FRAME_SANDBOX} onLoad={() => setLoaded(value => value + 1)} className="min-h-0 w-full flex-1 border-0 bg-slate-100" />
  </div>
}
