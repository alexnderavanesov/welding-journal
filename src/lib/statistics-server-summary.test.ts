import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLineSummary } from '@/lib/line-summary'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { buildStatisticsServerResult } from '@/lib/statistics-server-summary'
import { buildStatisticsSummary } from '@/lib/statistics-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { prepareReportRows } from '@/lib/use-report-rows'
import { getPercentageLineNewWelderWarningKey } from '@/lib/percentage-line-summary'
import { buildWeldingDynamics } from '@/lib/welding-dynamics'

describe('buildStatisticsServerResult', () => {
  it('uses the current system WDI rule for stored rows before building statistics', () => {
    const rows = prepareReportRows(
      [
        makeRow(1, { connectionType: 'С17', d1: 50.8, d2: 101.6, wdi: 2 }),
        makeRow(2, { connectionType: 'У17', d1: 50.8, d2: 101.6, wdi: 4 }),
      ],
      [],
      undefined,
      undefined,
      { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'formula' },
    )

    expect(rows.map((row) => row.wdi)).toEqual([4, 2])
    const result = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      request: { tab: 'general', unit: 'wdi' },
    })
    expect(result.summary.totalRows).toBe(6)
  })

  it('keeps the existing statistics formulas while removing source rows from the response', () => {
    const rows = [
      makeRow(1, { projectTitle: 'Проект А', subtitleCode: '400', joint: 'F1', wdi: '2.5', hasVik: 'да' }),
      makeRow(2, { projectTitle: 'Проект А', subtitleCode: '500', joint: 'S2', wdi: '1.5', hasVik: 'да', hasRk: 'да', rkResult: 'вырез' }),
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
    }
    const scopedRows = rows.slice(0, 2)
    const expectedSummary = buildStatisticsSummary(scopedRows, request.from, request.to, request.unit)
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
    expect(result.generalStateRowIds.good).toEqual([1])
    expect(result.generalStateRowIds.rejected).toEqual([2])
    expect(result.projectOptions.map((option) => option.label)).toEqual(['Проект А', 'Проект Б'])
    expect(result.subtitleOptions.map((option) => option.label)).toEqual(['400', '500'])
  })

  it('passes the selected welding dynamics scale through the server summary', () => {
    const result = buildStatisticsServerResult({
      rows: [
        makeRow(1, { weldDate: '2026-07-01', wdi: '2' }),
        makeRow(2, { weldDate: '2026-07-10', wdi: '3' }),
      ],
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      request: {
        tab: 'general',
        from: '2026-07-01',
        to: '2026-07-31',
        unit: 'wdi',
        weldingDynamicsScale: 'month',
      },
    })

    expect(result.weldingDynamics.bucketUnit).toBe('month')
    expect(result.weldingDynamics.buckets).toHaveLength(1)
    expect(result.weldingDynamics.totalValue).toBe(5)
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

  it('returns PSTO event metrics and clickable state ids for the separate PSTO tab', () => {
    const rows = [
      makeRow(1, {
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-001',
        pstoRequestDate: '2026-07-16',
        pstoDate: '2026-07-17',
        pstoResult: 'проведено',
      }),
      makeRow(2, { pstoRequired: 'да', pstoRequest: '', pstoResult: '' }),
      makeRow(3, { hasVik: 'да', vikResult: 'годен', pstoRequired: '' }),
    ]

    const result = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      request: {
        tab: 'psto',
        from: '2026-07-01',
        to: '2026-07-31',
        unit: 'joints',
      },
    })

    expect(result.summary.pstoRequests).toBe(1)
    expect(result.summary.pstoClosed).toBe(1)
    expect(result.summary.pstoMethod.rowIds.closed).toEqual([1])
    expect(result.summary.pstoMethod.rowIds.waitingRequest).toEqual([2])
    expect(result.generalStateRowIds.good).toContain(3)
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

  it('passes accepted new-welder warnings into the potential control reduction calculation', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      makeRow(index + 1, {
        joint: `S${index + 1}`,
        weldControlPercent: '10',
        stamp1K: index < 5 ? 'AAA1' : 'BBB2',
        hasRk: index === 0 || index === 1 || index === 5 || index === 6 ? 'да' : '',
      }),
    )
    const request = { tab: 'percentageLines' as const, unit: 'joints' as const }
    const initial = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      request,
    })
    const acceptedStamp = initial.percentageLineSummary[0].stamps.find((stamp) => stamp.stamp === 'BBB2')

    expect(initial.percentageLineSummary[0].potentialControlReduction).toBe(1)
    expect(acceptedStamp).toBeDefined()

    const accepted = buildStatisticsServerResult({
      rows,
      welderStamps: [],
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      acceptedDispatcherWarningKeys: new Set([
        getPercentageLineNewWelderWarningKey(acceptedStamp?.key ?? ''),
      ]),
      request,
    })

    expect(accepted.percentageLineSummary[0].potentialControlReduction).toBe(0)
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
    expect(result.weldingDynamics.jointTypes).toEqual([
      { key: 's', code: 'A', label: 'A · база', value: 0 },
      { key: 'f', code: 'B', label: 'B · поле', value: 2 },
    ])
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
