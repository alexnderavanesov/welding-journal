import type { WeldRow } from '@/lib/dispatcher-types'
import type { LineProgramRecord } from '@/lib/line-program'
import { normalizeControlAvailabilityStorageText } from '@/lib/control-availability-values'
import { isAngularConnectionType } from '@/lib/connection-type'
import { buildLayeredControlAssignment, getLayeredControlSaveError } from '@/lib/layered-control-rules'
import { calculateLineProgram, getLineProgramOfficialStamps, isLineProgramControlRow, type LineProgramStampCalculation } from '@/lib/line-program-calculation'
import { programApprovalKey } from './program-control-approval'
import { getProgramRepairAssignmentIssues } from './line-program-repair-requirements'
import type { SystemIndexSettings } from './system-index-settings'
import type { ProgramStatusFilter } from './line-program-row-filters'

export const PROGRAM_METHODS = ['ВИК', 'РК', 'УЗК', 'ПВК', 'Послойный ПВК'] as const
// VIK remains part of validation/history, but has no user-selectable assignment.
export const PROGRAM_EDITOR_METHODS = PROGRAM_METHODS.filter(method => method !== 'ВИК')
export type ProgramMethod = typeof PROGRAM_METHODS[number]
export type ProgramAssignment = '' | 'да' | 'дополнительный' | 'отменен'
export const PROGRAM_ASSIGNMENT_OPTIONS: [ProgramAssignment, string][] = [['да', 'Да'], ['дополнительный', 'Дополнительный'], ['отменен', 'Отменен'], ['', 'Пусто — снять назначение']]
export type ProgramPatch = Partial<Record<ProgramMethod, ProgramAssignment>>
export type ProgramChange = { id: number; values: ProgramPatch }
export type ProgramSlice = 'all' | 'covered' | 'missing' | 'reduction' | 'excess' | 'approved' | 'additional' | 'assigned' | 'results' | 'cancelled' | 'duplicates' | 'candidates'
export type ProgramSelection = { stamp?: string; unassigned?: boolean; kind?: 'common' | 'pvk'; slice: ProgramSlice; status?: ProgramStatusFilter; search?: string }
export function matchesProgramScope(row: WeldRow, scope: Pick<ProgramSelection, 'stamp' | 'unassigned'>) {
  if (!scope.stamp && !scope.unassigned) return true
  if (!isLineProgramControlRow(row)) return false
  const stamps = getLineProgramOfficialStamps(row)
  return scope.unassigned ? !stamps.length : stamps.some(stamp => stamp.toLocaleLowerCase('ru') === scope.stamp!.toLocaleLowerCase('ru'))
}
/** A layered batch targets U joints only; C selections and their drafts stay untouched. */
export function getProgramBatchTargets(rows: readonly WeldRow[], patch: ProgramPatch) {
  return rows.filter(row => !patch['Послойный ПВК'] || isAngularConnectionType(row.connectionType))
}
/** Only the toolbar selection changes; no saved assignment is removed by this toggle. */
export function toggleProgramMethodSelection(previous: ReadonlySet<ProgramMethod>, method: ProgramMethod) {
  const next = new Set(previous), active = !previous.has(method)
  active ? next.add(method) : next.delete(method)
  if (method === 'Послойный ПВК') active ? next.add('ПВК') : next.delete('ПВК')
  if (method === 'ПВК' && !active) next.delete('Послойный ПВК')
  return next
}
const fields = { ВИК: 'hasVik', РК: 'hasRk', УЗК: 'hasUzk', ПВК: 'hasPvk' } as const

export function programAssignment(row: WeldRow, method: ProgramMethod): string {
  return method === 'Послойный ПВК' ? row.layeredControlAssigned ? 'да' : '' : normalizeControlAvailabilityStorageText(row[fields[method]]) ?? ''
}

export function isProgramEditableRow(row: WeldRow) {
  return isLineProgramControlRow(row)
}

/** Only assignments are patched. Factual results, requests and document identities are retained. */
export function applyProgramPatch(row: WeldRow, patch: ProgramPatch): WeldRow {
  if (!isProgramEditableRow(row)) throw new Error('Выберите актуальные официальные С/У-стыки.')
  let next = { ...row }
  for (const [method, value] of Object.entries(patch)) {
    if (!PROGRAM_METHODS.includes(method as ProgramMethod) || !['', 'да', 'дополнительный', 'отменен'].includes(value)) throw new Error('Неизвестный метод или состояние назначения.')
    if (method === 'ВИК' && value !== 'да') throw new Error('ВИК обязателен: допускается только назначение «Да».')
    if (method === 'Послойный ПВК') {
      if (value !== 'да') throw new Error('Снятие послойного контроля выполняется отдельной командой с подтверждением удаления его документов.')
    } else {
      // A calculated lack of demand is not a ban on an explicit card-compatible edit.
      next = { ...next, [fields[method as keyof typeof fields]]: value || null }
    }
  }
  if (patch['Послойный ПВК']) {
    if (patch.ПВК !== undefined && patch.ПВК !== 'да') throw new Error('Послойный контроль требует ПВК = «да».')
    // Cancelled/additional PVK must be explicitly changed to Yes, never silently replaced.
    next = buildLayeredControlAssignment(next, patch.ПВК === 'да')
  }
  const error = getLayeredControlSaveError(next, row)
  if (error) throw new Error(error)
  const repairIssues = getProgramRepairAssignmentIssues(next, row)
  if (repairIssues.length) throw new Error(repairIssues.map(issue => issue.message).join('\n'))
  return next
}

export type ProgramExcessEntry = { key: string; rowId: number; stamp: string; kind: 'common' | 'pvk'; duplicate: boolean; method?: ProgramMethod }
/** Approval belongs to a concrete joint and method combination, regardless of quota. */
export function programExcessEntries(lineId: number, rows: readonly WeldRow[], calculations: readonly LineProgramStampCalculation[]): ProgramExcessEntry[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  return calculations.flatMap(group => (['common', 'pvk'] as const).flatMap(kind => {
    const demand = group[kind]
    const assignments = demand.excessAssignments ?? ([['excessRowIds', false], ['duplicateAssignmentRowIds', true]] as const).flatMap(([field, duplicate]) => demand[field].map(rowId => ({ rowId, duplicate, method: undefined })))
    return assignments.map(({ rowId, duplicate, method }) => {
      const row = byId.get(rowId)!
      return { rowId, method, stamp: group.stamp, kind, duplicate, key: programApprovalKey(row, kind, duplicate) }
    })
  }))
}

export function previewProgramChanges(rows: readonly WeldRow[], changes: readonly ProgramChange[], line: Pick<LineProgramRecord, 'id' | 'weldControlPercent' | 'pvkControlPercent'>, settings?: SystemIndexSettings, approved: ReadonlySet<string> = new Set()) {
  const byId = new Map(rows.map(row => [row.id, row]))
  const changed = new Map<number, WeldRow>()
  const errors: string[] = []
  for (const change of changes) {
    const row = byId.get(change.id)
    if (!row || changed.has(change.id)) { errors.push('Стык отсутствует или повторён в выборе.'); continue }
    try { changed.set(row.id, applyProgramPatch(row, change.values)) }
    catch (error) { errors.push(`${row.joint || row.id}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const after = rows.map(row => changed.get(row.id) ?? row)
  const beforeCalc = calculateLineProgram(rows, line.weldControlPercent!, line.pvkControlPercent!, settings, approved)
  const afterCalc = calculateLineProgram(after, line.weldControlPercent!, line.pvkControlPercent!, settings, approved)
  const beforeEntries = programExcessEntries(line.id, rows, beforeCalc)
  const afterEntries = programExcessEntries(line.id, after, afterCalc)
  const beforeKeys = new Set(beforeEntries.map(entry => entry.key))
  const newExcess = afterEntries.filter(entry => !beforeKeys.has(entry.key))
  return { records: [...changed.values()], errors, newExcess, afterCalc }
}

export function isProgramRowClick(target: EventTarget | null) {
  return target instanceof Element && !target.closest('button,a,input,label,select,textarea,summary,[contenteditable="true"]') &&
    (typeof window === 'undefined' || !window.getSelection()?.toString())
}
