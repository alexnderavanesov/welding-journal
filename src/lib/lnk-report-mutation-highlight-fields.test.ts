import { describe, expect, it } from 'vitest'

import {
  getLnkRequestPositionHighlightFields,
  getLnkResultHighlightFields,
  getLnkResultReplacementHighlightFields,
} from '@/lib/lnk-report-mutation-highlight-fields'

describe('LNK mutation highlight fields', () => {
  it('highlights the defect description changed together with a request or result', () => {
    expect(getLnkRequestPositionHighlightFields('vikRequest')).toContain('vikDefectDescription')
    expect(getLnkResultHighlightFields('uzkRequest')).toContain('uzkDefectDescription')
  })

  it('highlights defect descriptions for every replaced method', () => {
    expect(getLnkResultReplacementHighlightFields([
      { methodKey: 'vikRequest' },
      { methodKey: 'pvkRequest' },
    ])).toEqual(expect.arrayContaining([
      'vikResult',
      'vikDefectDescription',
      'pvkResult',
      'pvkDefectDescription',
    ]))
  })
})
