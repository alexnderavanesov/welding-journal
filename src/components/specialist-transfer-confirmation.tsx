import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { previewSpecialistTransfer } from '@/server/document-specialist-transfer-preview'
import { Button } from './ui/button'

/** One bounded read for the whole selected transfer; no per-row calls or polling. */
export function useSpecialistTransferConfirmation(rowIds: number[], target: 'primary' | 'beforeHeatTreatment') {
  const ids = [...rowIds].sort((a, b) => a - b)
  const [accepted, setAccepted] = useState('')
  const query = useQuery({
    queryKey: ['specialist-transfer', target, ids],
    queryFn: () => previewSpecialistTransfer({ data: { rowIds: ids, target } }),
    enabled: ids.length > 0, retry: false, staleTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const conflicts = query.data?.conflicts ?? []
  const ready = ids.length === 0 || (!query.isFetching && !query.isError && Boolean(query.data) &&
    (!conflicts.length || accepted === query.data?.confirmation))
  const refresh = () => { setAccepted(''); void query.refetch() }
  const notice = ids.length ? <div className="mx-5 my-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">
    {query.isFetching ? 'Проверяем специалистов переносимых заключений…' : query.isError ? <>
      <p>Не удалось проверить специалистов: {(query.error as Error).message}</p>
      <Button variant="outline" size="sm" onClick={refresh}>Повторить проверку специалистов</Button>
    </> : conflicts.length ? <>
      <p>При объединении различаются специалисты или сохранённые удостоверения. В итоговых заключениях будут очищены обе роли. Документов: {conflicts.length}.</p>
      <p className="mt-1 text-xs">{conflicts.slice(0, 5).map(item => `${item.title} (${item.date})`).join('; ')}{conflicts.length > 5 ? '…' : ''}</p>
      <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={accepted === query.data?.confirmation}
        onChange={event => setAccepted(event.target.checked ? query.data!.confirmation : '')} />Подтверждаю очистку обеих ролей в объединяемых заключениях</label>
      <Button variant="ghost" size="sm" onClick={refresh}>Обновить проверку специалистов</Button>
    </> : <><p>ФИО и удостоверения сохранятся. Конфликтов назначений нет.</p><Button variant="ghost" size="sm" onClick={refresh}>Обновить проверку специалистов</Button></>}
  </div> : null
  return { ready, notice, refresh, confirmation: ready && conflicts.length ? query.data?.confirmation : undefined }
}
