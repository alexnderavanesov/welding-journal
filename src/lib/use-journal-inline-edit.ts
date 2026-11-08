import { useRef, useState, type ClipboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CellEditRequestEvent, GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey } from './weld-fields'
import type { JournalRangeRequest } from './journal-server-grid'
import { JOURNAL_INLINE_FIELDS, normalizeJournalCellEdits, parseJournalClipboard, type JournalCellEdit } from './journal-inline-edit'
import { pasteJournalCells, saveJournalCellEdits } from '@/server/journal-inline-edit-api'
import { scheduleWeldDataRefresh } from './weld-query-utils'
import { useStableEventCallback } from './use-stable-event-callback'

export function useJournalInlineEdit(options: {
  api: GridApi<WeldRow> | null; enabled: boolean; availability: 'ready' | 'updating' | 'expired' | 'load-error'
  canEditCell: (row: WeldRow, field: WeldFieldKey) => boolean
  canEditField: (field: WeldFieldKey) => boolean
  getEditRange: (range: { first: number; last: number; columns: WeldFieldKey[] }) => JournalRangeRequest | null
  onError?: (message: string) => void
}) {
  const client = useQueryClient()
  const active = useRef(false)
  const [status, setStatus] = useState<{ message: string; error?: boolean; details?: string }>({ message: '' })
  const canEdit = useStableEventCallback((row: WeldRow | undefined, field: WeldFieldKey) =>
    Boolean(row && options.enabled && options.availability === 'ready' && !active.current && JOURNAL_INLINE_FIELDS.has(field) && options.canEditCell(row, field)))
  const fail = (error: unknown, context: string) => {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить. Обновите журнал и проверьте значения.'
    const details = `${context}. ${message}`
    setStatus({ message: `${context}: не сохранено`, error: true, details }); options.onError?.(details)
  }
  const save = async (action: () => Promise<{ count: number }>, context: string) => {
    if (active.current) throw new Error('Дождитесь завершения предыдущего сохранения.')
    active.current = true; setStatus({ message: 'Сохраняем ячейки…' })
    try {
      const result = await action()
      scheduleWeldDataRefresh(client)
      setStatus({ message: `Сохранено стыков: ${result.count}` })
    } catch (error) { fail(error, context) }
    finally { active.current = false }
  }
  const edit = useStableEventCallback((event: CellEditRequestEvent<WeldRow>) => {
    const field = event.column.getColId() as WeldFieldKey
    if (!canEdit(event.data, field) || String(event.oldValue ?? '') === String(event.newValue ?? '')) return
    const context = `Стык ${event.data.joint || event.data.id}, линия ${event.data.line || '—'}, поле «${FIELD_BY_KEY.get(field)?.label ?? field}»`
    const edits: JournalCellEdit[] = [{ id: event.data.id, version: event.data.rowVersion ?? '', values: { [field]: event.newValue ?? null } }]
    try { normalizeJournalCellEdits(edits) } catch (error) { fail(error, context); return }
    void save(() => saveJournalCellEdits({ data: { edits } }), context)
  })
  const pasteText = useStableEventCallback((text: string, operation: 'paste' | 'clear' = 'paste') => {
    if (!options.enabled) return
    const label = operation === 'clear' ? 'Очистка ячеек' : 'Вставка в ячейки'
    const retry = operation === 'clear' ? 'очистку' : 'вставку'
    if (options.availability !== 'ready' || active.current) {
      const reason = active.current
        ? `предыдущее изменение ещё сохраняется. Дождитесь завершения сохранения и обновления журнала, затем повторите ${retry}.`
        : options.availability === 'expired'
          ? `открытые данные устарели. Нажмите «Обновить таблицу», заново выделите ячейки и повторите ${retry}.`
          : options.availability === 'load-error'
            ? `не удалось загрузить данные журнала. Нажмите «Повторить загрузку», дождитесь загрузки, проверьте выделенные ячейки и повторите ${retry}.`
          : `журнал ещё обновляется. Дождитесь окончания обновления, проверьте выделенные ячейки и повторите ${retry}.`
      const message = `${label} не выполнена`
      const details = `${message}: ${reason}`
      setStatus({ message, error: true, details }); options.onError?.(details)
      return
    }
    try {
      const api = options.api
      if (!api || api.isDestroyed()) return
      const values = parseJournalClipboard(text)
      const ranges = api.getCellRanges() ?? [], focused = api.getFocusedCell()
      if (ranges.length > 1) throw new Error('Выделите один прямоугольный диапазон ячеек и повторите действие.')
      const selected = ranges[0]
      const first = selected?.startRow && selected?.endRow ? Math.min(selected.startRow.rowIndex, selected.endRow.rowIndex) : focused?.rowIndex
      let last = selected?.startRow && selected?.endRow ? Math.max(selected.startRow.rowIndex, selected.endRow.rowIndex) : first
      let columns = selected?.columns ?? (focused ? [focused.column] : [])
      const displayed = api.getAllDisplayedColumns()
      columns = displayed.filter(column => columns.includes(column))
      if (first == null || last == null || !columns.length) throw new Error('Сначала выберите ячейку или диапазон в журнале.')
      if (first === last && columns.length === 1 && (values.length > 1 || values[0].length > 1)) {
        last = first + values.length - 1
        const start = displayed.indexOf(columns[0]); columns = displayed.slice(start, start + values[0].length)
        if (columns.length !== values[0].length || last >= api.getDisplayedRowCount()) throw new Error('Вставляемые данные выходят за границы таблицы.')
      }
      const fields = columns.map(column => column.getColId() as WeldFieldKey)
      if (fields.some(field => !JOURNAL_INLINE_FIELDS.has(field) || !options.canEditField(field))) throw new Error('В диапазоне есть поля, недоступные для ввода из таблицы. Выделите только редактируемые столбцы.')
      const range = options.getEditRange({ first, last, columns: fields })
      if (!range || range.parts.length !== 1 || range.parts[0].route.length !== range.groupBy.length) throw new Error('Выделите ячейки стыков внутри одной раскрытой группы, без её заголовка.')
      if (!(values.length === 1 && values[0].length === 1) && (values.length !== last - first + 1 || values[0].length !== fields.length)) throw new Error('Размер вставляемых данных не совпадает с выделенным диапазоном.')
      void save(() => pasteJournalCells({ data: { range, values } }), `${label} (стыков: ${last - first + 1})`)
    } catch (error) { fail(error, label) }
  })
  const paste = useStableEventCallback((event: ClipboardEvent<HTMLElement>) => {
    if (!options.enabled || !(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable], .ag-menu, .ag-popup-child')) return
    event.preventDefault(); event.stopPropagation(); pasteText(event.clipboardData.getData('text/plain'))
  })
  const dismiss = useStableEventCallback(() => { if (!active.current) setStatus({ message: '' }) })
  return { canEdit, edit, paste, clear: () => pasteText('', 'clear'), status, dismiss,
    showError: () => { if (status.details) options.onError?.(status.details) } }
}
