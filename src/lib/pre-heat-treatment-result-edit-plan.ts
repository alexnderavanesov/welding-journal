import type { WeldRow } from './dispatcher-types'
import type { PreHeatTreatmentControlRecord } from './lnk-control-stage'
import {
  buildPreHeatTreatmentResultCorrectionWrite,
  getPreHeatTreatmentResultRemovalBlockReason,
  type PreHeatTreatmentControlWrite,
} from './pre-heat-treatment-control-updates'
import { assertUnofficialLastRejectionRetained } from './unofficial-lnk-result-guard'
import { assertNoNewLnkChronologyIssues } from './lnk-chronology-checks'
import { loadSaveCheckSettings, type SaveCheckSettings } from './save-check-settings'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import type { RkExposureTableSettings } from './other-settings'

export type PreHeatTreatmentResultEdit = {
  rowId: number
  relationId: number
  expectedVersion: string
  result: string | null
}

export type PreHeatTreatmentResultEditBatch = {
  changes: PreHeatTreatmentResultEdit[]
  specialistCorrectionConfirmation?: string
}

export function normalizePreHeatTreatmentResultEditBatch(value: PreHeatTreatmentResultEditBatch): PreHeatTreatmentResultEditBatch {
  if (!Array.isArray(value?.changes) || value.changes.length === 0) throw new Error('Нет изменений результатов НК до ТО.')
  if (value.changes.length > 20_000) throw new Error('За один раз можно изменить не более 20000 позиций НК до ТО.')
  const ids = new Set<number>()
  const versions = new Map<number, string>()
  const changes = value.changes.map(change => {
    const rowId = Number(change?.rowId), relationId = Number(change?.relationId)
    const expectedVersion = String(change?.expectedVersion ?? '').trim()
    if (!Number.isSafeInteger(rowId) || rowId <= 0 || !Number.isSafeInteger(relationId) || relationId <= 0 || !expectedVersion) {
      throw new Error('Исходная версия результата НК до ТО недоступна. Обновите отчет.')
    }
    if (ids.has(relationId)) throw new Error('Позиция НК до ТО повторяется в изменениях.')
    ids.add(relationId)
    if (versions.has(rowId) && versions.get(rowId) !== expectedVersion) throw new Error('Изменения одного стыка имеют разные исходные версии.')
    versions.set(rowId, expectedVersion)
    if (versions.size > 5_000) throw new Error('За один раз можно изменить не более 5000 стыков.')
    const result = change.result === null ? null : String(change.result ?? '').trim().toLowerCase()
    if (result !== null && !['годен', 'ремонт', 'вырез'].includes(result)) throw new Error('Выберите результат НК до ТО.')
    return { rowId, relationId, expectedVersion, result }
  })
  return { changes, ...(typeof value.specialistCorrectionConfirmation === 'string'
    ? { specialistCorrectionConfirmation: value.specialistCorrectionConfirmation } : {}) }
}

/** Builds the whole final state before any write. Requisites are dedicated edits:
 * a result-only batch cannot smuggle an unsaved name or date into its payload. */
export function buildPreHeatTreatmentResultEditWrites({ rows, changes, saveCheckSettings = loadSaveCheckSettings(),
  systemIndexSettings = loadSystemIndexSettings(), rkExposureTable = null,
}: {
  rows: WeldRow[]
  changes: PreHeatTreatmentResultEdit[]
  saveCheckSettings?: SaveCheckSettings
  systemIndexSettings?: SystemIndexSettings
  rkExposureTable?: RkExposureTableSettings | null
}) {
  const rowsById = new Map(rows.map(row => [row.id, row]))
  const writes: PreHeatTreatmentControlWrite[] = []
  for (const change of changes) {
    const row = rowsById.get(change.rowId)
    const control = row?.preHeatTreatmentControls?.find(control => control.id === change.relationId)
    if (!row || !control) throw new Error('Позиция НК до ТО больше не существует. Ничего не сохранено.')
    if (change.result === null) {
      const reason = getPreHeatTreatmentResultRemovalBlockReason(row, control, saveCheckSettings)
      if (reason) throw new Error(reason)
      writes.push({ ...control, result: control.requestName ? 'ожидает НК' : null,
        conclusionDate: null, conclusionName: null, defectDescription: null, rkExposureConfirmedDiameter: null })
    } else {
      writes.push(buildPreHeatTreatmentResultCorrectionWrite({ row, control, result: change.result,
        conclusionName: String(control.conclusionName ?? ''), controlDate: String(control.conclusionDate ?? ''),
        saveCheckSettings, systemIndexSettings, rkExposureTable }))
    }
  }
  const writesById = new Map(writes.map(write => [write.id, write]))
  const finalRows = rows.map(row => ({ ...row, preHeatTreatmentControls: row.preHeatTreatmentControls?.map(control =>
    ({ ...control, ...writesById.get(control.id) } as PreHeatTreatmentControlRecord)) }))
  for (const row of finalRows) assertUnofficialLastRejectionRetained(row, rowsById.get(row.id)!)
  assertNoNewLnkChronologyIssues(finalRows, rows, saveCheckSettings)
  return { writes, finalRows }
}
