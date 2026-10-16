import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { captureWeldRowDeletionTargets } from './weld-row-deletion-targets'
import { assertCurrentInteractiveWeldRowVersions } from './weld-row-version'

const row = (id: number, rowVersion?: string): WeldRow => ({ id, rowVersion })

describe('deletion from an exact loaded selection', () => {
  it('includes offscreen rows from the menu snapshot rather than the visible page', () => {
    const page = [row(1, 'v1')]
    const selection = [...page, row(2, 'v2')]
    expect(captureWeldRowDeletionTargets([1, 2], page)).toBeNull()
    expect(captureWeldRowDeletionTargets([1, 2], selection)).toEqual([
      { id: 1, version: 'v1' }, { id: 2, version: 'v2' },
    ])
  })

  it.each([
    { rows: [row(1, 'v1')] },
    { rows: [row(1, 'v1'), row(2)] },
    { rows: [row(1, 'v1'), row(2, '  ')] },
  ])('refuses the entire selection when any captured version is unavailable', ({ rows }) => {
    expect(captureWeldRowDeletionTargets([1, 2], rows)).toBeNull()
  })

  it('keeps captured versions while confirmation is pending so a stale batch is refused', () => {
    const rows = [row(1, 'v1'), row(2, 'v2')]
    const targets = captureWeldRowDeletionTargets([1, 2], rows)!
    // Another client saves an offscreen row while the operator confirms.
    rows[1].rowVersion = 'v3'
    expect(targets).toEqual([{ id: 1, version: 'v1' }, { id: 2, version: 'v2' }])
    expect(() => assertCurrentInteractiveWeldRowVersions({
      targetIds: [1, 2], expectedVersions: targets,
      currentVersions: [{ id: 1, version: 'v1' }, { id: 2, version: 'v3' }],
    })).toThrow('Ничего не сохранено')
  })

  it('retains the captured single-row version and deduplicates requested IDs', () => {
    const rows = [row(2, ' v2 '), row(1, 'v1'), row(3, 'v3')]
    expect(captureWeldRowDeletionTargets([2, 2], rows)).toEqual([{ id: 2, version: 'v2' }])
  })
})
