import type { WdiTableSettings } from '@/lib/other-settings'

export async function parseWdiTableFile(file: File): Promise<WdiTableSettings> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, cellDates: false })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error('В файле не найден лист с таблицей WDI.')

  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  const [headerRow, ...dataRows] = rows
  const thicknesses = parseBoundaryRow(headerRow?.slice(1) ?? [])
  if (thicknesses.length === 0) throw new Error('В первой строке таблицы WDI не найдены значения толщины.')
  if (!isAscending(thicknesses)) throw new Error('Толщины в первой строке таблицы WDI должны идти по возрастанию.')

  const diameters: number[] = []
  const values: Array<Array<number | null>> = []
  for (const row of dataRows) {
    const diameter = parseNumber(row?.[0])
    if (diameter === null) continue
    diameters.push(diameter)
    values.push(
      Array.from({ length: thicknesses.length }, (_, index) => parseNumber(row?.[index + 1])),
    )
  }

  if (diameters.length === 0) throw new Error('В первом столбце таблицы WDI не найдены значения диаметра.')
  if (!isAscending(diameters)) throw new Error('Диаметры в первом столбце таблицы WDI должны идти по возрастанию.')

  return {
    fileName: file.name,
    uploadedAt: new Date().toISOString(),
    diameters,
    thicknesses,
    values,
  }
}

export async function buildWdiTableXlsxBytes(table: WdiTableSettings) {
  const XLSX = await import('xlsx')
  const rows = getWdiTableMatrix(table)
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [
    { wch: 12 },
    ...table.thicknesses.map(() => ({ wch: 10 })),
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Таблица WDI')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

export function getWdiTableMatrix(table: WdiTableSettings): Array<Array<number | string>> {
  return [
    ['D \\ T', ...table.thicknesses],
    ...table.diameters.map((diameter, rowIndex) => [
      diameter,
      ...table.thicknesses.map((_, columnIndex) => table.values[rowIndex]?.[columnIndex] ?? ''),
    ]),
  ]
}

function parseBoundaryRow(values: unknown[]) {
  return values.map(parseNumber).filter((value): value is number => value !== null)
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function isAscending(values: readonly number[]) {
  return values.every((value, index) => index === 0 || value >= values[index - 1])
}
