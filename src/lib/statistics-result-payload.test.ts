import { describe, expect, it } from 'vitest'
import { packStatisticsResult, unpackStatisticsResult } from './statistics-result-payload'
import { buildStatisticsServerResult, type StatisticsTab } from './statistics-server-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import type { WeldRow } from './dispatcher-types'

const resultFor = (tab: StatisticsTab, rows: WeldRow[] = []) => buildStatisticsServerResult({ rows, welderStamps: [],
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, request: { tab, unit: 'joints' } })

describe('lossless statistics transport', () => {
  it.each<StatisticsTab>(['general', 'lnk', 'psto', 'supports', 'welders', 'lineSummary'])('round-trips every aggregate and drilldown on %s', tab => {
    const rows = [1, 2, 7].map(id => ({ preHeatTreatmentMode: 'allPsto' as const, id, projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Линия',
      joint: id === 7 ? 'ОП1' : `F${id}`, connectionType: id === 7 ? 'Т1' : 'С17', weldLength: '600.123456789',
      officiality: 'действующий', revisionActuality: 'актуальная', weldDate: '2026-10-01', stamp1KFact: 'A',
      hasVik: 'да', vikRequest: 'V', vikRequestDate: '2026-10-01', vikResult: 'годен', vikConclusion: 'C', vikConclusionDate: '2026-10-02',
      pstoRequired: 'нет' } as WeldRow))
    const result = resultFor(tab, rows), before = structuredClone(result)
    expect(unpackStatisticsResult(packStatisticsResult(result))).toEqual(result)
    expect(result).toEqual(before)
    expect(unpackStatisticsResult(result)).toBe(result)
  })

  it('preserves sparse order, duplicates, zero, maximum safe ID and independent arrays', () => {
    const result = resultFor('lnk')
    const ids = [9, 3, 4, 4, 0, 1, 2, 9999, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]
    result.generalStateRowIds.good = [...ids]
    result.generalStateRowIds.rejected = [...ids]
    const decoded = unpackStatisticsResult(packStatisticsResult(result))
    expect(decoded).toEqual(result)
    expect(decoded.generalStateRowIds.good).not.toBe(decoded.generalStateRowIds.rejected)
  })

  it('retains all 200000 IDs in each overlapping metric without per-ID wire nodes', () => {
    const result = resultFor('lnk'), ids = Array.from({ length: 200000 }, (_, n) => n + 1)
    const method = result.summary.methods[0]
    for (const key of ['requiredRequests', 'createdRequests', 'requests', 'closed', 'totalClosed', 'good'] as const) method.rowIds[key] = [...ids]
    result.generalStateRowIds.good = [...ids]
    const packed = packStatisticsResult(result)
    // This is a wire-size assertion, not an application row limit.
    expect(packed.data.length).toBeLessThan(JSON.stringify(result).length / 100)
    const decoded = unpackStatisticsResult(packed)
    expect(decoded).toEqual(result)
    for (const key of ['requiredRequests', 'createdRequests', 'requests', 'closed', 'totalClosed', 'good'] as const) {
      expect(decoded.summary.methods[0].rowIds[key]).toHaveLength(200000)
      expect(decoded.summary.methods[0].rowIds[key].at(-1)).toBe(200000)
    }
  })

  it('does not interpret arbitrary text or ordinary numeric totals as IDs', () => {
    const result = resultFor('general')
    result.projectOptions = [{ label: '~ids:1:zz', value: '~ids:3:2' }]
    result.summary.good = 10.125
    expect(unpackStatisticsResult(packStatisticsResult(result))).toEqual(result)
  })
})
