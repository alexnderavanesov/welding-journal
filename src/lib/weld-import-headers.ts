import { EXCEL_FIELDS, normalizeHeader } from './weld-fields'

export const OPTIONAL_LEGACY_IMPORT_HEADERS = new Set([
  'ID cпула',
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

export function normalizeImportHeaders(values: unknown[]) {
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

export function mapHeadersToFields(headers: string[]) {
  const seen = new Map<string, number>()

  return headers.map((header) => {
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    const candidates = EXCEL_FIELDS.filter((field) => field.label === header)
    return candidates[count] ?? candidates[0] ?? null
  })
}
