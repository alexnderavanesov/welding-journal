import { expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { removeTransferredPreHeatTreatmentControls } from './lnk-stage-transfer'

it.each([24, 200_000])('removes %i transferred controls with linear ID lookups, retaining unrelated history', count => {
  let reads = 0
  const controls = Array.from({ length: count }, (_, i) => ({
    get id() {
      if (++reads > count * 4) throw new Error('Quadratic transferred-control scan')
      return i + 1
    }, weldJointId: i + 1, method: 'ВИК', requestName: `P${i + 1}`,
  }))
  const rows = controls.map((control, i) => ({ id: i + 1,
    preHeatTreatmentControls: [control, { id: count + i + 1, weldJointId: i + 1, method: 'УЗК', result: 'годен' }],
  })) as WeldRow[]
  const next = removeTransferredPreHeatTreatmentControls(rows, controls)
  expect(reads).toBeLessThanOrEqual(count * 4)
  expect(next.every(row => row.preHeatTreatmentControls?.length === 1 && row.preHeatTreatmentControls[0].method === 'УЗК')).toBe(true)
  expect(rows.every(row => row.preHeatTreatmentControls?.length === 2)).toBe(true)
})
