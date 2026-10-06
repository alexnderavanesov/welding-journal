import type { WeldRow } from './dispatcher-types'
import { getLineProgramOfficialStamps, isLineProgramControlRow } from './line-program-calculation'
import { calculateFinalStatus } from './weld-status'

export type ProgramStatusFilter = 'good' | 'incomplete' | 'rejected' | 'error'
export type ProgramRowCounts = Record<ProgramStatusFilter | 'all', number>
export const PROGRAM_STATUS_LABELS: Record<ProgramStatusFilter, string> = {
  good: 'Годен', incomplete: 'Не завершено', rejected: 'Не годен', error: 'Ошибка данных',
}

/** Saved final state, never quota coverage, a draft, or one successful method. */
export function programRowStatus(row: WeldRow): ProgramStatusFilter | null {
  if (!isLineProgramControlRow(row)) return null
  const status = calculateFinalStatus(row)
  return status === 'годен' ? 'good' : status.startsWith('не годен') ? 'rejected'
    : status === 'ошибка' ? 'error' : 'incomplete'
}

export function countProgramRows(rows: readonly WeldRow[]): ProgramRowCounts {
  const result: ProgramRowCounts = { all: rows.length, good: 0, incomplete: 0, rejected: 0, error: 0 }
  for (const row of rows) { const status = programRowStatus(row); if (status) result[status]++ }
  return result
}

export function programRowSearchText(row: WeldRow) {
  return [row.joint, row.connectionType, ...getLineProgramOfficialStamps(row)]
    .map(value => String(value ?? '')).join(' ').toLocaleLowerCase('ru')
}
