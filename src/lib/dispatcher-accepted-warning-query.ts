export const DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY = ['dispatcher-accepted-warnings'] as const

export const DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE_OPTIONS = [25, 50, 100] as const
export const DEFAULT_DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE = 50

export type DispatcherAcceptedWarningCategory =
  | 'all'
  | 'percentage-line-control'
  | 'early-coil'
  | 'other'

export type DispatcherAcceptedWarningPeriod = 'all' | '7d' | '30d' | '90d'
export type DispatcherAcceptedWarningSort = 'newest' | 'oldest'

export type DispatcherAcceptedWarningsRequest = {
  search?: string
  category?: DispatcherAcceptedWarningCategory
  period?: DispatcherAcceptedWarningPeriod
  sort?: DispatcherAcceptedWarningSort
  page?: number
  pageSize?: number
}

export type NormalizedDispatcherAcceptedWarningsRequest = {
  search: string
  category: DispatcherAcceptedWarningCategory
  period: DispatcherAcceptedWarningPeriod
  sort: DispatcherAcceptedWarningSort
  page: number
  pageSize: (typeof DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE_OPTIONS)[number]
}

const ACCEPTED_WARNING_CATEGORIES = new Set<DispatcherAcceptedWarningCategory>([
  'all',
  'percentage-line-control',
  'early-coil',
  'other',
])
const ACCEPTED_WARNING_PERIODS = new Set<DispatcherAcceptedWarningPeriod>(['all', '7d', '30d', '90d'])
const ACCEPTED_WARNING_SORTS = new Set<DispatcherAcceptedWarningSort>(['newest', 'oldest'])

export function normalizeDispatcherAcceptedWarningsRequest(
  request: DispatcherAcceptedWarningsRequest | undefined,
): NormalizedDispatcherAcceptedWarningsRequest {
  const category = ACCEPTED_WARNING_CATEGORIES.has(request?.category as DispatcherAcceptedWarningCategory)
    ? request?.category as DispatcherAcceptedWarningCategory
    : 'all'
  const period = ACCEPTED_WARNING_PERIODS.has(request?.period as DispatcherAcceptedWarningPeriod)
    ? request?.period as DispatcherAcceptedWarningPeriod
    : 'all'
  const sort = ACCEPTED_WARNING_SORTS.has(request?.sort as DispatcherAcceptedWarningSort)
    ? request?.sort as DispatcherAcceptedWarningSort
    : 'newest'
  const requestedPageSize = Number(request?.pageSize)
  const requestedPage = Number(request?.page)
  const pageSize = DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE_OPTIONS.includes(
    requestedPageSize as (typeof DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE_OPTIONS)[number],
  )
    ? requestedPageSize as (typeof DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE_OPTIONS)[number]
    : DEFAULT_DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE

  return {
    search: String(request?.search ?? '').trim().slice(0, 200),
    category,
    period,
    sort,
    page: Number.isFinite(requestedPage)
      ? Math.min(1_000_000, Math.max(1, Math.floor(requestedPage)))
      : 1,
    pageSize,
  }
}

export function getDispatcherAcceptedWarningPeriodStart(
  period: DispatcherAcceptedWarningPeriod,
  now = Date.now(),
) {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0
  return days > 0 ? new Date(now - days * 24 * 60 * 60 * 1000) : null
}

export function clampDispatcherAcceptedWarningPage(
  requestedPage: number,
  total: number,
  pageSize: number,
) {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.floor(requestedPage)), pageCount)
}

export function getDispatcherAcceptedWarningCategoryLabel(kind: string) {
  switch (kind) {
    case 'create':
    case 'coil':
    case 'delete':
    case 'rename':
      return 'Цепочка стыков'
    case 'early-coil':
      return 'Досрочная катушка'
    case 'check':
    case 'duplicate-check':
      return 'Проверка стыка'
    case 'line-consistency':
      return 'Проверка линии'
    case 'percentage-line-control':
      return 'Процентная линия'
    case 'welder-stamp-expiry':
      return 'Клеймо и допуски'
    default:
      return 'Исключение'
  }
}
