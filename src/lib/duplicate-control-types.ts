export const DUPLICATE_CONTROL_METHODS = ['ВИК', 'РК', 'УЗК', 'ПВК', 'ТВМТ'] as const
export const DUPLICATE_CONTROL_RESULTS = ['годен', 'ремонт', 'вырез'] as const

export type DuplicateControlMethod = (typeof DUPLICATE_CONTROL_METHODS)[number]
export type DuplicateControlResult = (typeof DUPLICATE_CONTROL_RESULTS)[number]

export type DuplicateControlRecord = {
  id: number
  version?: string
  weldJointId: number
  method: DuplicateControlMethod
  result: DuplicateControlResult
  controlDate: string
  conclusion: string
  conclusionDate: string
}

export const DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS = [100, 300, 500, 1000] as const
export const DUPLICATE_CONTROL_MASS_SELECTION_LIMIT = 5_000
export const DUPLICATE_CONTROL_MASS_SELECTION_ERROR =
  'Можно выбрать не более 5 000 стыков. Уточните поиск или снимите часть выбора.'

export type DuplicateControlPageSize = (typeof DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS)[number]

export type DuplicateControlCandidatePageRequest = {
  search?: string
  page?: number
  pageSize?: number
}

export type DuplicateControlCandidatePageResult = {
  rows: import('@/lib/dispatcher-types').WeldRow[]
  totalCount?: number
  page: number
  pageSize: DuplicateControlPageSize
  hasMore: boolean
}

export type DuplicateControlRegistryRecord = DuplicateControlRecord & {
  projectTitle: string
  subtitleCode: string
  line: string
  spool: string
  joint: string
}

export type DuplicateControlRegistryPageRequest = {
  page?: number
  pageSize?: number
}

export type DuplicateControlRegistryPageResult = {
  rows: DuplicateControlRegistryRecord[]
  totalCount?: number
  page: number
  pageSize: DuplicateControlPageSize
  hasMore: boolean
}

export type DuplicateControlDraft = {
  id?: number
  expectedVersion?: string
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
