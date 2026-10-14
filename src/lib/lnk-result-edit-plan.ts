import type { WeldRow } from './dispatcher-types'
import type { WeldFieldKey } from './weld-fields'
import { getLnkMethodByRequestKey } from './lnk-status'
import { getManagedLnkResultChangeKey } from './lnk-result-draft'

export type LnkResultEditChange = {
  key: string
  rowId: number
  joint: string
  line: string
  subtitleCode?: string
  method: string
  from: string
  to: string | null
  project?: string
  detail?: string
}

export type PreHeatTreatmentResultEditDraft = {
  result: string
  conclusionName: string
  conclusionDate: string
}

export type LnkResultEditUpdate = { record: WeldRow; methodKey: WeldFieldKey; result: string | null }

export function describeLnkResultEdits(updates: readonly LnkResultEditUpdate[]): LnkResultEditChange[] {
  return updates.map(({ record, methodKey, result }) => {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) throw new Error('Выберите метод контроля')
    return {
      key: getManagedLnkResultChangeKey(record.id, methodKey), rowId: record.id,
      joint: String(record.joint ?? record.id), line: String(record.line ?? ''),
      project: String(record.projectTitle ?? ''), subtitleCode: String(record.subtitleCode ?? ''), method: method.code,
      from: String(record[method.resultKey] ?? ''), to: result,
    }
  })
}
