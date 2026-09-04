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
    filterLnkOfficialityRows(getActionableLnkOfficialityRows(lnkRows), lnkOfficialityDraft.search),
  )
}

export function getSelectedLnkOfficialityRows(
  lnkRows: WeldRow[],
  lnkOfficialityDraft: LnkOfficialityDraftState,
) {
  return lnkRows.filter(
    (row) => lnkOfficialityDraft.rowIds.has(row.id) && isActionableLnkOfficialityRow(row),
  )
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
  if (isLnkOfficialitySaving) return 'Официальность сохраняется, дождитесь завершения.'
  if (!lnkOfficialityDraft.officiality) return 'Выберите значение «официальный» или «неофициальный».'
  if (selectedLnkOfficialityRows.length === 0) return 'Отметьте один или несколько стыков.'
  if (lnkOfficialityDraft.officiality === 'unofficial' && selectedLnkOfficialityRows.some((row) => !hasRejectedLnkResult(row))) {
    return 'Значение «неофициальный» можно назначить только стыкам с результатом контроля «ремонт» или «вырез».'
  }
  return ''
}

function getActionableLnkOfficialityRows(rows: WeldRow[]) {
  return rows.filter(isActionableLnkOfficialityRow)
}

function isActionableLnkOfficialityRow(row: WeldRow) {
  if (getJointStatusLabel(row) === 'ожидает НК') return false
  return isRejectedOfficialLnkOfficialityRow(row) || isUnofficialLnkOfficialityRow(row)
}

function sortLnkOfficialityRows(rows: WeldRow[]) {
  return rows
    .map((row, index) => ({ row, index, group: getLnkOfficialitySortGroup(row) }))
    .sort((left, right) => {
      if (left.group !== right.group) return left.group - right.group
      return compareLnkRequestRows(left.row, right.row) || left.index - right.index
    })
    .map(({ row }) => row)
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
  return String(row.officiality ?? '').trim().toLowerCase() === 'неофициальный'
}
