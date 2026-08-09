import type { RkExposureTableSettings, WdiTableSettings } from '@/lib/other-settings'
import { buildRkExposureOptionLabel, parseRkExposureRows } from '@/lib/rk-exposure-table'

export type EditableGrid = string[][]

export function parseClipboardGrid(value: string): EditableGrid {
  const normalized = value.replace(/\r\n?/g, '\n')
  const rows = normalized.split('\n')
  while (rows.length > 1 && rows.at(-1) === '') rows.pop()
  return rows.map((row) => row.split('\t'))
}

export function pasteIntoGrid(
  source: EditableGrid,
  startRow: number,
  startColumn: number,
  clipboardValue: string,
): EditableGrid {
  const pasted = parseClipboardGrid(clipboardValue)
  const rowCount = Math.max(source.length, startRow + pasted.length)
  const columnCount = Math.max(
    source.reduce((maximum, row) => Math.max(maximum, row.length), 0),
    ...pasted.map((row) => startColumn + row.length),
  )
  const next = Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => source[rowIndex]?.[columnIndex] ?? ''),
  )
  pasted.forEach((row, rowOffset) => {
    row.forEach((cell, columnOffset) => {
      next[startRow + rowOffset][startColumn + columnOffset] = cell.trim()
    })
  })
  return next
}

export function moveGridColumn(source: EditableGrid, columnIndex: number, direction: -1 | 1) {
  const targetIndex = columnIndex + direction
  if (columnIndex <= 0 || targetIndex <= 0) return source.map((row) => [...row])
  const columnCount = source.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  if (columnIndex >= columnCount || targetIndex >= columnCount) return source.map((row) => [...row])
  return source.map((row) => {
    const next = Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
    ;[next[columnIndex], next[targetIndex]] = [next[targetIndex], next[columnIndex]]
    return next
  })
}

export function moveGridRow(source: EditableGrid, rowIndex: number, direction: -1 | 1, firstMovableRow = 0) {
  const targetIndex = rowIndex + direction
  const next = source.map((row) => [...row])
  if (rowIndex < firstMovableRow || targetIndex < firstMovableRow || targetIndex >= next.length) return next
  ;[next[rowIndex], next[targetIndex]] = [next[targetIndex], next[rowIndex]]
  return next
}

export function getWdiEditorGrid(table: WdiTableSettings | null): EditableGrid {
  if (!table) return [['D \\ T', ''], ['', '']]
  return [
    ['D \\ T', ...table.thicknesses.map(formatNumber)],
    ...table.diameters.map((diameter, rowIndex) => [
      formatNumber(diameter),
      ...table.thicknesses.map((_, columnIndex) => formatNullableNumber(table.values[rowIndex]?.[columnIndex])),
    ]),
  ]
}

export function buildWdiTableFromEditorGrid(
  source: EditableGrid,
  metadata: { fileName?: string; uploadedAt?: string } = {},
): WdiTableSettings {
  const grid = trimGrid(source)
  const thicknessCells = grid[0]?.slice(1) ?? []
  const diameterRows = grid.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''))
  if (thicknessCells.length === 0 || thicknessCells.some((cell) => cell.trim() === '')) {
    throw new Error('Укажите все границы толщины в верхней строке таблицы WDI.')
  }
  if (diameterRows.length === 0 || diameterRows.some((row) => !row[0]?.trim())) {
    throw new Error('Укажите диаметр для каждой заполненной строки таблицы WDI.')
  }

  const thicknesses = thicknessCells.map((value) => parseRequiredNumber(value, 'толщины'))
  const diameters = diameterRows.map((row) => parseRequiredNumber(row[0], 'диаметра'))
  assertStrictAscending(thicknesses, 'Толщины')
  assertStrictAscending(diameters, 'Диаметры')

  return {
    fileName: metadata.fileName?.trim() || 'Таблица WDI',
    uploadedAt: metadata.uploadedAt || new Date().toISOString(),
    diameters,
    thicknesses,
    values: diameterRows.map((row) =>
      thicknesses.map((_, columnIndex) => parseOptionalNumber(row[columnIndex + 1], 'значения WDI')),
    ),
  }
}

export function getRkExposureEditorGrid(table: RkExposureTableSettings | null): EditableGrid {
  if (!table) return [['', '', '', '']]
  const rows: EditableGrid = []
  table.entries.forEach((entry) => {
    entry.options.forEach((option) => {
      option.values.forEach((value, valueIndex) => {
        rows.push([
          valueIndex === 0 ? formatNumber(entry.diameter) : '',
          value,
          valueIndex === 0 && option.isDefault ? '+' : '',
          valueIndex === 0 ? option.note : '',
        ])
      })
    })
  })
  return rows.length > 0 ? rows : [['', '', '', '']]
}

export function buildRkExposureTableFromEditorGrid(
  source: EditableGrid,
  metadata: { fileName?: string; uploadedAt?: string } = {},
): RkExposureTableSettings {
  const rows = trimTrailingEmptyRows(source)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => [row[0] ?? '', row[1] ?? '', normalizeDefaultMarker(row[2]), row[3] ?? ''])
  const entries = parseRkExposureRows(rows)
  entries.forEach((entry) => {
    entry.options.forEach((option) => {
      option.label = buildRkExposureOptionLabel(option)
    })
  })
  return {
    fileName: metadata.fileName?.trim() || 'Экспозиции по диаметрам',
    uploadedAt: metadata.uploadedAt || new Date().toISOString(),
    entries,
  }
}

function normalizeDefaultMarker(value: string | undefined) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('ru')
  return normalized === '+' || normalized === 'да' || normalized === 'true' || normalized === '1' ? '+' : ''
}

function trimGrid(source: EditableGrid) {
  const rows = trimTrailingEmptyRows(source)
  let lastColumn = 0
  rows.forEach((row) => {
    row.forEach((cell, columnIndex) => {
      if (cell.trim() !== '') lastColumn = Math.max(lastColumn, columnIndex)
    })
  })
  return rows.map((row) => Array.from({ length: lastColumn + 1 }, (_, columnIndex) => row[columnIndex] ?? ''))
}

function trimTrailingEmptyRows(source: EditableGrid) {
  const rows = source.map((row) => row.map((cell) => String(cell ?? '').trim()))
  while (rows.length > 0 && rows.at(-1)?.every((cell) => cell === '')) rows.pop()
  return rows
}

function parseRequiredNumber(value: string | undefined, label: string) {
  const parsed = parseOptionalNumber(value, label)
  if (parsed === null) throw new Error(`Не удалось прочитать значение ${label}.`)
  return parsed
}

function parseOptionalNumber(value: string | undefined, label: string) {
  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Значение ${label} «${value}» должно быть неотрицательным числом.`)
  return parsed
}

function assertStrictAscending(values: number[], label: string) {
  if (values.some((value, index) => index > 0 && value <= values[index - 1])) {
    throw new Error(`${label} должны идти строго по возрастанию без повторов.`)
  }
}

function formatNullableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '' : formatNumber(value)
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',')
}
