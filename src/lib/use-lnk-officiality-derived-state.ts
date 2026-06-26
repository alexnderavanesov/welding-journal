import { useMemo } from 'react'
import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import { hasRejectedLnkResult } from '@/lib/lnk-status'
import { filterLnkOfficialityRows } from '@/lib/report-modal-rows'
import type { WeldRow } from '@/lib/dispatcher-types'

type LnkOfficialityDerivedStateParams = {
  lnkRows: WeldRow[]
  lnkOfficialityDraft: LnkOfficialityDraftState
  isLnkOfficialitySaving: boolean
}

export function useLnkOfficialityDerivedState({
  lnkRows,
  lnkOfficialityDraft,
  isLnkOfficialitySaving,
}: LnkOfficialityDerivedStateParams) {
  const filteredLnkOfficialityRows = useMemo(
    () => filterLnkOfficialityRows(lnkRows, lnkOfficialityDraft.search, lnkOfficialityDraft.rowIds),
    [lnkOfficialityDraft.rowIds, lnkOfficialityDraft.search, lnkRows],
  )

  const selectedLnkOfficialityRows = useMemo(
    () => lnkRows.filter((row) => lnkOfficialityDraft.rowIds.has(row.id)),
    [lnkOfficialityDraft.rowIds, lnkRows],
  )

  const lnkOfficialitySaveBlockReason = useMemo(() => {
    if (isLnkOfficialitySaving) return 'Статус сохраняется, дождитесь завершения.'
    if (!lnkOfficialityDraft.status) return 'Выберите официальный или неофициальный статус.'
    if (selectedLnkOfficialityRows.length === 0) return 'Отметьте один или несколько стыков.'
    if (lnkOfficialityDraft.status === 'unofficial' && selectedLnkOfficialityRows.some((row) => !hasRejectedLnkResult(row))) {
      return 'Неофициальный статус можно назначить только стыкам с результатом контроля "ремонт" или "вырез".'
    }
    return ''
  }, [isLnkOfficialitySaving, lnkOfficialityDraft.status, selectedLnkOfficialityRows])

  const isLnkOfficialitySaveDisabled = Boolean(lnkOfficialitySaveBlockReason)

  return {
    filteredLnkOfficialityRows,
    selectedLnkOfficialityRows,
    lnkOfficialitySaveBlockReason,
    isLnkOfficialitySaveDisabled,
  }
}
