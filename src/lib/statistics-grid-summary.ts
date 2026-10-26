import type { LineSummary, LineSummaryRow } from './line-summary'
import type { WelderStatisticsSummary, WelderStatisticsRow } from './welder-statistics-summary'

/** Sum already calculated contributions; never recalculate joint ownership after
 * hiding a welder or average the per-welder defect percentages. */
export function summarizeWelderGridRows(source: WelderStatisticsSummary, rows: WelderStatisticsRow[]): WelderStatisticsSummary {
  if (rows === source.rows) return source
  const result = { ...source, rows, totalWelders: rows.length }
  for (const key of ['total', 'good', 'waitingRequest', 'waitingControl', 'rejected',
    'fTotal', 'sTotal', 'fGood', 'sGood', 'fWaitingRequest', 'sWaitingRequest',
    'fWaitingControl', 'sWaitingControl', 'fRejected', 'sRejected'] as const) {
    result[key] = rows.reduce((sum, row) => sum + row[key], 0)
  }
  const controlled = result.good + result.rejected
  result.defectPercent = controlled > 0 ? result.rejected / controlled * 100 : 0
  return result
}

export function summarizeLineGridRows(source: LineSummary, rows: LineSummaryRow[]): LineSummary {
  if (rows === source.rows) return source
  return { rows, total: rows.reduce((sum, row) => sum + row.total, 0),
    completed: rows.reduce((sum, row) => sum + row.completed, 0),
    remaining: rows.reduce((sum, row) => sum + row.remaining, 0) }
}
