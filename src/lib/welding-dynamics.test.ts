import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildWeldingDynamics } from '@/lib/welding-dynamics'

describe('buildWeldingDynamics', () => {
  it('groups a short period by days and counts factual welders', () => {
    const rows = [
      row({ id: 1, weldDate: '2026-07-01', wdi: '1,5', stamp1KFact: 'F1', stamp1ZFact: 'F1', stamp1OFact: 'F2', stamp1K: 'OFF1' }),
      row({ id: 2, weldDate: '2026-07-01', wdi: '2', stamp1KFact: 'F2', stamp1ZFact: 'F3', stamp1OFact: 'F3', stamp1K: 'OFF2' }),
      row({ id: 3, weldDate: '2026-07-02', wdi: '3', stamp1K: 'OFF3' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-03', 'joints')

    expect(summary.bucketUnit).toBe('day')
    expect(summary.buckets.map((bucket) => bucket.weldedJoints)).toEqual([2, 1, 0])
    expect(summary.buckets.map((bucket) => bucket.welderCount)).toEqual([3, 0, 0])
    expect(summary.periodDays).toBe(3)
    expect(summary.totalWelders).toBe(3)
  })

  it('uses WDI as production value when WDI unit is selected', () => {
    const rows = [
      row({ id: 1, weldDate: '2026-07-01', wdi: '1,5', materialGroup: 'М01', stamp1KFact: 'F1' }),
      row({ id: 2, weldDate: '2026-07-01', wdi: '2.25', materialGroup: 'М11', stamp1KFact: 'F2' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'wdi')

    expect(summary.buckets[0]?.value).toBe(3.75)
    expect(summary.buckets[0]?.weldedJoints).toBe(2)
    expect(summary.materialGroups).toEqual([
      { key: 'М11', label: 'М11', value: 2.25 },
      { key: 'М01', label: 'М01', value: 1.5 },
    ])
    expect(summary.buckets[0]?.materialGroups).toEqual(summary.materialGroups)
  })

  it('keeps an empty material group separate in joint units', () => {
    const rows = [
      row({ id: 1, weldDate: '2026-07-01', materialGroup: 'М01' }),
      row({ id: 2, weldDate: '2026-07-01', materialGroup: '' }),
      row({ id: 3, weldDate: '2026-07-02', materialGroup: 'М01' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-02', 'joints')

    expect(summary.materialGroups).toEqual([
      { key: 'М01', label: 'М01', value: 2 },
      { key: '__missing_material_group__', label: 'Не указано', value: 1 },
    ])
    expect(summary.buckets[0]?.materialGroups.map((group) => [group.label, group.value])).toEqual([
      ['М01', 1],
      ['Не указано', 1],
    ])
  })

  it('combines minor material groups when the legend would be too large', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      row({
        id: index + 1,
        weldDate: '2026-07-01',
        materialGroup: `М${String(index + 1).padStart(2, '0')}`,
      }),
    )

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'joints')

    expect(summary.materialGroups).toHaveLength(7)
    expect(summary.materialGroups.at(-1)).toEqual({
      key: '__other_material_groups__',
      label: 'Прочие',
      value: 2,
    })
    expect(summary.buckets[0]?.materialGroups.at(-1)?.value).toBe(2)
  })

  it('keeps the largest groups visible when every group is below the significance threshold', () => {
    const rows = Array.from({ length: 40 }, (_, index) =>
      row({
        id: index + 1,
        weldDate: '2026-07-01',
        materialGroup: `М${String(index + 1).padStart(2, '0')}`,
      }),
    )

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'joints')

    expect(summary.materialGroups).toHaveLength(7)
    expect(summary.materialGroups.slice(0, 6).map((group) => group.label)).toEqual([
      'М01',
      'М02',
      'М03',
      'М04',
      'М05',
      'М06',
    ])
    expect(summary.materialGroups.at(-1)).toEqual({
      key: '__other_material_groups__',
      label: 'Прочие',
      value: 34,
    })
  })

  it('switches to larger buckets for long periods', () => {
    const summary = buildWeldingDynamics([], '2026-01-01', '2026-12-31', 'joints')

    expect(summary.bucketUnit).toBe('month')
    expect(summary.buckets).toHaveLength(12)
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    weldDate: values.weldDate ?? '',
    wdi: values.wdi ?? '',
    materialGroup: values.materialGroup ?? '',
    stamp1K: values.stamp1K ?? '',
    stamp1Z: values.stamp1Z ?? '',
    stamp1O: values.stamp1O ?? '',
    stamp2K: values.stamp2K ?? '',
    stamp2Z: values.stamp2Z ?? '',
    stamp2O: values.stamp2O ?? '',
    stamp1KFact: values.stamp1KFact ?? '',
    stamp1ZFact: values.stamp1ZFact ?? '',
    stamp1OFact: values.stamp1OFact ?? '',
    stamp2KFact: values.stamp2KFact ?? '',
    stamp2ZFact: values.stamp2ZFact ?? '',
    stamp2OFact: values.stamp2OFact ?? '',
  } as WeldRow
}
