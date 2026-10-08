import { describe, expect, it } from 'vitest'
import { getStatisticalMaterialGroup, getWeldMaterialGroupsError, normalizeWeldMaterialGroups } from './weld-material-groups'
import { buildWeldingDynamics } from './welding-dynamics'
import { buildWelderStatisticsSummary } from './welder-statistics-summary'
import { recordsToExportRows } from './weld-record-transforms'
import { buildWeldDataUsageSummaryFromRows } from '@/server/weld-read'

describe('ordered material groups', () => {
  it('keeps side order and single groups without introducing duplicate groups', () => {
    expect(normalizeWeldMaterialGroups(' м05+м01 ')).toBe('М05 + М01')
    expect(normalizeWeldMaterialGroups('М01')).toBe('М01')
    expect(normalizeWeldMaterialGroups('М01 + М01')).toBe('М01')
    expect(getStatisticalMaterialGroup('М11 + М05')).toBe('М05 + М11')
    expect(getStatisticalMaterialGroup('М11 + М01')).toBe('М01 + М11')
  })
  it.each(['М01 + М05 + М11', 'М01 +', '+ М05', 'М01 ++ М05'])('rejects malformed or excessive groups: %s', value => {
    expect(getWeldMaterialGroupsError(value, ['М01', 'М05', 'М11'])).toBeTruthy()
  })
  it('checks each code without converting Latin lookalikes or inventing unconfigured combinations', () => {
    expect(getWeldMaterialGroupsError('М05 + М01', ['М01', 'М05'])).toBeNull()
    expect(getWeldMaterialGroupsError('M01 + М05', ['М01', 'М05'])).toContain('M01')
    expect(getWeldMaterialGroupsError('М01, М05', ['М01', 'М05'])).toBeTruthy()
  })
  it('merges only statistical categories without doubling values or changing/exporting reordered joint data', () => {
    const rows = ['М05 + М01', 'М01 + М05', 'М01'].map((materialGroup, index) => ({ id: index + 1, joint: `F${index + 1}`, materialGroup, weldDate: '2026-07-01', wdi: '10', stamp1KFact: 'AAAA', stamp1ZFact: 'AAAA', stamp1OFact: 'AAAA' }))
    const before = structuredClone(rows)
    const dynamics = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'wdi')
    expect(dynamics.totalValue).toBe(30)
    expect(dynamics.materialGroups).toEqual([{ key: 'М01 + М05', label: 'М01 + М05', value: 20 }, { key: 'М01', label: 'М01', value: 10 }])
    const welders = buildWelderStatisticsSummary(rows, [], '2026-07-01', '2026-07-01', 'wdi')
    expect(welders.rows[0].materialGroups).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'М01 + М05', total: 20 })]))
    expect(recordsToExportRows(rows).map(row => row['Группа материалов'])).toEqual(['М05 + М01', 'М01 + М05', 'М01'])
    expect(new Map(buildWeldDataUsageSummaryFromRows(rows).materialGroups)).toEqual(new Map([['М01', 3], ['М05', 2]]))
    expect(rows).toEqual(before)
  })
})
