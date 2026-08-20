import type { WeldFieldKey, WeldInput } from '@/lib/weld-field-definitions'

export type ControlBasisScope = 'all' | 'lnk' | 'psto'
type ControlAssignmentBasisField = (typeof CONTROL_ASSIGNMENT_BASIS_FIELDS)[number]

export const CONTROL_BASIS_SUMMARY_FIELD_KEY = 'controlBasisSummary' as const satisfies WeldFieldKey

export const CONTROL_ASSIGNMENT_BASIS_FIELDS = [
  { code: 'ВИК', assignmentKey: 'hasVik', basisKey: 'vikControlBasis', scope: 'lnk' },
  { code: 'РК', assignmentKey: 'hasRk', basisKey: 'rkControlBasis', scope: 'lnk' },
  { code: 'УЗК', assignmentKey: 'hasUzk', basisKey: 'uzkControlBasis', scope: 'lnk' },
  { code: 'ПВК', assignmentKey: 'hasPvk', basisKey: 'pvkControlBasis', scope: 'lnk' },
  { code: 'ТВМТ', assignmentKey: 'hasTvmt', basisKey: 'tvmtControlBasis', scope: 'lnk' },
  { code: 'РФА', assignmentKey: 'hasRfa', basisKey: 'rfaControlBasis', scope: 'lnk' },
  { code: 'СТЛС', assignmentKey: 'hasStls', basisKey: 'stlsControlBasis', scope: 'lnk' },
  { code: 'МКК', assignmentKey: 'hasMkk', basisKey: 'mkkControlBasis', scope: 'lnk' },
  { code: 'ПСТО', assignmentKey: 'pstoRequired', basisKey: 'pstoControlBasis', scope: 'psto' },
] as const satisfies readonly {
  code: string
  assignmentKey: WeldFieldKey
  basisKey: WeldFieldKey
  scope: Exclude<ControlBasisScope, 'all'>
}[]

export const CONTROL_BASIS_FIELD_KEYS = CONTROL_ASSIGNMENT_BASIS_FIELDS.map((field) => field.basisKey)
export const LNK_CONTROL_BASIS_FIELD_KEYS = CONTROL_ASSIGNMENT_BASIS_FIELDS
  .filter((field) => field.scope === 'lnk')
  .map((field) => field.basisKey)
export const PSTO_CONTROL_BASIS_FIELD_KEYS = CONTROL_ASSIGNMENT_BASIS_FIELDS
  .filter((field) => field.scope === 'psto')
  .map((field) => field.basisKey)

const CONTROL_BASIS_BY_ASSIGNMENT_KEY: ReadonlyMap<WeldFieldKey, ControlAssignmentBasisField> = new Map(
  CONTROL_ASSIGNMENT_BASIS_FIELDS.map((field) => [field.assignmentKey, field]),
)

export function getControlBasisFieldByAssignmentKey(assignmentKey: WeldFieldKey) {
  return CONTROL_BASIS_BY_ASSIGNMENT_KEY.get(assignmentKey)
}

export function formatControlBasisSummary(record: WeldInput, scope: ControlBasisScope = 'all') {
  return CONTROL_ASSIGNMENT_BASIS_FIELDS
    .filter((field) => scope === 'all' || field.scope === scope)
    .map((field) => {
      const value = String(record[field.basisKey] ?? '').trim()
      return value ? `${field.code}: ${value}` : ''
    })
    .filter(Boolean)
    .join('; ')
}

export function withControlBasisSummary<T extends WeldInput>(record: T, scope: ControlBasisScope = 'all'): T {
  return {
    ...record,
    [CONTROL_BASIS_SUMMARY_FIELD_KEY]: formatControlBasisSummary(record, scope),
  }
}
