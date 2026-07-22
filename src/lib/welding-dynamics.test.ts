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
      row({ id: 1, weldDate: '2026-07-01', wdi: '1,5', stamp1KFact: 'F1' }),
      row({ id: 2, weldDate: '2026-07-01', wdi: '2.25', stamp1KFact: 'F2' }),
    ]

    const summary = buildWeldingDynamics(rows, '2026-07-01', '2026-07-01', 'wdi')

    expect(summary.buckets[0]?.value).toBe(3.75)
    expect(summary.buckets[0]?.weldedJoints).toBe(2)
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
