import type { JournalRevision } from './journal-server-grid'
import type { WeldReportKind } from '@/server/weld-contracts'
import { formatDisplayDate } from './date-format'
import { FIELD_BY_KEY, type WeldFieldKey } from './weld-fields'
import { journalFilterValueLabel } from './welding-journal-grid-state'
import type { WeldColumnFilterOption } from '@/server/weld-contracts'
export type JournalFilterRequest = { report?: WeldReportKind; fieldKey: WeldFieldKey; columnFilters?: Record<string, string>; search?: string; match?: string; start?: number; revision?: JournalRevision }
export type JournalFilterPage = { options: WeldColumnFilterOption[]; total: number; next?: number; revision: JournalRevision }
// Keep remote search identical to the displayed/raw-value search, including
// rounded numeric labels, decimal dots and the existing date representation.
export function journalFilterSearchText(fieldKey: WeldFieldKey, option: WeldColumnFilterOption) {
  const display = journalFilterValueLabel(fieldKey, option.label)
  const date = FIELD_BY_KEY.get(fieldKey)?.kind === 'date' ? formatDisplayDate(option.label) : ''
  return `${option.label} ${option.value} ${display} ${display.replace(',', '.')} ${date}`.toLocaleLowerCase('ru')
}
