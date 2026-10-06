import type { WeldInput } from './weld-fields'
import type { WeldRow } from './dispatcher-types'
import type { LineProgramRecord } from './line-program'
import { getLineProgramIdentityKey } from './line-program'
import { summarizeLineProgram } from './line-program-overview'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from './report-common-config'
import { attachProgramRepairRequirements } from './line-program-repair-requirements'

const keys = ['id', 'projectTitle', 'subtitleCode', 'line', 'joint', 'connectionType', 'weldDate', 'officiality', 'revisionActuality', 'hasRk', 'hasUzk', 'hasPvk', ...OFFICIAL_WELDER_STAMP_FIELD_KEYS] as const
/** Only editable calculation inputs; never use draft results/history in a preview. */
export function getProgramImpactInput(draft: WeldInput): WeldInput {
  const input: WeldInput = {}
  for (const key of keys) if (draft[key] !== undefined) Object.assign(input, { [key]: draft[key] })
  if (draft.layeredControlRequest?.assigned) input.layeredControlRequest = { assigned: true, confirmPvk: true }
  return input
}
export function calculateProgramCardImpact(rows: readonly WeldRow[], draft: WeldInput, line: LineProgramRecord, accepted: ReadonlySet<string> = new Set()) {
  const previous = rows.find(row => row.id === draft.id)
  if (!previous || getLineProgramIdentityKey(draft) !== getLineProgramIdentityKey(line)) throw new Error('Стык перенесён или линия изменена. Влияние переноса проверяется отдельно при сохранении.')
  if (line.configurationIssue || line.weldControlPercent == null || line.pvkControlPercent == null) throw new Error('Сначала настройте требования в программе линии.')
  const next = { ...previous, ...getProgramImpactInput(draft), ...(draft.layeredControlRequest?.assigned ? { layeredControlAssigned: true, hasPvk: 'да' } : {}) } as WeldRow
  const count = (values: readonly WeldRow[]) => {
    const o = summarizeLineProgram(attachProgramRepairRequirements(values, accepted), line, accepted)
    return { missing: o.common!.missing + o.pvk!.missing, excess: o.common!.excess + o.pvk!.excess }
  }
  return { before: count(rows), after: count(rows.map(row => row.id === next.id ? next : row)) }
}
