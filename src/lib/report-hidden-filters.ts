export const PERCENTAGE_LINE_STAMP_FILTER_KEY = '__percentageLineStamp'
export const ROW_ID_LIST_FILTER_KEY = '__rowIdList'

export type PercentageLineStampFilter = {
  projectTitle: string
  subtitleCode: string
  line: string
  stamp: string
}

export type RowIdListFilter = {
  rowIds: number[]
  mode?: 'include' | 'exclude'
}

function trimRowText(value: unknown) {
  return String(value ?? '').trim()
}

export function buildPercentageLineStampFilters(filter: PercentageLineStampFilter) {
  return {
    projectTitle: trimRowText(filter.projectTitle),
    subtitleCode: trimRowText(filter.subtitleCode),
    line: trimRowText(filter.line),
    [PERCENTAGE_LINE_STAMP_FILTER_KEY]: JSON.stringify({
      projectTitle: trimRowText(filter.projectTitle),
      subtitleCode: trimRowText(filter.subtitleCode),
      line: trimRowText(filter.line),
      stamp: trimRowText(filter.stamp),
    } satisfies PercentageLineStampFilter),
  }
}

export function buildRowIdListFilters(rowIds: number[], mode: 'include' | 'exclude' = 'include') {
  const uniqueRowIds = Array.from(new Set(rowIds.filter(Number.isFinite)))
  return {
    [ROW_ID_LIST_FILTER_KEY]: JSON.stringify(
      mode === 'exclude'
        ? ({ rowIds: uniqueRowIds, mode } satisfies RowIdListFilter)
        : ({ rowIds: uniqueRowIds } satisfies RowIdListFilter),
    ),
  }
}

export function parsePercentageLineStampFilter(value: string): PercentageLineStampFilter | null {
  try {
    const parsed = JSON.parse(value) as Partial<PercentageLineStampFilter>
    const filter = {
      projectTitle: trimRowText(parsed.projectTitle),
      subtitleCode: trimRowText(parsed.subtitleCode),
      line: trimRowText(parsed.line),
      stamp: trimRowText(parsed.stamp),
    }
    return filter.stamp ? filter : null
  } catch {
    return null
  }
}

export function parseRowIdListFilter(value: string): RowIdListFilter | null {
  try {
    const parsed = JSON.parse(value) as Partial<RowIdListFilter>
    const rowIds = Array.isArray(parsed.rowIds)
      ? parsed.rowIds.map((rowId) => Number(rowId)).filter(Number.isFinite)
      : []
    const mode = parsed.mode === 'exclude' ? 'exclude' : 'include'
    return { rowIds, mode }
  } catch {
    return null
  }
}

export function isHiddenReportFilterKey(key: string) {
  return key === PERCENTAGE_LINE_STAMP_FILTER_KEY || key === ROW_ID_LIST_FILTER_KEY
}
