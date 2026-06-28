import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { getAvailableLnkRequestMethods, isLnkMethodNoNeed } from '@/lib/lnk-status'

export function buildLnkWaitingNkRows(rows: WeldRow[]) {
  return rows.flatMap((row) =>
    LNK_METHODS.flatMap((method) => {
      const result = String(row[method.resultKey] ?? '').trim().toLowerCase()
      const requestName = String(row[method.requestKey] ?? '').trim()
      if (result !== 'ожидает нк') return []
      if (isLnkMethodNoNeed(row, method)) return []
      return [
        {
          projectTitle: row.projectTitle ?? '',
          subtitleCode: row.subtitleCode ?? '',
          line: row.line ?? '',
          spool: row.spool ?? '',
          joint: row.joint ?? '',
          wdi: row.wdi ?? '',
          weldDate: row.weldDate ?? '',
          requestName,
          controlMethod: method.code,
        },
      ]
    }),
  )
}

export function buildLnkToRequestRows(rows: WeldRow[]) {
  return rows.flatMap((row) =>
    getAvailableLnkRequestMethods(row).map((method) => ({
      projectTitle: row.projectTitle ?? '',
      subtitleCode: row.subtitleCode ?? '',
      line: row.line ?? '',
      spool: row.spool ?? '',
      joint: row.joint ?? '',
      wdi: row.wdi ?? '',
      weldDate: row.weldDate ?? '',
      requestName: '',
      controlMethod: method.code,
    })),
  )
}

export function buildLnkConclusionsRows(rows: WeldRow[]) {
  return rows.flatMap((row) =>
    LNK_METHODS.flatMap((method) => {
      const result = String(row[method.resultKey] ?? '').trim()
      const conclusionName = String(row[method.conclusionKey] ?? '').trim()
      const controlDate = row[method.conclusionDateKey] ?? ''
      if (!result && !conclusionName && !controlDate) return []
      if (result.toLowerCase() === 'ожидает нк' && !conclusionName && !controlDate) return []

      return [
        {
          projectTitle: row.projectTitle ?? '',
          subtitleCode: row.subtitleCode ?? '',
          line: row.line ?? '',
          spool: row.spool ?? '',
          joint: row.joint ?? '',
          wdi: row.wdi ?? '',
          weldDate: row.weldDate ?? '',
          requestName: row[method.requestKey] ?? '',
          controlMethod: method.code,
          controlDate,
          result,
          conclusionName,
        },
      ]
    }),
  )
}
