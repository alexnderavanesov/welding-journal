import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import {
  getJointChainIdentityChangeBlockReason,
  normalizeWeldChainLineMovePlan,
} from '@/server/joint-chain-line-move-guard'

describe('normalizeWeldChainLineMovePlan', () => {
  it('normalizes a bounded plan received from the client', () => {
    expect(normalizeWeldChainLineMovePlan({
      expectedRowIds: ['1', 2],
      decisions: [{ rowId: '2', disposition: 'deletePrimary' }],
    })).toEqual({
      expectedRowIds: [1, 2],
      decisions: [{ rowId: 2, disposition: 'deletePrimary' }],
    })
  })

  it.each([
    null,
    {},
    { expectedRowIds: [], decisions: [] },
    { expectedRowIds: [1, 1], decisions: [] },
    { expectedRowIds: [1], decisions: [{ rowId: 2, disposition: 'deletePrimary' }] },
    { expectedRowIds: [1], decisions: [{ rowId: 1, disposition: 'unknown' }] },
    { expectedRowIds: Array.from({ length: 1_001 }, (_, index) => index + 1), decisions: [] },
  ])('rejects a malformed or unbounded plan', (value) => {
    expect(normalizeWeldChainLineMovePlan(value)).toBeNull()
  })
})

describe('getJointChainIdentityChangeBlockReason', () => {
  it('allows an ordinary line change for a standalone joint', () => {
    const source = row({ id: 1, joint: 'S1' })
    expect(getJointChainIdentityChangeBlockReason(
      { ...source, line: 'L2' },
      source,
      [source],
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toBe('')
  })

  it('blocks moving a base separately from its R/W/Y descendants', () => {
    const source = row({ id: 1, joint: 'S1' })
    const child = row({ id: 2, joint: 'S1Y1' })
    expect(getJointChainIdentityChangeBlockReason(
      { ...source, line: 'L2' },
      source,
      [source, child],
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toMatch(/карточку базового стыка S1.*все R\/W\/Y-стыки/)
  })

  it('blocks an orphaned child even when the other chain rows are missing', () => {
    const child = row({ id: 2, joint: 'S1Y1' })
    expect(getJointChainIdentityChangeBlockReason(
      { ...child, line: 'L2' },
      child,
      [child],
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toMatch(/цепочки S1.*базового стыка S1/)
  })

  it('keeps project, subtitle and joint-number edits blocked for a chain', () => {
    const source = row({ id: 1, joint: 'S1' })
    const child = row({ id: 2, joint: 'S1R1' })
    expect(getJointChainIdentityChangeBlockReason(
      { ...source, projectTitle: 'Другой проект' },
      source,
      [source, child],
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toMatch(/нельзя отдельно изменять проект, шифр или номер/)
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'L1',
    joint: 'S1',
    ...values,
  } as WeldRow
}
