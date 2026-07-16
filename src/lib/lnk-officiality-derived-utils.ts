import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusLabel, hasRejectedLnkResult } from '@/lib/lnk-status'
import { filterLnkOfficialityRows } from '@/lib/report-modal-rows'
import { compareLnkRequestRows } from '@/lib/report-row-utils'

export type LnkOfficialityCounters = {
  unofficial: number
  rejectedOfficial: number
}

export function getFilteredLnkOfficialityRows(
  lnkRows: WeldRow[],
  lnkOfficialityDraft: LnkOfficialityDraftState,
) {
  return sortLnkOfficialityRows(
    filterLnkOfficialityRows(getActionableLnkOfficialityRows(lnkRows), lnkOfficialityDraft.search, lnkOfficialityDraft.rowIds),
  )
}

export function getSelectedLnkOfficialityRows(
  lnkRows: WeldRow[],
  lnkOfficialityDraft: LnkOfficialityDraftState,
) {
  return getActionableLnkOfficialityRows(lnkRows).filter((row) => lnkOfficialityDraft.rowIds.has(row.id))
}

export function getLnkOfficialityCounters(rows: WeldRow[]): LnkOfficialityCounters {
  return rows.reduce<LnkOfficialityCounters>(
    (counters, row) => {
      if (isUnofficialLnkOfficialityRow(row)) counters.unofficial += 1
      else if (isRejectedOfficialLnkOfficialityRow(row)) counters.rejectedOfficial += 1
      return counters
    },
    { unofficial: 0, rejectedOfficial: 0 },
  )
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

function getActionableLnkOfficialityRows(rows: WeldRow[]) {
  return rows.filter((row) => {
    if (getJointStatusLabel(row) === 'ожидает НК') return false
    return isRejectedOfficialLnkOfficialityRow(row) || isUnofficialLnkOfficialityRow(row)
  })
}

function sortLnkOfficialityRows(rows: WeldRow[]) {
  return [...rows].sort((left, right) => {
    const leftGroup = getLnkOfficialitySortGroup(left)
    const rightGroup = getLnkOfficialitySortGroup(right)
    if (leftGroup !== rightGroup) return leftGroup - rightGroup
    return compareLnkRequestRows(left, right)
  })
}

function getLnkOfficialitySortGroup(row: WeldRow) {
  if (isRejectedOfficialLnkOfficialityRow(row)) return 0
  if (isUnofficialLnkOfficialityRow(row)) return 1
  return 2
}

function isRejectedOfficialLnkOfficialityRow(row: WeldRow) {
  return !isUnofficialLnkOfficialityRow(row) && hasRejectedLnkResult(row)
}

function isUnofficialLnkOfficialityRow(row: WeldRow) {
  return String(row.status ?? '').trim().toLowerCase() === 'неофициальный'
}
