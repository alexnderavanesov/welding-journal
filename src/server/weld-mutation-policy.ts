import {
  CONTROL_BASIS_SUMMARY_FIELD_KEY,
  LNK_CONTROL_BASIS_FIELD_KEYS,
  PSTO_CONTROL_BASIS_FIELD_KEYS,
} from '@/lib/control-assignment-basis'
import {
  LNK_METHODS,
  LNK_REPORT_FIELD_KEYS,
} from '@/lib/report-config'
import {
  WELD_FIELDS,
  type WeldFieldKey,
} from '@/lib/weld-fields'
import { secondaryWeldFormFieldKeys } from '@/lib/weld-form-field-sets'
import type {
  WeldMutationScope,
  WeldPayload,
} from '@/server/weld-contracts'

export const SYSTEM_FIELD_KEYS = new Set([
  'id',
  'dispatcherTasks',
  'jsrDocument',
  'checklistDocument',
  'zniDocument',
  'rkExposureScheme',
  'pstoRequired',
  'pstoControlBasis',
  'pstoCancellationDate',
  'preHeatTreatmentLnkExempt',
  'preHeatTreatmentLnkEnabled',
  CONTROL_BASIS_SUMMARY_FIELD_KEY,
  'createdAt',
  'weldingUpdatedAt',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
  'updatedAt',
])

export const LNK_PROFILE_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_CONTROL_BASIS_FIELD_KEYS,
  ...LNK_METHODS.flatMap((method) => [
    method.enabledKey,
    method.requestKey,
    method.requestDateKey,
    method.resultKey,
    method.conclusionDateKey,
    method.conclusionKey,
    method.defectDescriptionKey,
  ]),
  ...[...LNK_REPORT_FIELD_KEYS].filter((fieldKey) =>
    fieldKey !== 'lnkCreatedAt' &&
    fieldKey !== 'lnkUpdatedAt' &&
    fieldKey !== 'tvmtBoq' &&
    fieldKey !== 'tvmtKs3'),
  'rkExposureConfirmedDiameter',
  'lnkNote',
  'officiality',
])

export const PSTO_PROFILE_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoCancellationDate',
  ...PSTO_CONTROL_BASIS_FIELD_KEYS,
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
  'hasTvmt',
  'tvmtControlBasis',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'tvmtBoq',
  'tvmtKs3',
])

const NON_WELDING_LNK_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_PROFILE_FIELD_KEYS,
  ...LNK_METHODS.map((method) => method.enabledKey),
])
for (const method of LNK_METHODS) NON_WELDING_LNK_FIELD_KEYS.delete(method.enabledKey)
for (const fieldKey of LNK_CONTROL_BASIS_FIELD_KEYS) NON_WELDING_LNK_FIELD_KEYS.delete(fieldKey)

const NON_WELDING_PSTO_FIELD_KEYS = new Set(PSTO_PROFILE_FIELD_KEYS)

// Work-code and closing fields are intentionally shared between the journal
// form and the specialized reports. A journal save must not silently drop them.
for (const fieldKey of secondaryWeldFormFieldKeys) {
  NON_WELDING_LNK_FIELD_KEYS.delete(fieldKey)
  NON_WELDING_PSTO_FIELD_KEYS.delete(fieldKey)
}

export const WELDING_PROFILE_FIELD_KEYS = WELD_FIELDS
  .map((field) => field.key)
  .filter((fieldKey): fieldKey is WeldFieldKey =>
    !SYSTEM_FIELD_KEYS.has(fieldKey) &&
    !NON_WELDING_LNK_FIELD_KEYS.has(fieldKey) &&
    !NON_WELDING_PSTO_FIELD_KEYS.has(fieldKey) &&
    fieldKey !== 'finalStatus')

export const WELD_MUTATION_FIELD_KEYS = {
  welding: WELDING_PROFILE_FIELD_KEYS,
  lnk: [...LNK_PROFILE_FIELD_KEYS].filter(
    (fieldKey) =>
      !LNK_METHODS.some((method) => method.enabledKey === fieldKey) &&
      !(new Set<WeldFieldKey>(LNK_CONTROL_BASIS_FIELD_KEYS)).has(fieldKey),
  ),
  psto: [...PSTO_PROFILE_FIELD_KEYS].filter(
    (fieldKey) =>
      fieldKey !== 'pstoRequired' &&
      fieldKey !== 'pstoControlBasis' &&
      fieldKey !== 'pstoCancellationDate' &&
      fieldKey !== 'hasTvmt' &&
      fieldKey !== 'tvmtControlBasis',
  ),
} as const satisfies Record<WeldMutationScope, readonly WeldFieldKey[]>

export function restrictWeldMutationRecord(
  record: WeldPayload,
  scope: WeldMutationScope,
): WeldPayload {
  const restricted: WeldPayload = { id: record.id }
  const restrictedValues = restricted as unknown as Record<string, unknown>
  const sourceValues = record as unknown as Record<string, unknown>
  for (const fieldKey of WELD_MUTATION_FIELD_KEYS[scope]) {
    if (Object.prototype.hasOwnProperty.call(record, fieldKey)) {
      restrictedValues[fieldKey] = sourceValues[fieldKey]
    }
  }
  if (record.pstoLineMoveDisposition) {
    restricted.pstoLineMoveDisposition = record.pstoLineMoveDisposition
  }
  if (record.weldChainLineMovePlan) {
    restricted.weldChainLineMovePlan = record.weldChainLineMovePlan
  }
  return restricted
}
