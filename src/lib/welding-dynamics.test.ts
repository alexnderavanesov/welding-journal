import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import {
  buildWeldingDynamics,
  formatWeldingDynamicsBucketHeaderLabel,
  getStableWeldingDynamicsColorIndex,
} from '@/lib/welding-dynamics'

describe('buildWeldingDynamics', () => {
  it('keeps dimension colors stable when the surrounding group order changes', () => {
    const original = getStableWeldingDynamicsColorIndex('Проект Альфа', 6)
    expect(getStableWeldingDynamicsColorIndex('Проект Альфа', 6)).toBe(original)
    expect(getStableWeldingDynamicsColorIndex('  ПРОЕКТ АЛЬФА  ', 6)).toBe(original)
    expect(getStableWeldingDynamicsColorIndex('Проект Альфа', 0)).toBe(0)
  })

  it('formats compact day and week headings for chart columns', () => {
    const daily = buildWeldingDynamics([], '2026-08-11', '2026-08-11', 'wdi')
    const weekly = buildWeldingDynamics([], '2026-08-01', '2026-09-30', 'wdi')

    expect(formatWeldingDynamicsBucketHeaderLabel(daily.buckets[0]!, daily.bucketUnit)).toBe('11.08 Вт')
    expect(formatWeldingDynamicsBucketHeaderLabel(weekly.buckets[0]!, weekly.bucketUnit)).toBe('01.08–07.08')
  })

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
    expect(summary.welderShiftCount).toBe(3)
    expect(summary.averageWeldersPerShift).toBe(1)
    expect(summary.averageValuePerWelderShift).toBe(1)
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

  it('calculates production per welder-shift from daily factual stamp participation', () => {
    const rows = [
      row({ id: 1, weldDate: '2026-07-01', wdi: '2', stamp1KFact: 'F1' }),
      row({ id: 2, weldDate: '2026-07-01', wdi: '4', stamp1KFact: 'F1', stamp1OFact: 'F2' }),
      row({ id: 3, weldDate: '2026-07-02', wdi: '4', stamp1KFact: 'F1' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-02', 'wdi')

    expect(summary.totalValue).toBe(10)
    expect(summary.totalWelders).toBe(2)
    expect(summary.welderShiftCount).toBe(3)
    expect(summary.averageWeldersPerShift).toBe(1.5)
    expect(summary.averageValuePerWelderShift).toBeCloseTo(10 / 3)
    expect(summary.buckets.map((bucket) => bucket.welderShiftCount)).toEqual([2, 1])
    expect(summary.buckets.map((bucket) => bucket.valuePerWelderShift)).toEqual([3, 4])
  })

  it('keeps per-welder production finite when the period has no factual stamps', () => {
    const summary = buildWeldingDynamics(
      [row({ id: 1, weldDate: '2026-07-01', wdi: '5' })],
      '2026-07-01',
      '2026-07-01',
      'wdi',
    )

    expect(summary.totalValue).toBe(5)
    expect(summary.welderShiftCount).toBe(0)
    expect(summary.averageValuePerWelderShift).toBe(0)
    expect(summary.buckets[0]?.valuePerWelderShift).toBe(0)
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

  it('groups dynamics by project with the same F/S and welder metrics', () => {
    const rows = [
      row({ id: 1, joint: 'F1', weldDate: '2026-07-01', projectTitle: 'Проект А', wdi: '2', stamp1KFact: 'W1' }),
      row({ id: 2, joint: 'S2', weldDate: '2026-07-01', projectTitle: 'Проект А', wdi: '1', stamp1KFact: 'W2' }),
      row({ id: 3, joint: 'F3', weldDate: '2026-07-01', projectTitle: 'Проект Б', wdi: '3', stamp1KFact: 'W1' }),
      row({ id: 4, joint: 'S4', weldDate: '2026-07-01', projectTitle: '', wdi: '1', stamp1KFact: 'W3' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'wdi')

    expect(summary.projectGroups).toEqual([
      { key: 'Проект А', label: 'Проект А', value: 3 },
      { key: 'Проект Б', label: 'Проект Б', value: 3 },
      { key: '__missing_project_group__', label: 'Не указан', value: 1 },
    ])
    expect(summary.buckets[0]?.projectGroups).toEqual(summary.projectGroups)
    expect(summary.projectJointTypes.map((group) => ({
      label: group.label,
      jointTypes: group.jointTypes.map((jointType) => [jointType.key, jointType.value]),
      welderCount: group.welderCount,
      welderShiftCount: group.welderShiftCount,
      valuePerWelderShift: group.valuePerWelderShift,
    }))).toEqual([
      { label: 'Проект А', jointTypes: [['s', 1], ['f', 2]], welderCount: 2, welderShiftCount: 2, valuePerWelderShift: 1.5 },
      { label: 'Проект Б', jointTypes: [['f', 3]], welderCount: 1, welderShiftCount: 1, valuePerWelderShift: 3 },
      { label: 'Не указан', jointTypes: [['s', 1]], welderCount: 1, welderShiftCount: 1, valuePerWelderShift: 1 },
    ])
  })

  it('splits every bucket by joint type and keeps S below F in chart order', () => {
    const rows = [
      row({ id: 1, joint: 'S1', weldDate: '2026-07-01', materialGroup: 'М01', wdi: '1.5' }),
      row({ id: 2, joint: 'F2', weldDate: '2026-07-01', materialGroup: 'М01', wdi: '2' }),
      row({ id: 3, joint: 'F2R1', weldDate: '2026-07-01', materialGroup: 'М11', wdi: '3' }),
      row({ id: 4, joint: 'X4', weldDate: '2026-07-01', materialGroup: 'М11', wdi: '0.5' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'wdi')

    expect(summary.totalValue).toBe(7)
    expect(summary.jointTypes.map((type) => [type.key, type.value])).toEqual([
      ['s', 1.5],
      ['unknown', 0.5],
      ['f', 5],
    ])
    expect(summary.buckets[0]?.jointTypes).toEqual(summary.jointTypes)
    expect(summary.materialJointTypes).toEqual([
      {
        key: 'М01',
        label: 'М01',
        value: 3.5,
        welderCount: 0,
        welderShiftCount: 0,
        valuePerWelderShift: 0,
        jointTypes: [
          { key: 's', code: 'S', label: 'S · база', value: 1.5 },
          { key: 'f', code: 'F', label: 'F · поле', value: 2 },
        ],
      },
      {
        key: 'М11',
        label: 'М11',
        value: 3.5,
        welderCount: 0,
        welderShiftCount: 0,
        valuePerWelderShift: 0,
        jointTypes: [
          { key: 'unknown', code: '—', label: 'Тип не определен', value: 0.5 },
          { key: 'f', code: 'F', label: 'F · поле', value: 3 },
        ],
      },
    ])
  })

  it('counts welders and welder-shifts separately for every material group', () => {
    const rows = [
      row({ id: 1, joint: 'S1', weldDate: '2026-07-01', materialGroup: 'М01', wdi: '2', stamp1KFact: 'F1' }),
      row({ id: 2, joint: 'F2', weldDate: '2026-07-01', materialGroup: 'М01', wdi: '4', stamp1KFact: 'F1', stamp1OFact: 'F2' }),
      row({ id: 3, joint: 'F3', weldDate: '2026-07-02', materialGroup: 'М01', wdi: '3', stamp1KFact: 'F1' }),
      row({ id: 4, joint: 'F4', weldDate: '2026-07-02', materialGroup: 'М11', wdi: '5', stamp1KFact: 'F1' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-02', 'wdi')

    expect(summary.materialJointTypes.map((group) => ({
      label: group.label,
      welderCount: group.welderCount,
      welderShiftCount: group.welderShiftCount,
      valuePerWelderShift: group.valuePerWelderShift,
    }))).toEqual([
      { label: 'М01', welderCount: 2, welderShiftCount: 3, valuePerWelderShift: 3 },
      { label: 'М11', welderCount: 1, welderShiftCount: 1, valuePerWelderShift: 5 },
    ])
    expect(summary.buckets.map((bucket) => bucket.materialJointTypes.map((group) => ({
      label: group.label,
      welderCount: group.welderCount,
      welderShiftCount: group.welderShiftCount,
    })))).toEqual([
      [{ label: 'М01', welderCount: 2, welderShiftCount: 2 }],
      [
        { label: 'М01', welderCount: 1, welderShiftCount: 1 },
        { label: 'М11', welderCount: 1, welderShiftCount: 1 },
      ],
    ])
  })

  it('uses configured shop and field letters in the joint-type split', () => {
    const rows = [
      row({ id: 1, joint: 'A1', weldDate: '2026-07-01' }),
      row({ id: 2, joint: 'B2C1', weldDate: '2026-07-01' }),
    ]
    const settings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      shopJoint: 'A',
      fieldJoint: 'B',
      repair: 'C',
      cutout: 'D',
      coil: 'E',
    }

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'joints', settings)

    expect(summary.jointTypes).toEqual([
      { key: 's', code: 'A', label: 'A · база', value: 1 },
      { key: 'f', code: 'B', label: 'B · поле', value: 1 },
    ])
  })

  it('keeps both known joint types in the period summary when one has zero value', () => {
    const summary = buildWeldingDynamics(
      [row({ id: 1, joint: 'F1', weldDate: '2026-07-01' })],
      '2026-07-01',
      '2026-07-01',
      'joints',
    )

    expect(summary.jointTypes).toEqual([
      { key: 's', code: 'S', label: 'S · база', value: 0 },
      { key: 'f', code: 'F', label: 'F · поле', value: 1 },
    ])
    expect(summary.buckets[0]?.jointTypes).toEqual([
      { key: 'f', code: 'F', label: 'F · поле', value: 1 },
    ])
  })

  it('combines minor material groups when the legend would be too large', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      row({
        id: index + 1,
        weldDate: '2026-07-01',
        materialGroup: `М${String(index + 1).padStart(2, '0')}`,
        stamp1KFact: index >= 6 ? 'F1' : `F${index + 2}`,
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
    expect(summary.materialJointTypes.at(-1)).toMatchObject({
      key: '__other_material_groups__',
      welderCount: 1,
      welderShiftCount: 1,
      valuePerWelderShift: 2,
    })
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

  it('uses a manually selected scale without changing period totals', () => {
    const rows = [
      row({ id: 1, weldDate: '2026-07-01', wdi: '2', stamp1KFact: 'F1' }),
      row({ id: 2, weldDate: '2026-07-10', wdi: '3', stamp1KFact: 'F2' }),
    ]

    const daily = buildWeldingDynamics(
      rows,
      '2026-07-01',
      '2026-07-31',
      'wdi',
      DEFAULT_SYSTEM_INDEX_SETTINGS,
      'day',
    )
    const monthly = buildWeldingDynamics(
      rows,
      '2026-07-01',
      '2026-07-31',
      'wdi',
      DEFAULT_SYSTEM_INDEX_SETTINGS,
      'month',
    )

    expect(daily.bucketUnit).toBe('day')
    expect(daily.buckets).toHaveLength(31)
    expect(monthly.bucketUnit).toBe('month')
    expect(monthly.buckets).toHaveLength(1)
    expect(monthly.buckets[0]).toMatchObject({ value: 5, weldedJoints: 2, welderCount: 2 })
    expect(monthly.totalValue).toBe(daily.totalValue)
    expect(monthly.welderShiftCount).toBe(daily.welderShiftCount)
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    joint: values.joint ?? '',
    weldDate: values.weldDate ?? '',
    wdi: values.wdi ?? '',
    projectTitle: values.projectTitle ?? '',
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
