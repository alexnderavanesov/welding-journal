import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLineSummary } from '@/lib/line-summary'
import { buildStatisticsServerResult } from '@/lib/statistics-server-summary'
import { buildStatisticsSummary } from '@/lib/statistics-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { buildWeldingDynamics } from '@/lib/welding-dynamics'

describe('buildStatisticsServerResult', () => {
  it('keeps the existing statistics formulas while removing source rows from the response', () => {
    const rows = [
      makeRow(1, { projectTitle: 'Проект А', subtitleCode: '400', joint: 'F1', wdi: '2.5' }),
      makeRow(2, { projectTitle: 'Проект А', subtitleCode: '500', joint: 'S2', wdi: '1.5', rkResult: 'вырез' }),
      makeRow(3, { projectTitle: 'Проект Б', subtitleCode: '600', joint: 'F3', wdi: '3' }),
    ]
    const request = {
      tab: 'general' as const,
      projectFilter: 'проект а',
      selectedSubtitles: ['400', '500'],
      from: '2026-07-01',
      to: '2026-07-31',
      unit: 'wdi' as const,
      jointFilter: 'all' as const,
      periodMode: 'events' as const,
    }
    const scopedRows = rows.slice(0, 2)
    const expectedSummary = buildStatisticsSummary(scopedRows, request.from, request.to, request.unit, request.periodMode)
    const expectedDynamics = buildWeldingDynamics(expectedSummary.periodRows, request.from, request.to, request.unit)
    const expectedProgress = buildLineSummary(scopedRows, request.unit, DEFAULT_SYSTEM_INDEX_SETTINGS)

    const result = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      request,
    })

    expect(result.summary).toEqual({ ...expectedSummary, periodRows: [] })
    expect(result.weldingDynamics).toEqual(expectedDynamics)
    expect(result.generalProgressSummary).toEqual(expectedProgress)
    expect(result.projectOptions.map((option) => option.label)).toEqual(['Проект А', 'Проект Б'])
    expect(result.subtitleOptions.map((option) => option.label)).toEqual(['400', '500'])
  })

  it('calculates more than 5000 rows without returning them to the browser', () => {
    const rows = Array.from({ length: 5_501 }, (_, index) =>
      makeRow(index + 1, {
        joint: `F${index + 1}`,
        wdi: '1',
      }),
    )

    const result = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      request: {
        tab: 'general',
        from: '2026-07-01',
        to: '2026-07-31',
        unit: 'joints',
      },
    })

    expect(result.summary.totalRows).toBe(5_501)
    expect(result.summary.periodRows).toEqual([])
    expect(result.generalProgressSummary.total).toBe(5_501)
  })

  it('returns aggregate percentage-line data and keeps detailed rows server-side', () => {
    const rows = Array.from({ length: 5_101 }, (_, index) =>
      makeRow(index + 1, {
        joint: `S${index + 1}`,
        weldControlPercent: '10',
        stamp1K: 'ABC1',
      }),
    )

    const result = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      request: {
        tab: 'percentageLines',
        unit: 'joints',
      },
    })

    expect(result.percentageLineSummary).toHaveLength(1)
    expect(result.percentageLineSummary[0].rowCount).toBe(5_101)
    expect(result.percentageLineSummary[0].rows).toEqual([])
    expect(result.percentageLineSummary[0].stamps[0].officialJointCount).toBe(5_101)
  })

  it('uses configured chain suffixes in every statistics tab', () => {
    const systemIndexSettings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      shopJoint: 'A',
      fieldJoint: 'B',
      repair: 'C',
      cutout: 'D',
      coil: 'E',
    }
    const rows = [
      makeRow(1, { joint: 'B1', weldDate: '2026-07-14' }),
      makeRow(2, { joint: 'B1C1', weldDate: '2026-07-15' }),
    ]

    const result = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings,
      request: {
        tab: 'general',
        from: '2026-07-01',
        to: '2026-07-31',
        unit: 'joints',
      },
    })

    expect(result.summary.completedRepairs).toBe(1)
    expect(result.generalProgressSummary.total).toBe(1)
  })

  it('does not count a configured repeated joint as a primary percentage-line rejection', () => {
    const systemIndexSettings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      shopJoint: 'A',
      fieldJoint: 'B',
      repair: 'C',
      cutout: 'D',
      coil: 'E',
    }
    const rows = [
      makeRow(1, {
        joint: 'B1C1',
        weldControlPercent: '10',
        stamp1K: 'ABC1',
        rkResult: 'ремонт',
      }),
    ]

    const result = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings,
      request: { tab: 'percentageLines', unit: 'joints' },
    })

    expect(result.percentageLineSummary[0].stamps[0].rejectedPrimaryControls).toBe(0)
  })
})

function makeRow(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'LIN-001',
    joint: `F${id}`,
    weldDate: '2026-07-15',
    weldControlPercent: '100',
    revisionActuality: 'актуален',
    vikResult: 'годен',
    finalStatus: 'годен',
    ...overrides,
  }
}
