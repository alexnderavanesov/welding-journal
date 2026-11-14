import { expect, it } from 'vitest'
import { buildLnkResultRemovalBatch, normalizeLnkResultRemoval, type LnkResultRemovalRequest } from './lnk-result-removal-plan'
import { LNK_METHODS } from './lnk-report-config'

const target = { rowId: 1, methodKey: 'vikRequest' as const, expectedVersion: 'v1' }
it('rejects all extra edit fields at either boundary instead of silently accepting mixed edits', () => {
  for (const value of [
    { targets: [target], lnkNote: 'edit' },
    { targets: [{ ...target, lnkNote: 'edit' }] },
    { targets: [{ ...target, result: 'годен' }] },
    { targets: [target], records: [{ id: 1, vikResult: 'годен' }] },
  ]) expect(() => normalizeLnkResultRemoval(value)).toThrow('Недопустимые поля')
})
it('requires unambiguous target versions and real primary methods', () => {
  for (const value of [
    { targets: [] }, { targets: [target, target] },
    { targets: [target, { ...target, methodKey: 'rkRequest', expectedVersion: 'v2' }] },
    { targets: [{ ...target, expectedVersion: '' }] },
    { targets: [{ ...target, rowId: '1' }] },
    { targets: [{ ...target, methodKey: 'tvmtRequest' }] },
  ]) expect(() => normalizeLnkResultRemoval(value as LnkResultRemovalRequest)).toThrow()
})
it('merges selected methods while preserving requests, dates and every unrelated factual field', () => {
  const targets = LNK_METHODS.map(method => ({ ...target, methodKey: method.requestKey }))
  const batch = buildLnkResultRemovalBatch({ targets })
  expect(batch.expectedVersions).toEqual([{ id: 1, version: 'v1' }])
  expect(batch.mutationScope).toBe('lnk')
  expect(batch.records).toHaveLength(1)
  const expected: Record<string, unknown> = { id: 1, rkExposureConfirmedDiameter: null }
  for (const method of LNK_METHODS) {
    for (const key of [method.resultKey, method.conclusionKey, method.conclusionDateKey, method.defectDescriptionKey]) expected[key] = null
  }
  expect(batch.records[0]).toEqual(expected)
})
