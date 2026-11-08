import type { WeldRow } from './dispatcher-types'
import { ALL_LNK_FIELD_METHODS } from './lnk-report-config'
import { hasText, isPendingLnkResultValue } from './report-value-utils'
import type { WeldFieldKey } from './weld-fields'

/** One pending position, independent of other methods/stages on the same weld. */
export type PendingActualityRequest = {
  rowId: number
  method: string
  stage: 'primary' | 'beforeHeatTreatment' | 'repeat'
  relationId: number
  sequence: number
  name: string
  date: string
}

// Preserve partial/legacy facts too. An unrecognised non-waiting result must
// never turn into permission to remove its request and historical document.
const text = (value: unknown) => String(value ?? '').trim()
const performed = (method: string, result: unknown, facts: unknown[]) => {
  const normalized = text(result).toLowerCase()
  const pending = isPendingLnkResultValue(result) ||
    method === 'ПСТО' && normalized === 'ожидает псто' ||
    method === 'ТВМТ' && normalized === 'ожидает твмт'
  return hasText(result) && !pending || facts.some(hasText)
}

export function getPendingActualityRequests(rows: readonly WeldRow[]): PendingActualityRequest[] {
  const pending: PendingActualityRequest[] = []
  for (const row of rows) {
    const add = (method: string, stage: PendingActualityRequest['stage'], relationId: number, sequence: number,
      name: unknown, date: unknown, result: unknown, facts: unknown[]) => {
      if ((hasText(name) || hasText(date)) && !performed(method, result, facts)) {
        pending.push({ rowId: row.id, method, stage, relationId, sequence, name: text(name), date: text(date) })
      }
    }
    for (const method of ALL_LNK_FIELD_METHODS) {
      add(method.code, 'primary', row.id, 1, row[method.requestKey], row[method.requestDateKey], row[method.resultKey],
        [row[method.conclusionKey], row[method.conclusionDateKey], ...(method.defectDescriptionKey ? [row[method.defectDescriptionKey]] : []),
          ...(method.code === 'РК' ? [row.rkExposureConfirmedDiameter] : [])])
    }
    add('ПСТО', 'primary', row.id, 1, row.pstoRequest, row.pstoRequestDate, row.pstoResult, [row.pstoDate, row.heatTreatmentDiagram])
    for (const control of row.preHeatTreatmentControls ?? []) {
      add(control.method, 'beforeHeatTreatment', control.id, 1, control.requestName, control.requestDate, control.result,
        [control.conclusionName, control.conclusionDate, control.defectDescription, control.rkExposureConfirmedDiameter])
    }
    for (const cycle of row.pstoRepeatCycles ?? []) {
      add('ПСТО', 'repeat', cycle.id, cycle.sequence, cycle.pstoRequest, cycle.pstoRequestDate, cycle.pstoResult, [cycle.pstoDate, cycle.heatTreatmentDiagram])
      add('ТВМТ', 'repeat', cycle.id, cycle.sequence, cycle.tvmtRequest, cycle.tvmtRequestDate, cycle.tvmtResult, [cycle.tvmtConclusion, cycle.tvmtConclusionDate])
    }
  }
  return pending
}

export function pendingActualityRequestKey(position: Pick<PendingActualityRequest, 'rowId' | 'method' | 'stage' | 'relationId' | 'sequence'>) {
  return JSON.stringify([position.rowId, position.method, position.stage, position.relationId])
}

export function primaryActualityRequestFields(methodCode: string): WeldFieldKey[] {
  if (methodCode === 'ПСТО') return ['pstoRequest', 'pstoRequestDate', 'pstoResult']
  const method = ALL_LNK_FIELD_METHODS.find(method => method.code === methodCode)
  if (!method) throw new Error('Неизвестный метод заявки.')
  return [method.requestKey, method.requestDateKey, method.resultKey]
}
