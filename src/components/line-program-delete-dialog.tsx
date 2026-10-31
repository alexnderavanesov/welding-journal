import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LargeDialogShell } from './large-dialog-shell'
import { DialogHeader } from './dialog-header'
import { Button } from './ui/button'
import type { LineProgramRecord } from '@/lib/line-program'
import { deleteLineProgram, previewLineProgramDeletion } from '@/server/line-program-deletion'
import { removeLineProgramSectionCaches } from '@/lib/line-program-section-cache'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { useContainedDialogFocus } from '@/lib/use-contained-dialog-focus'

export function LineProgramDeleteDialog({ line, onClose, onDeleted }: { line: LineProgramRecord; onClose: () => void; onDeleted: (id: number) => void }) {
  const client = useQueryClient()
  const data = { id: line.id, version: line.version }
  const check = useQuery({ queryKey: ['line-program', 'deletion', line.id, line.version], queryFn: () => previewLineProgramDeletion({ data }), retry: false, staleTime: 0 })
  const mutation = useMutation({ mutationFn: () => deleteLineProgram({ data }), onSuccess: async () => {
    await removeLineProgramSectionCaches(client, line.id)
    scheduleWeldDataRefresh(client, undefined, { lineProgramListsHandled: true })
    void client.invalidateQueries({ queryKey: ['psto-line-assignments'] })
    onDeleted(line.id)
  } })
  const panelRef = useContainedDialogFocus(onClose, mutation.isPending)
  const error = mutation.error || check.error
  return <LargeDialogShell ariaLabel="Удалить линию из программы" maxWidthClassName="max-w-lg" panelRadiusClassName="rounded-xl">
    <div ref={panelRef} className="contents">
    <DialogHeader title="Удалить линию из программы?" onClose={onClose} closeDisabled={mutation.isPending} />
    <div className="space-y-3 px-5 py-4 text-sm text-slate-600">
      <p className="font-medium text-slate-900">{line.line}<span className="mt-1 block text-xs font-normal text-slate-500">{[line.projectTitle, line.subtitleCode].filter(Boolean).join(' · ')}</span></p>
      {check.isPending ? <p role="status">Проверяем записи журнала и историю линии…</p> : check.data?.reason ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{check.data.reason}</p> : check.data ? <><p>Линия пустая: записей журнала и связанной истории ПСТО нет.</p><p>Программа и настройки этой линии будут удалены. Если позже добавить стык с теми же проектом, шифром и линией, программа появится снова.</p></> : null}
      {error ? <p role="alert" className="text-red-700">{error.message}</p> : null}
    </div>
    <div className="flex justify-end gap-2 border-t px-5 py-3"><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>{check.data?.reason ? 'Закрыть' : 'Отмена'}</Button>{check.error ? <Button variant="outline" onClick={() => void check.refetch()}>Повторить проверку</Button> : null}<Button variant="destructive" disabled={!check.data || !!check.data.reason || check.isFetching || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Удаляем…' : 'Удалить линию'}</Button></div>
    </div>
  </LargeDialogShell>
}
