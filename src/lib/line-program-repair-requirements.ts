import type { WeldRow, LineConsistencyTask } from './dispatcher-types'
import { captureProgramChainStates } from './line-program-chain-state'
import { programJointIdentity } from './line-program-topology'
import { programApprovalKey } from './program-control-approval'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import { normalizeResultStatus } from './weld-status'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'
import { isPreHeatTreatmentStageEnabled } from './pre-heat-treatment-policy'
import { isActiveOfficialWeld } from './control-assignment-eligibility'

export const REPAIR_CONTROL_FIELDS = { ВИК: 'hasVik', ПВК: 'hasPvk', РК: 'hasRk', УЗК: 'hasUzk' } as const
export type RepairControlMethod = keyof typeof REPAIR_CONTROL_FIELDS
export type RepairControlRequirement = { method: RepairControlMethod; sourceRowId: number; sourceJoint: string; reason: string }
const results = { ВИК: 'vikResult', ПВК: 'pvkResult', РК: 'rkResult', УЗК: 'uzkResult' } as const
const failed = (value: unknown) => ['ремонт', 'вырез'].includes(normalizeResultStatus(value) ?? '')

/** Component-wise ancestry, scoped to a line. A sibling W branch is not an R ancestor.
 * Iteration is over the short physical branch, never over the whole journal per row.
 */
export function buildProgramRepairRequirements(
  input: readonly WeldRow[],
  approved: ReadonlySet<string> = new Set(),
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
    const add = (method: RepairControlMethod, source: WeldRow, reason: string) => {
      if (!required.has(method)) required.set(method, { method, sourceRowId: source.id, sourceJoint: String(source.joint ?? ''), reason })
    }
    add('ВИК', row, 'ВИК обязателен как первый метод НК продолжения')
    const ancestorIds = new Set<number>()
    let sourceId = state.sourceRowId
    while (sourceId != null && sourceId !== row.id && !ancestorIds.has(sourceId)) {
      ancestorIds.add(sourceId)
      // A coil starts a new physical connection. Its own history is inherited,
      // but the removed connection's obligations must not reappear on its repair.
      if (sourceId === state.physicalRootId || states.get(sourceId)?.kind === 'coil') break
      sourceId = states.get(sourceId)?.sourceRowId ?? null
    }
    if (state.physicalRootId != null && state.physicalRootId !== row.id) ancestorIds.add(state.physicalRootId)
    for (const id of ancestorIds) {
      const source = byId.get(id)
      if (!source || programJointIdentity(source, '') !== programJointIdentity(row, '')) continue
      for (const method of Object.keys(results) as RepairControlMethod[]) {
        const pre = isPreHeatTreatmentStageEnabled(source) ? source.preHeatTreatmentControls ?? [] : []
        const failedMethod = failed(source[results[method]]) || pre.some(control => control.method === method && failed(control.result)) ||
          (source.duplicateControls ?? []).some(control => control.method === method && failed(control.result))
        if (failedMethod) add(method, source, `Обязателен после негодного ${method} на ${source.joint ?? source.id}`)
      }
      const pvkPerformed = normalizeResultStatus(source.pvkResult) === 'годен' ||
        (isPreHeatTreatmentStageEnabled(source) && (source.preHeatTreatmentControls ?? []).some(control => control.method === 'ПВК' && normalizeResultStatus(control.result) === 'годен'))
      if (pvkPerformed) add('ПВК', source, `ПВК обязателен по выполненному контролю предшественника ${source.joint ?? source.id}`)
      if (approved.has(programApprovalKey(source, 'common', true)) &&
        ['да', 'дополнительный'].includes(normalizeControlAvailabilityStorageText(source.hasRk) ?? '') &&
        ['да', 'дополнительный'].includes(normalizeControlAvailabilityStorageText(source.hasUzk) ?? '')) {
        for (const method of ['РК', 'УЗК'] as const) add(method, source, `Обязателен по согласованию РК + УЗК на ${source.joint ?? source.id}`)
      }
    }
    result.set(row.id, [...required.values()])
  }
  return result
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
    if (value === 'да' || value === 'дополнительный') return []
    if (previous && value === normalizeControlAvailabilityStorageText(previous[field])) return []
    return [{ fieldKeys: [field], message: `${requirement.reason}. Назначьте ${requirement.method}; снять или отменить обязательный метод нельзя.` }]
  })
}

export function buildProgramRepairTasks(rows: readonly WeldRow[], approved: ReadonlySet<string>, settings?: SystemIndexSettings): LineConsistencyTask[] {
  const requirements = buildProgramRepairRequirements(rows, approved, settings)
  return rows.flatMap(row => {
    if (!isActiveOfficialWeld(row)) return []
    const missing = (requirements.get(row.id) ?? []).filter(item => !['да', 'дополнительный'].includes(normalizeControlAvailabilityStorageText(row[REPAIR_CONTROL_FIELDS[item.method]]) ?? ''))
    if (!missing.length) return []
    return [{ kind: 'line-consistency', key: `program-repair:${row.id}:${missing.map(item => item.method).join(',')}`,
      row, line: String(row.line ?? ''), projectTitle: String(row.projectTitle ?? ''), subtitleCode: String(row.subtitleCode ?? ''),
      fieldKey: 'controlPresence', systemWarningCode: 'СП-03', fieldLabel: 'Обязательные методы ремонта',
      title: 'Назначить обязательный контроль ремонта', values: missing.map(item => item.method),
      details: `${missing.map(item => item.reason).join('. ')}. Откройте назначения этого стыка в программе линии.` }]
  })
}
