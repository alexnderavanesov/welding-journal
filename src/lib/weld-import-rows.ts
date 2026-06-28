import {
  EXCEL_FIELDS,
  FULL_EXCEL_HEADERS,
  type WeldInput,
  calculateFinalStatus,
  normalizeHeader,
} from './weld-fields'
import { emptyToNull, parseCell } from './weld-import-parsers'

export type ImportResult = {
  records: WeldInput[]
  skippedRows: number
  headers: string[]
  missingHeaders: string[]
}

export type EditableImportOptions = {
  editableFieldKeys: ReadonlySet<string>
  matchFieldKeys: ReadonlySet<string>
}

export function parseWorksheetRows(rows: unknown[][]): ImportResult {
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeImportHeaders(rawHeaders)
  const missingHeaders = FULL_EXCEL_HEADERS.filter((header) => !headers.includes(header))
  const optionalHeaders = new Set([
    'ID cпула',
    'Зона стыка',
    'Ном. стыка',
    'Индкес',
    'R/W стыка',
    'Номер спула',
    'наличие МКК',
    'Заявка ВИК',
    'Заявка РК',
    'Заявка ПВК',
    'Заявка УЗК',
    'Заявка ПСТО',
    'Заявка ТВМТ',
    'Заявка РФА',
    'Заявка СТЛС',
    'Заявка МКК',
    'дата ПСТО',
    'диаграмма термообработки',
    'примечание',
    'BoQ ПСТО',
    'КС3 ПСТО',
    'BoQ ВИК',
    'КС3 ВИК',
    'BoQ РК',
    'КС3 РК',
    'BoQ ПВК',
    'КС3 ПВК',
    'BoQ УЗК',
    'КС3 УЗК',
    'BoQ ТВМТ',
    'КС3 ТВМТ',
    'BoQ РФА',
    'КС3 РФА',
    'BoQ СТЛС',
    'КС3 СТЛС',
    'BoQ МКК',
    'КС3 МКК',
    'Дата ВИК',
    'Заключение ВИК',
    'Дата РК',
    'Заключение РК',
    'Дата ПВК',
    'Заключение ПВК',
    'Дата УЗК',
    'Заключение УЗК',
    'Дата ТВМТ',
    'Заключение ТВМТ',
    'Дата РФА',
    'Заключение РФА',
    'Дата СТЛС',
    'Заключение СТЛС',
    'Дата МКК',
    'Заключение МКК',
    'Описание дефектов',
    'Примечание',
    'результат РФА',
  ])
  const acceptsLegacy = missingHeaders.length === 0 || missingHeaders.every((header) => optionalHeaders.has(header))

  if (!acceptsLegacy) {
    throw new Error(`Не найдены обязательные колонки: ${missingHeaders.join(', ')}`)
  }

  const fieldsByColumn = mapHeadersToFields(headers)
  const records: WeldInput[] = []
  let skippedRows = 0

  for (const row of dataRows) {
    const record: WeldInput = {}
    fieldsByColumn.forEach((field, index) => {
      if (!field) return
      record[field.key] = parseCell(field, row[index])
    })

    if (!isMeaningfulRecord(record)) {
      skippedRows += 1
      continue
    }

    if (!('spoolId' in record)) {
      record.spoolId = null
    }
    record.status = null
    record.finalStatus = calculateFinalStatus(record)
    records.push(record)
  }

  return { records, skippedRows, headers, missingHeaders }
}

export function parseEditableWorksheetRows(rows: unknown[][], options: EditableImportOptions): ImportResult {
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeImportHeaders(rawHeaders)
  const fieldsByColumn = mapHeadersToFields(headers)
  const records: WeldInput[] = []
  let skippedRows = 0

  for (const row of dataRows) {
    const record: WeldInput = {}
    let hasEditableColumn = false

    fieldsByColumn.forEach((field, index) => {
      if (!field) return
      if (!options.editableFieldKeys.has(field.key) && !options.matchFieldKeys.has(field.key)) return

      record[field.key] = parseCell(field, row[index])
      if (options.editableFieldKeys.has(field.key)) {
        hasEditableColumn = true
      }
    })

    if (!hasEditableColumn || !hasImportMatchFields(record, options.matchFieldKeys)) {
      skippedRows += 1
      continue
    }

    records.push(record)
  }

  return { records, skippedRows, headers, missingHeaders: [] }
}

export function isMeaningfulRecord(record: WeldInput) {
  return Boolean(record.joint || record.line || record.isometry)
}

function normalizeImportHeaders(values: unknown[]) {
  let pstoCount = 0
  const rawHeaders = values.map(normalizeHeader)
  const hasExplicitPstoRequired = rawHeaders.includes('наличие ПСТО')
  const resultHeaderMap = new Map([
    ['ВИК', 'результат ВИК'],
    ['РК', 'результат РК'],
    ['ПВК', 'результат ПВК'],
    ['УЗК', 'результат УЗК'],
    ['ТВМТ', 'результат ТВМТ'],
    ['РФА', 'результат РФА'],
    ['СТЛС', 'результат СТЛС'],
    ['МКК', 'результат МКК'],
  ])

  return rawHeaders.map((header) => {
    if (header === 'ПСТО') {
      if (hasExplicitPstoRequired) return 'ПСТО'
      pstoCount += 1
      return pstoCount === 1 ? 'наличие ПСТО' : 'результат ПСТО'
    }
    if (resultHeaderMap.has(header)) return resultHeaderMap.get(header)!
    return header === 'Конт-роль швов, (%)' ? 'Контроль швов, (%)' : header
  })
}

function mapHeadersToFields(headers: string[]) {
  const seen = new Map<string, number>()

  return headers.map((header) => {
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    const candidates = EXCEL_FIELDS.filter((field) => field.label === header)
    return candidates[count] ?? candidates[0] ?? null
  })
}

function hasImportMatchFields(record: WeldInput, matchFieldKeys: ReadonlySet<string>) {
  return [...matchFieldKeys].every((fieldKey) => emptyToNull(record[fieldKey as keyof WeldInput]) !== null)
}
