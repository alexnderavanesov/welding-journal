import { isTConnectionType } from '@/lib/connection-type'
import { normalizeTechnologyCardName } from '@/lib/technology-card-name'
import { normalizeDataListOption, type DataListSettings } from '@/lib/data-list-settings'
import {
  TECHNOLOGY_CARD_PSTO_OPTIONS,
  type TechnologyCardDraft,
  type TechnologyCardField,
  type TechnologyCardIssue,
  type TechnologyCardParameters,
} from '@/lib/technology-card-types'

export function createEmptyTechnologyCardDraft(): TechnologyCardDraft {
  return {
    name: '', weldingMethods: [], connectionType: '', materialGroups: [],
    diameterFrom: '', diameterTo: '', thicknessFrom: '', thicknessTo: '', psto: 'any',
  }
}

export function parseTechnologyCardDimension(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return null
  const number = Number(text)
  return number > 0 && number <= 999_999_999.999 ? number : null
}

/** Collect every independently detectable error; never silently drop unknown codes. */
export function validateTechnologyCard(value: unknown, settings: DataListSettings): {
  card: TechnologyCardParameters | null
  issues: TechnologyCardIssue[]
} {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const issues: TechnologyCardIssue[] = []
  const add = (field: TechnologyCardField, message: string) => issues.push({ field, message })
  const name = normalizeTechnologyCardName(source.name)
  if (!name) add('name', 'Укажите название технологической карты, например «ТК №12».')

  const readCodes = (field: 'weldingMethods' | 'materialGroups', options: string[]) => {
    const raw = source[field]
    if (!Array.isArray(raw) || !raw.length) {
      add(field, field === 'weldingMethods' ? 'Выберите способы сварки.' : 'Выберите одну или две группы материалов.')
      return []
    }
    const codes = raw.map(code => typeof code === 'string' ? normalizeDataListOption(code) : '')
    const unknown = codes.filter(code => !options.includes(code))
    if (unknown.length) add(field, `Значения отсутствуют в справочнике: ${unknown.map(code => code || 'пустое значение').join(', ')}.`)
    if (new Set(codes).size !== codes.length) add(field, 'Выберите разные значения без повторений.')
    if (field === 'weldingMethods' && codes.length > 2) add(field, 'Для ТК можно выбрать не больше двух способов сварки.')
    if (field === 'materialGroups' && codes.length > 2) add(field, 'Для ТК можно выбрать одну или две разные группы материалов.')
    return codes
  }
  const weldingMethods = readCodes('weldingMethods', settings.weldingTypes)
  const materialGroups = readCodes('materialGroups', settings.materialGroups)
  const connectionType = typeof source.connectionType === 'string' ? normalizeDataListOption(source.connectionType) : ''
  if (!connectionType) add('connectionType', 'Выберите тип соединения.')
  else if (isTConnectionType(connectionType)) add('connectionType', 'Подбор ТК для Т-стыков пока не поддерживается.')
  else if (!settings.connectionTypes.includes(connectionType)) add('connectionType', `Тип соединения «${connectionType}» отсутствует в справочнике.`)

  const dimensions = {} as Pick<TechnologyCardParameters, 'diameterFrom' | 'diameterTo' | 'thicknessFrom' | 'thicknessTo'>
  for (const [field, label] of [
    ['diameterFrom', 'Диаметр от'], ['diameterTo', 'Диаметр до'],
    ['thicknessFrom', 'Толщина от'], ['thicknessTo', 'Толщина до'],
  ] as const) {
    const dimension = parseTechnologyCardDimension(source[field])
    if (dimension === null) add(field, `${label}: укажите положительное число, не более трёх знаков после запятой.`)
    else dimensions[field] = dimension
  }
  for (const [from, to, label] of [
    ['diameterFrom', 'diameterTo', 'Диаметр'], ['thicknessFrom', 'thicknessTo', 'Толщина'],
  ] as const) {
    if (dimensions[from] > dimensions[to]) {
      add(from, `${label}: значение «от» больше значения «до».`)
      add(to, `${label}: значение «до» меньше значения «от».`)
    }
  }
  const psto = TECHNOLOGY_CARD_PSTO_OPTIONS.find(option => option.value === source.psto)?.value
  if (!psto) add('psto', 'Выберите назначение ПСТО: с ПСТО, без ПСТО или не имеет значения.')
  return {
    card: issues.length || !psto ? null : { name, weldingMethods, connectionType, materialGroups, ...dimensions, psto },
    issues,
  }
}
