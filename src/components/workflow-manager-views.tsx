import { lazy, Suspense, useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { FileText, List, ArrowRight } from 'lucide-react'
import { Button } from './ui/button'
import { useSystemDocumentContext } from '@/lib/use-system-document-context'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import type { WorkflowDocumentsPanelProps } from './workflow-documents-panel'

const DocumentsPanel = lazy(() => import('./workflow-documents-panel').then(module => ({ default: module.WorkflowDocumentsPanel })))

export function useWorkflowManagerView() {
  const [tab, setTab] = useState<'joints' | 'documents'>('joints')
  const [target, setTarget] = useState<SystemDocumentReference | null>(null)
  const [openRequestId, setOpenRequestId] = useState(0)
  const openDocument = useCallback((reference: SystemDocumentReference) => {
    setTarget(reference)
    setOpenRequestId(current => current + 1)
    setTab('documents')
  }, [])
  return { tab, setTab, target, openRequestId, openDocument }
}

export function WorkflowManagerViews({ view, documents, children }: {
  view: ReturnType<typeof useWorkflowManagerView>
  documents: Omit<WorkflowDocumentsPanelProps, 'target' | 'openRequestId' | 'onSavingChange'>
  children: ReactNode
}) {
  const id = useId()
  const [visited, setVisited] = useState(false)
  const [isSavingDocument, setIsSavingDocument] = useState(false)
  useEffect(() => { if (view.tab === 'documents') setVisited(true) }, [view.tab])
  return <>
    <div role="tablist" aria-label="Стыки и документы" className="flex shrink-0 gap-1 border-b border-slate-200 px-5 pt-2">
      {(['joints', 'documents'] as const).map((tab) => <button key={tab} type="button" role="tab"
        id={`${id}-${tab}`} aria-controls={`${id}-${tab}-panel`} tabIndex={view.tab === tab ? 0 : -1}
        disabled={isSavingDocument && tab === 'joints'} title={isSavingDocument && tab === 'joints' ? 'Дождитесь сохранения документа.' : undefined}
        aria-selected={view.tab === tab} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'joints' : event.key === 'End' ? 'documents' : tab === 'joints' ? 'documents' : 'joints'
          if (isSavingDocument && next === 'joints') return
          view.setTab(next)
          document.getElementById(`${id}-${next}`)?.focus()
        }} onClick={() => { if (!isSavingDocument || tab !== 'joints') view.setTab(tab) }}
        className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium disabled:cursor-wait disabled:opacity-50 ${view.tab === tab ? 'border-sky-500 text-sky-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
        {tab === 'joints' ? <List className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        {tab === 'joints' ? 'Стыки' : 'Документы'}
      </button>)}
    </div>
    <div role="tabpanel" id={`${id}-joints-panel`} aria-labelledby={`${id}-joints`} style={{ display: view.tab === 'joints' ? undefined : 'none' }} className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    {visited || view.tab === 'documents' ? <div role="tabpanel" id={`${id}-documents-panel`} aria-labelledby={`${id}-documents`} style={{ display: view.tab === 'documents' ? undefined : 'none' }} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<p className="p-5 text-sm text-slate-500">Загрузка документов…</p>}><DocumentsPanel {...documents}
        disabled={documents.disabled || isSavingDocument} onSavingChange={setIsSavingDocument}
        target={view.target} openRequestId={view.openRequestId} /></Suspense>
    </div> : null}
  </>
}

/** Mounted with the position editor: shares its full composition read with Documents. */
export function WorkflowDocumentLink({ reference, onOpen, onCompositionLoaded, focusDate }: {
  reference: SystemDocumentReference
  onOpen: (reference: SystemDocumentReference) => void
  onCompositionLoaded?: (count: number) => void
  focusDate?: boolean
}) {
  const context = useSystemDocumentContext(reference)
  useEffect(() => { if (context.data) onCompositionLoaded?.(new Set(context.data.rows.map(row => row.id)).size) }, [context.data, onCompositionLoaded])
  useEffect(() => { if (focusDate) onOpen(reference) }, [focusDate, onOpen])
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
    <div className="min-w-0 text-xs leading-5 text-slate-500"><p className="break-words font-medium text-slate-700">{reference.title}</p>Дата и название относятся ко всему документу.</div>
    <Button type="button" variant="outline" size="sm" onClick={() => onOpen(reference)}>К документу<ArrowRight className="ml-2 h-4 w-4" /></Button>
    {context.isError ? <p className="text-xs text-rose-700">Не удалось проверить состав. <button type="button" className="underline" onClick={() => void context.refetch()}>Повторить</button></p> : null}
  </div>
}
