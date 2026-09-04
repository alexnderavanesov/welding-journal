import { describe, expect, it } from 'vitest'

import { getPstoLineValidationScopeIdentities } from '@/server/weld-save-validation'

describe('PSTO line validation scope', () => {
  it('keeps only the distinct lines touched by the mutation', () => {
    expect(getPstoLineValidationScopeIdentities([
      { projectTitle: ' P ', subtitleCode: ' S ', line: ' L-1 ' },
      { projectTitle: 'P', subtitleCode: 'S', line: 'L-1' },
      { projectTitle: 'P', subtitleCode: 'S', line: 'L-2' },
      { projectTitle: 'P', subtitleCode: 'S', line: '' },
    ])).toEqual([
      { projectTitle: 'P', subtitleCode: 'S', line: 'L-1' },
      { projectTitle: 'P', subtitleCode: 'S', line: 'L-2' },
    ])
  })
})
