import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { hasRejectedLnkResult } from '@/lib/lnk-status'
import { filterLnkOfficialityRows } from '@/lib/report-modal-rows'

export function getFilteredLnkOfficialityRows(
  lnkRows: WeldRow[],
  lnkOfficialityDraft: LnkOfficialityDraftState,
) {
  return filterLnkOfficialityRows(lnkRows, lnkOfficialityDraft.search, lnkOfficialityDraft.rowIds)
}

export function getSelectedLnkOfficialityRows(
  lnkRows: WeldRow[],
  lnkOfficialityDraft: LnkOfficialityDraftState,
) {
  return lnkRows.filter((row) => lnkOfficialityDraft.rowIds.has(row.id))
}

export function getLnkOfficialitySaveBlockReason({
  isLnkOfficialitySaving,
  lnkOfficialityDraft,
  selectedLnkOfficialityRows,
}: {
  isLnkOfficialitySaving: boolean
  lnkOfficialityDraft: LnkOfficialityDraftState
  selectedLnkOfficialityRows: WeldRow[]
}) {
  if (isLnkOfficialitySaving) return 'Статус сохраняется, дождитесь завершения.'
  if (!lnkOfficialityDraft.status) return 'Выберите официальный или неофициальный статус.'
  if (selectedLnkOfficialityRows.length === 0) return 'Отметьте один или несколько стыков.'
  if (lnkOfficialityDraft.status === 'unofficial' && selectedLnkOfficialityRows.some((row) => !hasRejectedLnkResult(row))) {
    return 'Неофициальный статус можно назначить только стыкам с результатом контроля "ремонт" или "вырез".'
  }
  return ''
}
