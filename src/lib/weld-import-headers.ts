import { EXCEL_FIELDS, normalizeHeader } from './weld-fields'

export const OPTIONAL_LEGACY_IMPORT_HEADERS = new Set([
  'ID cпула',
  'наличие МКК',
  'Заявка ВИК',
  'Заявка РК',
  'Заявка УЗК',
  'Заявка ПВК',
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
  'BoQ УЗК',
  'КС3 УЗК',
  'BoQ ПВК',
  'КС3 ПВК',
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
  'Дата УЗК',
  'Заключение УЗК',
  'Дата ПВК',
  'Заключение ПВК',
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

const LEGACY_AVAILABILITY_HEADER_MAP = new Map([
  ['наличие ПСТО', 'Назначение ПСТО'],
  ['наличие ВИК', 'Назначение ВИК'],
  ['наличие РК', 'Назначение РК'],
  ['наличие УЗК', 'Назначение УЗК'],
  ['наличие ПВК', 'Назначение ПВК'],
  ['наличие ТВМТ', 'Назначение ТВМТ'],
  ['наличие РФА', 'Назначение РФА'],
  ['наличие СТЛС', 'Назначение СТЛС'],
  ['наличие МКК', 'Назначение МКК'],
])

export function normalizeImportHeaders(values: unknown[]) {
  let pstoCount = 0
  const rawHeaders = values.map(normalizeHeader)
  const hasExplicitPstoRequired = rawHeaders.includes('наличие ПСТО') || rawHeaders.includes('Назначение ПСТО')
  const resultHeaderMap = new Map([
    ['ВИК', 'результат ВИК'],
    ['РК', 'результат РК'],
    ['УЗК', 'результат УЗК'],
    ['ПВК', 'результат ПВК'],
    ['ТВМТ', 'результат ТВМТ'],
    ['РФА', 'результат РФА'],
    ['СТЛС', 'результат СТЛС'],
    ['МКК', 'результат МКК'],
  ])

  return rawHeaders.map((header) => {
    if (header === 'ПСТО') {
      if (hasExplicitPstoRequired) return 'ПСТО'
      pstoCount += 1
      return pstoCount === 1 ? 'Назначение ПСТО' : 'результат ПСТО'
    }
    if (resultHeaderMap.has(header)) return resultHeaderMap.get(header)!
    if (LEGACY_AVAILABILITY_HEADER_MAP.has(header)) return LEGACY_AVAILABILITY_HEADER_MAP.get(header)!
    return header === 'Конт-роль швов, (%)' ? 'Контроль швов, (%)' : header
  })
}

export function mapHeadersToFields(headers: string[]) {
  const seen = new Map<string, number>()

  return headers.map((header) => {
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    const candidates = EXCEL_FIELDS.filter((field) => field.label === header)
    return candidates[count] ?? candidates[0] ?? null
  })
}
