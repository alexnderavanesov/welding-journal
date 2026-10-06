import { describe, expect, it } from 'vitest'
import { getProgramApprovalOptions, getProgramApprovalTargets, programApprovalVersion } from './program-approval-actions'
import { programApprovalKey } from './program-control-approval'
import type { WeldRow } from './dispatcher-types'

const line = { id: 1, weldControlPercent: 30, pvkControlPercent: 10 }
const row: WeldRow = { id: 1, line: 'L', joint: 'F1', connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', stamp2K: 'B', hasRk: 'да', hasUzk: 'да', rkResult: 'годен', rkConclusion: 'ЗНК-1' }
describe('decision-only approval options', () => {
  it('offers existing completed double-method assignments, deduplicated across welders', () => {
    const result = getProgramApprovalOptions([row], line, [])
    expect(result.approve).toHaveLength(1)
    expect(result.approve[0].duplicate).toBe(true)
    expect(row.rkConclusion).toBe('ЗНК-1')
  })
  it('revokes approval after quota changes, preserving independent PVK', () => {
    const approvals = [true, false].map((duplicate, i) => ({ rowId: 1, key: programApprovalKey(row, i ? 'pvk' : 'common', duplicate), version: 'v1' }))
    for (const percent of [30, 50, 100]) {
      const options = getProgramApprovalOptions([row], { ...line, weldControlPercent: percent }, approvals)
      expect(options.approve).toEqual([])
      expect(options.revoke.map(item => item.key)).toEqual(approvals.map(item => item.key))
    }
  })
  it('never accepts stale method signatures or another joint', () => {
    const approvals = [{ rowId: 1, key: programApprovalKey({ ...row, hasUzk: '' }, 'common', true), version: '1' }, { rowId: 99, key: programApprovalKey({ ...row, id: 99 }, 'common', true), version: '1' }]
    const options = getProgramApprovalOptions([row], line, approvals)
    expect(options.revoke).toEqual([]); expect(options.approve).toHaveLength(1)
  })
  it('has a stable version but detects revoke/reapprove of the same key', () => {
    const a = { rowId: 1, key: 'a', version: '1' }, b = { rowId: 1, key: 'b', version: '2' }
    expect(programApprovalVersion([a, b])).toBe(programApprovalVersion([b, a]))
    expect(programApprovalVersion([a])).not.toBe(programApprovalVersion([{ ...a, version: '3' }]))
  })
  it.each([24, 2048, 200000])('checks %i approvals in one pass for a batch, preserving empty and multi-method versions', count => {
    let visits = 0
    const approvals = Array.from({ length: count }, (_, index) => ({
      get rowId() { visits++; return Math.floor(index / 2) + 1 },
      key: `method-${index % 2}`, version: `version-${index}`,
    }))
    const targets = Array.from({ length: Math.min(count, 1000) }, (_, index) => ({ id: index + 1, version: `row-${index}` }))
    const result = getProgramApprovalTargets(targets, approvals)
    expect(result).toHaveLength(targets.length)
    expect(result[0]).toEqual({ id: 1, version: 'row-0', approvalVersion: '[["method-0","version-0"],["method-1","version-1"]]' })
    if (count < 1000) expect(result.at(-1)?.approvalVersion).toBe('[]')
    expect(visits).toBeLessThanOrEqual(count * 2)
  })
})
