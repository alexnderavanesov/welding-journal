import { describe, expect, it } from 'vitest'

import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildWeldBatchUpdatePayload, toDbInsert } from '@/server/weld-persistence'

describe('weld persistence', () => {
  it('writes officiality only to its final database column', () => {
    const populated = toDbInsert({ officiality: 'неофициальный' })
    const empty = toDbInsert({ officiality: null })

    expect(populated).toMatchObject({ officiality: 'неофициальный' })
    expect(populated).not.toHaveProperty('legacyStatus')
    expect(empty).toMatchObject({ officiality: null })
    expect(empty).not.toHaveProperty('legacyStatus')
  })

  it('writes assignment values in their canonical storage form', () => {
    expect(toDbInsert({ pstoRequired: ' Да ', hasVik: 'ДА', hasRk: 'Нет' })).toMatchObject({
      pstoRequired: 'да',
      hasVik: 'да',
      hasRk: null,
    })
    expect(toDbInsert({ pstoRequired: '0' }).pstoRequired).toBeNull()
  })

  it('does not persist a line-inherited pre-TO exemption in batch updates', () => {
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
    ).preHeatTreatmentLnkExempt).toBe(false)
  })

  it('does not revoke an existing exemption through an ordinary batch save', () => {
    const previous = {
      id: 2,
      joint: 'F2',
      pstoRequest: 'Историческая заявка ПСТО',
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

  it('persists officiality in batch updates without a compatibility column', () => {
    const previous = {
      id: 3,
      officiality: null,
      preHeatTreatmentLnkExempt: false,
    } as WeldJoint
    const record = {
      ...previous,
      officiality: 'неофициальный',
    } as unknown as WeldRow

    const payload = buildWeldBatchUpdatePayload(
      record,
      new Map([[previous.id, previous]]),
      new Date('2026-09-02T00:00:00.000Z'),
    )

    expect(payload).toMatchObject({ officiality: 'неофициальный' })
    expect(payload).not.toHaveProperty('legacyStatus')
  })
})
