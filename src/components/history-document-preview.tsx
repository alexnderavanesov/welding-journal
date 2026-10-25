import { useEffect, useRef, useState } from 'react'
import { downloadBlob } from '@/lib/generated-document-storage'
import { readHistoryDocumentWorkbook, type HistoryDocumentWorkbook } from '@/lib/history-document-preview'
import { DocumentSheetPreview } from './document-sheet-preview'
import { Button } from './ui/button'
import { LargeDialogShell } from './large-dialog-shell'
type PreviewSnapshot = { blob: Blob; workbook: HistoryDocumentWorkbook }

export type HistoryDocumentPreviewRequest = { title: string; fileName: string; createBlob: () => Promise<Blob> }

export function HistoryDocumentPreview({ request, onClose }: { request: HistoryDocumentPreviewRequest; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null)
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const pending = useRef<{ request: HistoryDocumentPreviewRequest; attempt: number; promise: Promise<PreviewSnapshot> } | null>(null)
  const close = useRef(onClose); close.current = onClose
  const downloadButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    setSnapshot(null); setError('')
    if (pending.current?.request !== request || pending.current.attempt !== attempt) {
      pending.current = { request, attempt, promise: request.createBlob().then(async blob => {
        const data = await blob.arrayBuffer()
        return { blob, workbook: await readHistoryDocumentWorkbook(data) }
      }) }
    }
    void pending.current.promise.then(value => { if (active) setSnapshot(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось подготовить Excel.') })
    return () => { active = false }
  }, [request, attempt])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeButton.current?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector('[data-select-listbox]')) return
        event.preventDefault(); event.stopImmediatePropagation(); close.current()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault(); event.stopImmediatePropagation(); downloadButton.current?.focus()
      } else if (event.key === 'Tab') {
        const targets = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), iframe, [tabindex="0"]')
        if (!targets?.length) return
        const visible = Array.from(targets).filter(target => !target.closest('[hidden]'))
        const first = visible[0], last = visible[visible.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); previous?.focus({ preventScroll: true }) }
  }, [])
  return <LargeDialogShell ariaLabel="Предпросмотр документа" maxWidthClassName="max-w-[1440px]" panelClassName="h-[92vh] md:w-[92vw]">
    <div ref={panel} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-[1_1_240px]"><h2 className="text-xs font-medium text-slate-500">Предпросмотр документа</h2><p className="truncate text-sm font-semibold text-slate-800" title={request.title}>{request.title}</p><p className="text-xs text-slate-500">Для печати скачайте Excel и откройте его на компьютере.</p></div>
        <Button ref={downloadButton} variant="outline" size="sm" disabled={!snapshot} onClick={() => snapshot && downloadBlob(snapshot.blob, request.fileName)}>Скачать Excel</Button>
        <Button ref={closeButton} aria-label="Закрыть предпросмотр" variant="outline" size="sm" onClick={onClose}>Закрыть</Button>
      </div>
      {snapshot ? <DocumentSheetPreview workbook={snapshot.workbook} title={request.title} onClose={onClose} onPrint={() => downloadButton.current?.focus()} /> : null}
      {error ? <div className="space-y-3 p-6"><p role="alert" className="text-sm text-red-700">{error}</p><Button variant="outline" onClick={() => setAttempt(v => v + 1)}>Повторить</Button></div>
        : !snapshot ? <p role="status" className="p-6 text-sm text-slate-600">Готовим документ…</p> : null}
    </div>
  </LargeDialogShell>
}
