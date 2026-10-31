import { useLayoutEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, FileText, Link2, LoaderCircle } from 'lucide-react'
import { DialogHeader } from './dialog-header'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { useProgramDocumentPreview } from './line-program-document-link'
import { getDocumentConnections } from '@/server/document-connections'
import { getSystemDocumentLabel, type SystemDocumentReference } from '@/lib/system-document-types'
import { formatDisplayDate } from '@/lib/date-format'
import { useAccess } from '@/lib/security-context'
import { useContainedDialogFocus } from '@/lib/use-contained-dialog-focus'

export function DocumentConnectionsDialog({ reference, onClose }: { reference: SystemDocumentReference; onClose: () => void }) {
  const [trail, setTrail] = useState([reference])
  const [page, setPage] = useState(0)
  const current = trail.at(-1)!
  const { can } = useAccess()
  const query = useQuery({ queryKey: ['document-connections', current, page], queryFn: () => getDocumentConnections({ data: { reference: current, page } }), placeholderData: keepPreviousData, staleTime: 0, retry: false })
  const { openDocument, preview } = useProgramDocumentPreview()
  const panelRef = useContainedDialogFocus(onClose, false, !preview)
  const data = query.data
  const changingDocument = query.isPlaceholderData
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!query.isPlaceholderData) contentRef.current?.scrollTo({ top: 0 })
  }, [data, query.isPlaceholderData])
  const actual = data?.reference ?? current
  const area = actual.type.startsWith('psto') || actual.methodCode === 'ТВМТ' ? 'psto' : 'lnk'
  const canPreview = can('documents.export') && can(`${area}.view`) && can('references.view')
  const caption = (item: SystemDocumentReference) => [getSystemDocumentLabel(item), item.methodCode, item.sourceKind === 'beforeHeatTreatment' ? 'до ТО' : item.cycleSequences?.length ? `циклы ${item.cycleSequences.join(', ')}` : item.sourceKind === 'pstoRepeat' ? 'повторный цикл' : item.sourceKind === 'pstoCycle' ? 'цикл ПСТО' : item.type.startsWith('psto') || item.methodCode === 'ТВМТ' ? 'цикл 1' : 'основной', formatDisplayDate(item.date)].filter(Boolean).join(' · ')
  if (preview) return preview
  return <LargeDialogShell ariaLabel="Связи документов" maxWidthClassName="max-w-2xl" maxHeightClassName="max-h-[88dvh]" panelClassName="h-[min(38rem,88dvh)]" panelRadiusClassName="rounded-xl" overlayClassName="z-[170] bg-slate-950/30">
    <div ref={panelRef} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader title="Связи документов" onClose={onClose} actions={changingDocument ? <span role="status" aria-label={`Открываем «${current.title}»`} title={`Открываем «${current.title}»`}><LoaderCircle className="h-4 w-4 animate-spin text-sky-600" /></span> : null} />
      <div ref={contentRef} aria-busy={changingDocument} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]">
        <div className="flex items-start gap-3 rounded-xl border border-sky-100 bg-sky-50/50 p-3"><FileText className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" /><div className="min-w-0 flex-1"><p className="break-words font-medium text-slate-900">{actual.title}</p><p className="mt-1 text-xs text-slate-500">{caption(actual)}</p></div>{canPreview ? <Button variant="ghost" size="sm" className="shrink-0 text-sky-700" disabled={changingDocument} onClick={() => openDocument({ reference: actual })}>Предпросмотр</Button> : null}</div>
        {query.isPending ? <p role="status" className="text-sm text-slate-500">Проверяем состав и связанные документы…</p> : null}
        {query.error ? <div role="alert" className="space-y-2 text-sm text-red-700"><p>{query.error.message}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Повторить загрузку</Button></div> : null}
        {data ? <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"><span className="text-slate-600">Позиций контроля: <strong>{data.total}</strong></span>{data.isRequest ? <><span className="text-emerald-700">Результат внесён: <strong>{data.completed} из {data.total}</strong></span>{data.completed < data.total ? <span className="text-amber-700">Ожидают результата: {data.total - data.completed}</span> : null}</> : null}</div>
          <section aria-label={data.isRequest ? 'Связанные результаты' : 'Исходные заявки'}><h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Link2 className="h-4 w-4 text-slate-400" />{data.isRequest ? 'Связанные результаты' : 'Исходные заявки'}<span className="text-xs font-normal text-slate-400">{data.documentCount}</span></h3>
            <div className="space-y-1.5">{data.items.map(item => <button key={item.reference.documentId} type="button" disabled={changingDocument} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-sky-200 hover:bg-sky-50/50" onClick={() => { setTrail(previous => [...previous, item.reference]); setPage(0) }}><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-sky-800">{item.reference.title}</span><span className="mt-1 block text-xs text-slate-500">{caption(item.reference)} · Общих позиций: {item.positions}</span></span><ArrowUpRight className="h-4 w-4 shrink-0 text-sky-500" /></button>)}</div>
            {!data.items.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">{data.isRequest && !data.completed ? 'Результаты ещё не внесены. Заявка сохранена и доступна для работы.' : 'Связанные документы не найдены.'}</p> : null}
            {data.linked < (data.isRequest ? data.completed : data.total) ? <p className="mt-2 text-xs text-amber-800">Часть фактов не имеет доступного связанного документа. Проверьте историю этих позиций.</p> : null}
          </section>
          {data.documentCount > data.pageSize ? <div className="flex items-center justify-end gap-2 text-xs text-slate-500"><Button variant="ghost" size="sm" disabled={changingDocument || !page} onClick={() => setPage(page - 1)}>Назад</Button><span>Страница {page + 1} из {Math.ceil(data.documentCount / data.pageSize)}</span><Button variant="ghost" size="sm" disabled={changingDocument || (page + 1) * data.pageSize >= data.documentCount} onClick={() => setPage(page + 1)}>Далее</Button></div> : null}
          <p className="text-xs leading-5 text-slate-400">Связи учитывают вид контроля, этап и цикл каждого стыка. Внесённый результат может быть отрицательным.</p>
        </> : null}
      </div>
      <div className="flex shrink-0 justify-between gap-2 border-t px-5 py-3">{trail.length > 1 ? <Button variant="ghost" size="sm" disabled={changingDocument} onClick={() => { setTrail(previous => previous.slice(0, -1)); setPage(0) }}><ArrowLeft className="mr-1.5 h-4 w-4" />К предыдущему документу</Button> : <span />}<Button variant="outline" size="sm" onClick={onClose}>Закрыть</Button></div>
    </div>
  </LargeDialogShell>
}
