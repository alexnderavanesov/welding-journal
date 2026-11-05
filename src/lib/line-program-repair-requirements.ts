import type { WeldRow, LineConsistencyTask } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { programJointIdentity } from './line-program-topology'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'
import { isActiveOfficialWeld } from './control-assignment-eligibility'
import { isUnofficialJoint } from './joint-display'

export const REPAIR_CONTROL_FIELDS = { ВИК: 'hasVik', ПВК: 'hasPvk', РК: 'hasRk', УЗК: 'hasUzk' } as const
export type RepairControlMethod = keyof typeof REPAIR_CONTROL_FIELDS
export type RepairControlRequirement = { method: RepairControlMethod; sourceRowId: number; sourceJoint: string; reason: string;
  assignment?: 'да' | 'дополнительный' | 'отменен' }
const labels = { да: 'Да', дополнительный: 'Дополнительный', отменен: 'Отменен' } as const

/** Assignments follow the saved immediate parent within the same line.
 * Iteration is over the short physical branch, never over the whole journal per row.
 */
export function buildProgramRepairRequirements(
  input: readonly WeldRow[],
  _approved: ReadonlySet<string> = new Set(),
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const rows = [...new Map(input.map(row => [row.id, row])).values()].sort((a, b) => a.id - b.id)
  const states = captureProgramChainStates(rows, settings)
  const byId = new Map(rows.map(row => [row.id, row]))
  const result = new Map<number, RepairControlRequirement[]>()
  for (const row of rows) {
    const state = states.get(row.id)!
    if (state.kind !== 'repair') continue
    const required = new Map<RepairControlMethod, RepairControlRequirement>()
    const add = (method: RepairControlMethod, source: WeldRow, reason: string, assignment: RepairControlRequirement['assignment'] = 'да') => {
      if (!required.has(method)) required.set(method, { method, sourceRowId: source.id, sourceJoint: String(source.joint ?? ''), reason, assignment })
    }
    add('ВИК', row, 'ВИК обязателен как первый метод НК продолжения')
    // Only the saved immediate parent defines inheritance. An unofficial parent
    // releases it; older failures/approvals must not reintroduce that obligation.
    const source = state.sourceRowId == null ? undefined : byId.get(state.sourceRowId)
    if (source && source.id !== row.id && !isUnofficialJoint(source) &&
      programJointIdentity(source, '') === programJointIdentity(row, '')) {
      for (const method of ['ПВК', 'РК', 'УЗК'] as const) {
        const assignment = normalizeControlAvailabilityStorageText(source[REPAIR_CONTROL_FIELDS[method]])
        if (assignment === 'да' || assignment === 'дополнительный' || assignment === 'отменен') {
          add(method, source, `${method} = «${labels[assignment]}» унаследован от официального предшественника ${source.joint ?? source.id}; состояние назначения необходимо сохранить`, assignment)
        }
      }
    }
    result.set(row.id, [...required.values()])
  }
  return result
}

export function satisfiesProgramRepairRequirement(row: Partial<WeldRow>, requirement: RepairControlRequirement) {
  const value = normalizeControlAvailabilityStorageText(row[REPAIR_CONTROL_FIELDS[requirement.method]])
  return requirement.assignment ? value === requirement.assignment : value === 'да' || value === 'дополнительный'
}

export function attachProgramRepairRequirements(rows: readonly WeldRow[], approved: ReadonlySet<string>, settings?: SystemIndexSettings): WeldRow[] {
  const states = captureProgramChainStates(rows, settings)
  const contextual = rows.map(row => ({ ...row, programChainState: states.get(row.id) }))
  const requirements = buildProgramRepairRequirements(contextual, approved, settings)
  return contextual.map(row => ({ ...row, programRepairRequirements: requirements.get(row.id) ?? [] }))
}

/** Existing incomplete repairs can be fixed incrementally; unrelated legacy edits stay
 * available. A new repair or changed assignment must satisfy its applicable obligation.
 */
export function getProgramRepairAssignmentIssues(row: Partial<WeldRow>, previous?: Partial<WeldRow>) {
  if (!isActiveOfficialWeld(row)) return []
  return (row.programRepairRequirements ?? []).flatMap(requirement => {
    const field = REPAIR_CONTROL_FIELDS[requirement.method]
    const value = normalizeControlAvailabilityStorageText(row[field])
    if (satisfiesProgramRepairRequirement(row, requirement)) return []
    if (previous && value === normalizeControlAvailabilityStorageText(previous[field])) return []
    return [{ fieldKeys: [field], message: `${requirement.reason}. ${requirement.assignment ? `Установите «${labels[requirement.assignment]}»; изменить или снять унаследованное назначение нельзя.` : `Назначьте ${requirement.method}; снять или отменить обязательный метод нельзя.`}` }]
  })
}

export function buildProgramRepairTasks(rows: readonly WeldRow[], approved: ReadonlySet<string>, settings?: SystemIndexSettings): LineConsistencyTask[] {
  const requirements = buildProgramRepairRequirements(rows, approved, settings)
  return rows.flatMap(row => {
    if (!isActiveOfficialWeld(row)) return []
    const missing = (requirements.get(row.id) ?? []).filter(item => !satisfiesProgramRepairRequirement(row, item))
    if (!missing.length) return []
    return [{ kind: 'line-consistency', key: `program-repair:${row.id}:${missing.map(item => item.method).join(',')}`,
      row, line: String(row.line ?? ''), projectTitle: String(row.projectTitle ?? ''), subtitleCode: String(row.subtitleCode ?? ''),
      fieldKey: 'controlPresence', systemWarningCode: 'СП-08', fieldLabel: 'Обязательные назначения ремонта',
      title: 'Восстановить обязательные назначения ремонта', values: missing.map(item => item.method),
      details: `${missing.map(item => item.reason).join('. ')}. Откройте назначения этого стыка в программе линии.` }]
  })
}
