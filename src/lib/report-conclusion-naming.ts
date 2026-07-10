import {
  REQUEST_CONCLUSION_DEFAULT_SETTINGS,
  buildSystemNameFromPattern,
  getPstoConclusionDateParts,
  type RequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import { LNK_METHODS } from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function formatPstoDiagramName(
  rows: WeldInput[],
  pstoDate: string,
  settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS,
) {
  const dateParts = getPstoConclusionDateParts(pstoDate)
  return buildSystemNameFromPattern(
    settings.pstoConclusion.systemPattern,
    dateParts,
    rows.map((row) => String(row.heatTreatmentDiagram ?? '').trim()),
  )
}

export function formatLnkConclusionName(
  rows: WeldInput[],
  controlDate: string,
  methodKey: WeldFieldKey | '',
  settings: RequestConclusionSettings = REQUEST_CONCLUSION_DEFAULT_SETTINGS,
) {
  const date = controlDate ? new Date(`${controlDate}T00:00:00`) : new Date()
  const method = methodKey ? LNK_METHODS.find((item) => item.requestKey === methodKey) : null
  const methodCode = method?.code ?? 'ЛНК'

  return buildSystemNameFromPattern(
    settings.lnkConclusion.systemPattern,
    { date, methodCode },
    rows.flatMap((row) => LNK_METHODS.map((method) => String(row[method.conclusionKey] ?? '').trim())),
  )
}
