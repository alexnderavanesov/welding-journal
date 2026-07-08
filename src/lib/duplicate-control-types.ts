export const DUPLICATE_CONTROL_METHODS = ['ВИК', 'РК', 'УЗК', 'ПВК', 'ТВМТ', 'РФА', 'СТЛС', 'МКК'] as const
export const DUPLICATE_CONTROL_RESULTS = ['годен', 'ремонт', 'вырез'] as const

export type DuplicateControlMethod = (typeof DUPLICATE_CONTROL_METHODS)[number]
export type DuplicateControlResult = (typeof DUPLICATE_CONTROL_RESULTS)[number]

export type DuplicateControlRecord = {
  id: number
  weldJointId: number
  method: DuplicateControlMethod
  result: DuplicateControlResult
  controlDate: string
  conclusion: string
  conclusionDate: string
}

export type DuplicateControlDraft = {
  id?: number
  rowIds: Set<number>
  methods: Set<DuplicateControlMethod>
  result: DuplicateControlResult | ''
  controlDate: string
  conclusion: string
  conclusionDate: string
  search: string
}

export const EMPTY_DUPLICATE_CONTROL_DRAFT: DuplicateControlDraft = {
  rowIds: new Set(),
  methods: new Set(),
  result: '',
  controlDate: '',
  conclusion: '',
  conclusionDate: '',
  search: '',
}

export function createEmptyDuplicateControlDraft(): DuplicateControlDraft {
  return {
    rowIds: new Set(),
    methods: new Set(),
    result: '',
    controlDate: '',
    conclusion: '',
    conclusionDate: '',
    search: '',
  }
}
