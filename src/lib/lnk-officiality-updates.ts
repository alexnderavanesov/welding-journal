import { hasRejectedLnkResult } from '@/lib/lnk-status'
import { withTouchedLnkTimestamp } from '@/lib/lnk-field-updates'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

export function buildLnkOfficialityRows({
  records,
  officiality,
}: {
  records: RowWithId[]
  officiality: 'official' | 'unofficial'
}) {
  if (officiality === 'unofficial') {
    const invalidRecords = records.filter((record) => !hasRejectedLnkResult(record))
    if (invalidRecords.length > 0) {
      throw new Error('Значение «неофициальный» можно назначить только после результата контроля «ремонт» или «вырез»')
    }
  }
  const nextOfficiality = officiality === 'unofficial' ? 'неофициальный' : null
  return records
    .map((record) => withTouchedLnkTimestamp({ ...record, officiality: nextOfficiality }))
    .filter((record, index) => String(records[index].officiality ?? '').trim() !== String(nextOfficiality ?? '').trim()) as RowWithId[]
}
