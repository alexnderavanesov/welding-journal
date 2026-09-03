import { describe, expect, it } from 'vitest'

import { getDuplicateControlAffectedWeldJointIds } from '@/server/duplicate-controls'

describe('duplicate-control affected weld joints', () => {
  it('keeps both the previous and next weld when a control is reassigned', () => {
    expect(getDuplicateControlAffectedWeldJointIds(51, 52)).toEqual([51, 52])
  })

  it('deduplicates unchanged and invalid weld ids', () => {
    expect(getDuplicateControlAffectedWeldJointIds(51, 51, 0, Number.NaN)).toEqual([51])
  })
})
