import { useCallback, useState } from 'react'

import type { ActiveReport } from '@/lib/home-state'
import { FIELD_BY_KEY, isVirtualWeldField } from '@/lib/weld-fields'
import type { WeldReportKind, WeldSort } from '@/server/weld-contracts'

const STORAGE_KEY = 'welding-report-sort:v1'

type SortByReport = Partial<Record<WeldReportKind, WeldSort>>

export function useReportSortState(activeReport: ActiveReport) {
  const [sortByReport, setSortByReport] = useState<SortByReport>(readSortByReport)
  const report = isWeldReportKind(activeReport) ? activeReport : null
  const sort = report ? sortByReport[report] ?? null : null

  const setSort = useCallback((nextSort: WeldSort | null) => {
    if (!report) return
    setSortByReport((current) => {
      const next = { ...current }
      if (nextSort) next[report] = nextSort
      else delete next[report]
      writeSortByReport(next)
      return next
    })
  }, [report])

  return { sort, setSort }
}

export function readSortByReport(): SortByReport {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([report, value]) => {
        if (!isWeldReportKind(report) || !isWeldSort(value)) return []
        return [[report, value]]
      }),
    )
  } catch {
    return {}
  }
}

function writeSortByReport(value: SortByReport) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

function isWeldReportKind(value: unknown): value is WeldReportKind {
  return value === 'weldingJournal' || value === 'lnk' || value === 'heatTreatment'
}

function isWeldSort(value: unknown): value is WeldSort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<WeldSort>
  const field = typeof candidate.fieldKey === 'string' ? FIELD_BY_KEY.get(candidate.fieldKey as never) : undefined
  return Boolean(field) && !isVirtualWeldField(field) && (candidate.direction === 'asc' || candidate.direction === 'desc')
}
