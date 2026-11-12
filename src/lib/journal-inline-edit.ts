import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from './weld-fields'
import { TECHNOLOGY_CARD_MATERIAL_FIELDS } from './technology-card-materials'
import { WORKFLOW_SELECTION_LIMIT } from './workflow-selection-limit'

export const JOURNAL_INLINE_FIELDS: ReadonlySet<WeldFieldKey> = new Set([
  ...TECHNOLOGY_CARD_MATERIAL_FIELDS.map(([field]) => field),
  'weldingJournalNote', 'isometry', 'sheet', 'revisionNumber', 'responsible',
])
export type JournalCellEdit = { id: number; version: string; values: Partial<Record<WeldFieldKey, string | number | null>> }

export function normalizeJournalCellEdits(input: unknown): { records: WeldInput[]; expectedVersions: Array<{ id: number; version: string }> } {
  if (!Array.isArray(input) || !input.length || input.length > WORKFLOW_SELECTION_LIMIT) {
    throw new Error(`Выберите от 1 до ${WORKFLOW_SELECTION_LIMIT} стыков для одного сохранения.`)
  }
  const ids = new Set<number>()
  const records: WeldInput[] = [], expectedVersions: Array<{ id: number; version: string }> = []
  for (const item of input) {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id) || typeof item.version !== 'string' || !item.version.trim()
      || !item.values || typeof item.values !== 'object' || Array.isArray(item.values) || !Object.keys(item.values).length) {
      throw new Error('Открытые данные устарели или диапазон некорректен. Обновите журнал; ничего не сохранено.')
    }
    const record: WeldInput = { id: item.id }
    for (const [key, value] of Object.entries(item.values)) {
      const field = key as WeldFieldKey
      if (field === 'id' || field === 'preHeatTreatmentRequired' || !JOURNAL_INLINE_FIELDS.has(field)) throw new Error('Это поле нельзя редактировать прямо в таблице. Откройте карточку стыка.')
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error('Некорректное значение ячейки.')
      const text = String(value ?? '').trim()
      if (FIELD_BY_KEY.get(field)?.kind === 'number') {
        const normalized = text.replace(',', '.')
        if (text && (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized)))) {
          throw new Error(`${FIELD_BY_KEY.get(field)!.label}: укажите число. Ничего не сохранено.`)
        }
        record[field] = text ? Number(normalized) : null
      } else record[field] = text || null
    }
    ids.add(item.id); records.push(record); expectedVersions.push({ id: item.id, version: item.version })
  }
  return { records, expectedVersions }
}

/** Excel/Sheets TSV, including quoted multiline notes and escaped quotes. */
export function parseJournalClipboard(text: string): string[][] {
  const rows: string[][] = [[]]
  let value = '', quoted = false, closedQuote = false
  const cell = () => { rows[rows.length - 1].push(value); value = ''; closedQuote = false }
  const source = text.replace(/\r\n?/g, '\n')
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { value += '"'; index++ }
      else if (char === '"') { quoted = false; closedQuote = true }
      else value += char
    } else if (char === '"' && !value && !closedQuote) quoted = true
    else if (char === '\t') cell()
    else if (char === '\n') { cell(); rows.push([]) }
    else {
      if (closedQuote) throw new Error('Не удалось прочитать вставляемую таблицу: проверьте кавычки.')
      value += char
    }
    if (rows.length > WORKFLOW_SELECTION_LIMIT + 1 || rows[rows.length - 1].length > JOURNAL_INLINE_FIELDS.size) throw new Error('Слишком большой диапазон для вставки.')
  }
  if (quoted) throw new Error('Не удалось прочитать вставляемую таблицу: незакрытые кавычки.')
  cell()
  if (source.endsWith('\n') && rows.length > 1) rows.pop()
  validateJournalClipboard(rows)
  return rows
}

export function validateJournalClipboard(input: unknown): asserts input is string[][] {
  if (!Array.isArray(input) || !input.length || input.length > WORKFLOW_SELECTION_LIMIT ||
    !Array.isArray(input[0]) || !input[0].length || input[0].length > JOURNAL_INLINE_FIELDS.size ||
    input.some(row => !Array.isArray(row) || row.length !== input[0].length || row.some(value => typeof value !== 'string'))) {
    throw new Error(`Вставьте прямоугольный диапазон не более ${WORKFLOW_SELECTION_LIMIT} строк.`)
  }
}
