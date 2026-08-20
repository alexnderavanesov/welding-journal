import { describe, expect, it } from 'vitest'
import { loadWeldSnapshot, sortWeldSnapshotRows } from '@/lib/weld-snapshot'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildHeatTreatmentReportRows, buildLnkReportRows } from '@/lib/report-row-utils'
import { buildStatisticsSummary } from '@/lib/statistics-summary'

describe('full weld snapshot', () => {
  it('loads every batch beyond the former 5000-row boundary', async () => {
    const sourceRows = Array.from({ length: 5_501 }, (_, index) => row(index + 1))
    const requestedCursors: number[] = []

    const result = await loadWeldSnapshot({
      fetchPage: async (afterId) => {
        requestedCursors.push(afterId)
        const rows = sourceRows.filter((candidate) => candidate.id > afterId).slice(0, 1_000)
        return {
          rows,
          hasMore: rows.length === 1_000,
          nextAfterId: rows.length === 1_000 ? rows[rows.length - 1].id : null,
        }
      },
    })

    expect(result).toHaveLength(5_501)
    expect(new Set(result.map((candidate) => candidate.id)).size).toBe(5_501)
    expect(requestedCursors).toEqual([0, 1_000, 2_000, 3_000, 4_000, 5_000])
    expect(buildLnkReportRows(result)).toHaveLength(5_501)
    expect(buildHeatTreatmentReportRows(result)).toHaveLength(5_501)
    expect(buildStatisticsSummary(result, '', '', 'joints').totalRows).toBe(5_501)
  })

  it('rejects a non-advancing cursor instead of looping forever', async () => {
    await expect(
      loadWeldSnapshot({
        fetchPage: async () => ({
          rows: [row(1)],
          hasMore: true,
          nextAfterId: 0,
        }),
      }),
    ).rejects.toThrow('некорректный курсор')
  })

  it('restores welding journal order after ID-based batch loading', () => {
    const result = sortWeldSnapshotRows([
      row(1, { createdAt: '2026-08-01T10:00:00.000Z', weldDate: '2026-07-01', line: 'LIN-2', joint: 'F2' }),
      row(2, { createdAt: '2026-08-02T10:00:00.000Z', weldDate: '2026-07-01', line: 'LIN-1', joint: 'F1' }),
      row(3, { createdAt: '2026-08-01T10:00:00.000Z', weldDate: '2026-07-02', line: 'LIN-1', joint: 'F3' }),
    ])

    expect(result.map((candidate) => candidate.id)).toEqual([2, 3, 1])
  })
})

function row(id: number, values: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    weldDate: '2026-08-01',
    hasVik: 'да',
    pstoRequired: 'да',
    ...values,
  } as WeldRow
}
