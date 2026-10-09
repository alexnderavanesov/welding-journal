import type { WeldInput } from '@/lib/weld-fields'

export const TECHNOLOGY_CARD_PSTO_OPTIONS = [
  { value: 'required', label: 'С ПСТО' },
  { value: 'not-required', label: 'Без ПСТО' },
  { value: 'any', label: 'Не имеет значения' },
] as const

export type TechnologyCardPsto = typeof TECHNOLOGY_CARD_PSTO_OPTIONS[number]['value']

export type TechnologyCardParameters = {
  name: string
  weldingMethods: string[]
  connectionType: string
  materialGroups: string[]
  diameterFrom: number
  diameterTo: number
  thicknessFrom: number
  thicknessTo: number
  psto: TechnologyCardPsto
}

export type TechnologyCardRecord = TechnologyCardParameters & {
  id: number
  revision: number
  archived: boolean
}

export type TechnologyCardField = keyof TechnologyCardParameters
export type TechnologyCardIssue = { field: TechnologyCardField; message: string }
export type TechnologyCardDraft = Omit<TechnologyCardParameters,
  'diameterFrom' | 'diameterTo' | 'thicknessFrom' | 'thicknessTo'> & {
  diameterFrom: string
  diameterTo: string
  thicknessFrom: string
  thicknessTo: string
}

export type TechnologyCardWeld = Pick<WeldInput,
  'weldDate' | 'technologyCardNumber' | 'weldingMethod' | 'connectionType' |
  'materialGroup' | 'd1' | 'd2' | 't1' | 't2' | 'pstoRequired'>

export type TechnologyCardWeldIssue = {
  field: keyof TechnologyCardWeld
  kind: 'missing' | 'invalid'
  message: string
}
