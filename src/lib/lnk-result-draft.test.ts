import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLnkResultDraftById, getEffectiveLnkResultDraftValueForRow } from '@/lib/lnk-result-draft'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'

describe('LNK result draft retains facts', () => {
  it.each(['vikRequest', 'rkRequest', 'uzkRequest', 'pvkRequest'] as const)('does not clear or replace a forbidden result for %s', (methodKey) => {
    const row = { id: 1, joint: 'F1R2', d1: 57 } as WeldRow
    const draft = { ...createDefaultLnkResultDraft(), methodKey, result: 'ремонт' }
    expect(getEffectiveLnkResultDraftValueForRow(row, draft)).toBe('ремонт')
    expect(buildLnkResultDraftById([row], draft)).toEqual({ 1: 'ремонт' })
    expect(buildLnkResultDraftById([row], { ...draft, rowResults: { 1: 'вырез' } })).toEqual({ 1: 'вырез' })
  })
})
