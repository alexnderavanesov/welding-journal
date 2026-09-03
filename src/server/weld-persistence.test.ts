import { describe, expect, it } from 'vitest'

import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildWeldBatchUpdatePayload } from '@/server/weld-persistence'

describe('weld persistence', () => {
  it('persists a server-inherited pre-TO exemption in batch updates', () => {
    const previous = {
      id: 1,
      joint: 'F1',
      preHeatTreatmentLnkExempt: false,
    } as WeldJoint
    const record = {
      ...previous,
      line: 'Освобожденная линия',
      preHeatTreatmentLnkExempt: true,
    } as unknown as WeldRow

    expect(buildWeldBatchUpdatePayload(
      record,
      new Map([[previous.id, previous]]),
      new Date('2026-09-02T00:00:00.000Z'),
    ).preHeatTreatmentLnkExempt).toBe(true)
  })

  it('does not revoke an existing exemption through an ordinary batch save', () => {
    const previous = {
      id: 2,
      joint: 'F2',
      preHeatTreatmentLnkExempt: true,
    } as WeldJoint
    const record = {
      ...previous,
      preHeatTreatmentLnkExempt: false,
    } as unknown as WeldRow

    expect(buildWeldBatchUpdatePayload(
      record,
      new Map([[previous.id, previous]]),
      new Date('2026-09-02T00:00:00.000Z'),
    ).preHeatTreatmentLnkExempt).toBe(true)
  })
})
