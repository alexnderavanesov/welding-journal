import { formatPstoDiagramDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPstoResultValue } from '@/lib/report-import'
import { hasText, isCancelledControlValue, isYesText } from '@/lib/report-value-utils'
import { escapeRegExp } from '@/lib/string-utils'
import type { WeldInput } from '@/lib/weld-fields'
import {
  getPrimaryPstoStartBlockReason,
  getRejectedPreHeatTreatmentControls,
} from '@/lib/lnk-control-stage'
import {
  canCreateRepeatPstoCycle,
  getCurrentPstoCycle,
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
} from '@/lib/tvmt-cycle'

export function getPstoRequestBlockReason(row: WeldInput) {
  if (!isYesText(row.pstoRequired)) return 'ПСТО не назначена.'
  if (getRejectedPreHeatTreatmentControls(row).length > 0) {
    return getPrimaryPstoStartBlockReason(row)
  }
  const requestName = String(row.pstoRequest ?? '').trim()
  if (requestName) return `Заявка ПСТО уже создана: ${requestName}.`
  return getPrimaryPstoStartBlockReason(row)
}

export function canCreatePstoRequest(row: WeldInput) {
  return !getPstoRequestBlockReason(row)
}

export function getPstoWorkflowRequestBlockReason(row: WeldInput) {
  if (getRejectedPreHeatTreatmentControls(row).length > 0) {
    return getPrimaryPstoStartBlockReason(row)
  }
  if (canCreatePstoRequest(row) || canCreateRepeatPstoCycle(row)) return ''

  const state = getPstoTvmtWorkflowState(row)
  if (state === 'complete' && isCancelledControlValue(row.pstoRequired)) {
    return 'ПСТО по линии отменена; новые циклы недоступны.'
  }
  if (state === 'waiting-psto-request') return getPstoRequestBlockReason(row)
  if (state === 'not-required') {
    return isCancelledControlValue(row.pstoRequired)
      ? 'ПСТО по линии отменена.'
      : 'ПСТО по линии не назначена.'
  }

  const cycle = getCurrentPstoCycle(row)
  if (state === 'waiting-psto' && cycle?.pstoRequest) {
    return `Заявка ПСТО для цикла ${cycle.sequence} уже создана: ${cycle.pstoRequest}.`
  }
  if (state === 'repeat-psto-required') return 'Повторный цикл ПСТО пока недоступен.'
  return `Цикл ${cycle?.sequence ?? 1}: ${getPstoTvmtWorkflowLabel(state)}.`
}

export function canCreatePstoWorkflowRequest(row: WeldInput) {
  return !getPstoWorkflowRequestBlockReason(row)
}

export function getPstoWorkflowResultBlockReason(row: WeldInput) {
  if (getRejectedPreHeatTreatmentControls(row).length > 0) {
    return getPrimaryPstoStartBlockReason(row)
  }
  const state = getPstoTvmtWorkflowState(row)
  if (state === 'waiting-psto') return ''
  if (state === 'waiting-psto-request') {
    return getPstoRequestBlockReason(row) || 'Сначала создайте заявку ПСТО.'
  }
  if (state === 'not-required') {
    return isCancelledControlValue(row.pstoRequired)
      ? 'ПСТО по линии отменена.'
      : 'ПСТО по линии не назначена.'
  }

  const cycle = getCurrentPstoCycle(row)
  if (cycle?.pstoResult) return `Результат ПСТО для цикла ${cycle.sequence} уже внесен.`
  return `Цикл ${cycle?.sequence ?? 1}: ${getPstoTvmtWorkflowLabel(state)}.`
}

export function canAddPstoWorkflowResult(row: WeldInput) {
  return !getPstoWorkflowResultBlockReason(row)
}

export function buildPstoWaitingRequestRows(rows: WeldRow[]) {
  return rows
    .filter(canCreatePstoRequest)
    .map((row) => ({
      projectTitle: row.projectTitle ?? '',
      subtitleCode: row.subtitleCode ?? '',
      line: row.line ?? '',
      spool: row.spool ?? '',
      joint: row.joint ?? '',
      wdi: row.wdi ?? '',
      weldDate: row.weldDate ?? '',
      status: 'ожидает заявку ПСТО',
    }))
}

export function buildPstoResultsRows(rows: WeldRow[]) {
  return rows
    .filter((row) => hasText(row.pstoResult) || hasText(row.pstoDate) || hasText(row.heatTreatmentDiagram))
    .map((row) => ({
      projectTitle: row.projectTitle ?? '',
      subtitleCode: row.subtitleCode ?? '',
      line: row.line ?? '',
      spool: row.spool ?? '',
      joint: row.joint ?? '',
      wdi: row.wdi ?? '',
      weldDate: row.weldDate ?? '',
      pstoRequest: row.pstoRequest ?? '',
      pstoDate: row.pstoDate ?? '',
      heatTreatmentDiagram: row.heatTreatmentDiagram ?? '',
    }))
}

export function withAutoHeatTreatmentDiagram<T extends WeldRow>(record: T, rows: WeldRow[]) {
  if (getPstoResultValue(record.pstoResult) !== 'проведено') {
    return { ...record, heatTreatmentDiagram: null }
  }

  const date = formatPstoDiagramDate(record.pstoDate)
  if (!date) return record

  const prefix = `ПСТО-Д-${date}-`
  const currentDiagram = String(record.heatTreatmentDiagram ?? '').trim()
  if (currentDiagram) return record
  const diagramPattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`)

  const maxNumber = rows
    .filter((row) => row.id !== record.id)
    .map((row) => String(row.heatTreatmentDiagram ?? '').trim().match(diagramPattern)?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  const nextNumber = maxNumber + 1

  return { ...record, heatTreatmentDiagram: `${prefix}${String(nextNumber).padStart(3, '0')}` }
}

export function normalizePstoRequest(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

export function normalizeRowPstoRequest<T extends WeldInput>(row: T) {
  const pstoRequest = normalizePstoRequest(row.pstoRequest)
  return row.pstoRequest === pstoRequest ? row : { ...row, pstoRequest }
}

export function withAutoHeatTreatmentDiagrams<T extends WeldRow>(rows: T[]) {
  const nextRows = [...rows]
  for (let index = 0; index < nextRows.length; index += 1) {
    nextRows[index] = withAutoHeatTreatmentDiagram(nextRows[index], nextRows) as T
  }
  return nextRows
}
