import { describe, expect, it } from 'vitest'
import { acceptedWarningOwner } from './accepted-warning-owner'
import { programApprovalKey } from './program-control-approval'
describe('object references of saved exceptions', () => {
  it('reads a structured line identity even with quotes, colons and delimiters', () => {
    const identity = ['P:"[]', 'S:·', 'L:2']
    const key = 'percentage-line-control:excess:' + JSON.stringify([JSON.stringify(identity), 'k1']) + ':3:4:17'
    expect(acceptedWarningOwner({ key, kind: 'percentage-line-control', context: 'stale' })).toEqual({ type: 'line', identity: { projectTitle: identity[0], subtitleCode: identity[1], line: identity[2] }, stamp: 'k1' })
  })
  it('resolves decisions by IDs rather than object labels', () => {
    expect(acceptedWarningOwner({ key: programApprovalKey({ id: 17, hasRk: 'да', hasUzk: 'да' }, 'common', true), kind: 'line-program-control', context: null })).toEqual({ type: 'joint', id: 17 })
    expect(acceptedWarningOwner({ key: 'early-coil:18', kind: 'early-coil', context: null })).toEqual({ type: 'joint', id: 18 })
    expect(acceptedWarningOwner({ key: 'welder-stamp-expiry:naks:19:OLD:permit:2026-01-01', kind: 'welder-stamp-expiry', context: null })).toEqual({ type: 'stamp', id: 19 })
  })
  it('reports unresolvable data without guessing ownership', () => {
    expect(acceptedWarningOwner({ key: 'broken', kind: 'unknown', context: 'arbitrary name' })).toBeNull()
  })
})
