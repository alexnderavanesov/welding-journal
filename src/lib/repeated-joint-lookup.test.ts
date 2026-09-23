import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'
import { buildRepeatedJointLookup } from '@/lib/repeated-joint-lookup'

describe('repeated joint lookup', () => {
  it('matches targets using the same compact identity and skips the source row', () => {
    const rows = [
      row(1, 'F 1', 'неофициальный'),
      row(2, 'F1', null),
      row(3, 'F1R1', null),
    ]
    const lookup = buildRepeatedJointLookup(rows, rejectedResult)

    expect(lookup.findRepeatedJointTarget(rows[0]!, 'F 1')?.id).toBe(2)
    expect(lookup.findRepeatedJointTarget(rows[1]!, 'F1R1')?.id).toBe(3)
    expect(lookup.findRepeatedJointTarget(rows[2]!, 'F1R2')).toBeNull()
  })

  it('returns a pre-sorted official rejected branch without rescanning all rows', () => {
    const rows = [
      { ...row(3, 'F1R2', null), rkResult: 'вырез' },
      { ...row(1, 'F1', null), rkResult: 'ремонт' },
      { ...row(2, 'F1R1', 'неофициальный'), rkResult: 'ремонт' },
    ]
    const lookup = buildRepeatedJointLookup(rows, rejectedResult)

    expect(lookup.getOfficialRejectedJointChainRows(rows[0]!, 'F1R2').map((item) => item.id))
      .toEqual([1, 3])
    expect(lookup.getRejectedJointChainRows(rows[0]!, 'F1R2').map((item) => item.id))
      .toEqual([1, 2, 3])
  })
})

function row(id: number, joint: string, officiality: string | null): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'Линия 1',
    joint,
    officiality,
    weldDate: `2026-01-0${Math.min(id, 9)}`,
  }
}

function rejectedResult(row: WeldInput) {
  const result = String(row.rkResult ?? '').toLowerCase()
  return result === 'ремонт' || result === 'вырез' ? { result } : null
}
