import { useAccess } from '@/lib/security-context'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { DialogHeader } from './dialog-header'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { DocumentConnectionsDialog } from './document-connections-dialog'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { PendingDocumentSave } from '@/lib/document-save-recovery'
import { dismissDocumentSave } from '@/lib/run-document-save'
import { checkDocumentSave } from '@/server/document-save-recovery-api'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY } from '@/lib/system-document-sequence-storage'
import { useContainedDialogFocus } from '@/lib/use-contained-dialog-focus'

export function DocumentSaveRecoveryDialog({ pending }: { pending: PendingDocumentSave }) {
  const [minimized, setMinimized] = useState(false)
  const client = useQueryClient()
  const { can } = useAccess()
  const [document, setDocument] = useState<SystemDocumentReference | null>(null)
  const confirm = useConfirmAction()
  const check = useMutation({ mutationFn: () => checkDocumentSave({ data: pending }), onSuccess: result => {
    if (result.confirmed) { scheduleWeldDataRefresh(client, undefined, { refetchLnkWorkflow: true, refetchPstoWorkflow: true }); void client.invalidateQueries({ queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY }) }
  } })
  const panelRef = useContainedDialogFocus(() => setMinimized(true), check.isPending, !minimized && !document)
  if (document) return <DocumentConnectionsDialog reference={document} onClose={() => setDocument(null)} />
  if (minimized) return <button type="button" className="fixed bottom-5 right-5 z-[170] rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm text-sky-800 shadow-lg" onClick={() => setMinimized(false)}>Проверить сохранение документа</button>
  return <LargeDialogShell ariaLabel="Проверка сохранения" maxWidthClassName="max-w-xl" panelRadiusClassName="rounded-xl" overlayClassName="z-[160] bg-slate-950/30">
    <div ref={panelRef} className="contents">
      <DialogHeader title={check.data?.confirmed ? 'Документы сохранены' : 'Ответ о сохранении не получен'} onClose={() => setMinimized(true)} closeDisabled={check.isPending} />
      <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm text-slate-600">
        {check.data?.confirmed ? <><p className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Сохранение подтверждено. Повторять его не нужно.</p><p>Можно открыть сохранённый документ или вернуться к работе.</p><div className="space-y-1">{check.data.references.map((reference, index) => <button type="button" key={reference.documentId ?? index} className="block w-full rounded-lg border border-sky-100 bg-sky-50/50 px-3 py-2 text-left text-sky-800 hover:bg-sky-100" disabled={!can('documents.view')} onClick={() => setDocument(reference)}>{reference.title}{can('documents.view') ? <span className="ml-2 text-xs text-slate-500">Открыть документ</span> : null}</button>)}</div></>
        : <><p>Соединение прервалось, поэтому пока неизвестно, завершилось ли сохранение. Проверка найдёт подтверждение именно этой операции.</p>{check.data && !check.data.confirmed ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">Подтверждение пока не найдено. Операция ещё может выполняться. Проверьте позже; это не означает, что документ не сохранён.</p> : null}</>}
        {check.error ? <p role="alert" className="text-red-700">{check.error.message}</p> : null}
      </div>
      {!check.data?.confirmed ? <div className="px-5 pb-3"><button type="button" className="text-xs text-slate-500 hover:underline" onClick={async () => { if (await confirm({ title: 'Закрыть проверку сохранения?', tone: 'warning', description: 'Это не отменяет операцию на сервере. Перед новым сохранением обновите данные и проверьте список документов.', confirmLabel: 'Закрыть проверку' })) { scheduleWeldDataRefresh(client, undefined, { refetchLnkWorkflow: true, refetchPstoWorkflow: true }); dismissDocumentSave(pending.id) } }}>Закрыть эту проверку</button></div> : null}
      <div className="flex justify-end gap-2 border-t px-5 py-3"><Button variant="outline" disabled={check.isPending} onClick={() => setMinimized(true)}>Позже</Button>{check.data?.confirmed ? <Button onClick={() => dismissDocumentSave(pending.id)}>Вернуться к работе</Button> : <Button disabled={check.isPending} onClick={() => check.mutate()}><RefreshCw className={`mr-2 h-4 w-4 ${check.isPending ? 'animate-spin' : ''}`} />{check.isPending ? 'Проверяем…' : 'Проверить сохранение'}</Button>}</div>
    </div>
  </LargeDialogShell>
}
