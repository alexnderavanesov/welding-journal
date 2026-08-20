import { describe, expect, it } from 'vitest'

import {
  formatControlBasisSummary,
  getControlBasisFieldByAssignmentKey,
  withControlBasisSummary,
} from '@/lib/control-assignment-basis'

describe('control assignment basis', () => {
  const row = {
    vikControlBasis: '  ТР №444  ',
    rkControlBasis: 'Пересогласование №13',
    pstoControlBasis: 'Письмо №8',
    uzkControlBasis: '   ',
  }

  it('builds report-specific summaries and omits empty values', () => {
    expect(formatControlBasisSummary(row, 'all')).toBe(
      'ВИК: ТР №444; РК: Пересогласование №13; ПСТО: Письмо №8',
    )
    expect(formatControlBasisSummary(row, 'lnk')).toBe('ВИК: ТР №444; РК: Пересогласование №13')
    expect(formatControlBasisSummary(row, 'psto')).toBe('ПСТО: Письмо №8')
  })

  it('does not depend on the current assignment state', () => {
    expect(formatControlBasisSummary({ hasRk: null, rkControlBasis: 'ТР №7' }, 'lnk')).toBe('РК: ТР №7')
    expect(getControlBasisFieldByAssignmentKey('hasRk')?.basisKey).toBe('rkControlBasis')
  })

  it('attaches a virtual summary without changing stored basis fields', () => {
    expect(withControlBasisSummary(row, 'psto')).toMatchObject({
      pstoControlBasis: 'Письмо №8',
      controlBasisSummary: 'ПСТО: Письмо №8',
    })
  })
})
