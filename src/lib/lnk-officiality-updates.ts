import { hasRejectedLnkResult } from '@/lib/lnk-status'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

export function buildLnkOfficialityRows({
  records,
  status,
}: {
  records: RowWithId[]
  status: 'official' | 'unofficial'
}) {
  if (status === 'unofficial') {
    const invalidRecords = records.filter((record) => !hasRejectedLnkResult(record))
    if (invalidRecords.length > 0) {
      throw new Error('Неофициальный статус можно назначить только после результата контроля "ремонт" или "вырез"')
    }
  }
  const nextStatus = status === 'unofficial' ? 'неофициальный' : null
  return records
    .map((record) => ({ ...record, status: nextStatus }))
    .filter((record, index) => String(records[index].status ?? '').trim() !== String(nextStatus ?? '').trim()) as RowWithId[]
}
