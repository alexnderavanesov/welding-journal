import {
  formatLongDate,
  formatPstoDiagramLongDate,
  formatPstoDiagramShortDateFromLong,
} from '@/lib/date-format'
import { LNK_METHODS } from '@/lib/report-config'
import { escapeRegExp } from '@/lib/string-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function formatPstoDiagramName(rows: WeldInput[], pstoDate: string) {
  const date = formatPstoDiagramLongDate(pstoDate) ?? formatLongDate(new Date())
  const prefix = `ПСТО-Д-${formatPstoDiagramShortDateFromLong(date)}-`
  const maxNumber = rows
    .map((row) => String(row.heatTreatmentDiagram ?? '').trim())
    .map((value) => value.match(new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`))?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}

export function formatLnkConclusionName(rows: WeldInput[], controlDate: string, methodKey: WeldFieldKey | '') {
  const date = formatLongDate(controlDate ? new Date(`${controlDate}T00:00:00`) : new Date())
  const method = methodKey ? LNK_METHODS.find((item) => item.requestKey === methodKey) : null
  const methodCode = method?.code ?? 'ЛНК'
  const prefix = `Заключение-${methodCode}-${date}-`
  const maxNumber = rows
    .flatMap((row) => LNK_METHODS.map((method) => String(row[method.conclusionKey] ?? '').trim()))
    .map((value) => value.match(new RegExp(`^(?:(?:Закл\\.|Заключение)-)?[^-]+-${escapeRegExp(date)}-(\\d{3})$`))?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}
