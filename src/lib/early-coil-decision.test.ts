import { describe, expect, it } from 'vitest'

import {
  getEarlyCoilDecisionKey,
  getEarlyCoilDecisionSourceRowIds,
  parseEarlyCoilDecisionKey,
} from '@/lib/early-coil-decision'

describe('early coil decision keys', () => {
  it('round-trips a source row id', () => {
    const key = getEarlyCoilDecisionKey(51)

    expect(key).toBe('early-coil:51')
    expect(parseEarlyCoilDecisionKey(key)).toEqual({ key, sourceRowId: 51 })
  })

  it('ignores unrelated and malformed accepted-warning keys', () => {
    expect(getEarlyCoilDecisionSourceRowIds([
      'percentage-line:new-welder:1',
      'early-coil:12',
      'early-coil:0',
      'early-coil:12:extra',
      '',
    ])).toEqual(new Set([12]))
  })
})
