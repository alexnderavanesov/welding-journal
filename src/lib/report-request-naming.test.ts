import { describe, expect, it } from 'vitest'

import {
  formatCustomDocumentName,
  formatCustomRequestName,
  formatPstoRequestName,
  getRequestNameFromNaming,
  isSystemLnkRequestName,
  isSystemPstoRequestName,
} from '@/lib/report-request-naming'

describe('report request naming', () => {
  it('adds the selected date to custom request names', () => {
    expect(
      getRequestNameFromNaming(
        { mode: 'custom', customName: 'Заявка №3434' },
        'Заявка-21.07.26-001',
        '2026-07-21',
      ),
    ).toBe('Заявка №3434 от 21.07.2026')
  })

  it('does not duplicate the same date suffix in custom request names', () => {
    expect(formatCustomRequestName('Заявка №3434 от 21.07.2026', '2026-07-21')).toBe(
      'Заявка №3434 от 21.07.2026',
    )
  })

  it('keeps the real document date when a user typed another date in the name', () => {
    expect(formatCustomDocumentName('Заключение №77 от 20.07.2026', '2026-07-21')).toBe(
      'Заключение №77 от 21.07.2026',
    )
  })

  it('keeps system names unchanged and detects default LNK system names', () => {
    expect(getRequestNameFromNaming({ mode: 'system', customName: 'ручное' }, 'Заявка-21.07.26-001', '2026-07-21')).toBe(
      'Заявка-21.07.26-001',
    )
    expect(isSystemLnkRequestName('Заявка-21.07.26-001')).toBe(true)
    expect(isSystemLnkRequestName('Заявка №3434 от 21.07.2026')).toBe(false)
  })

  it('builds system PSTO request names from the selected request date', () => {
    expect(formatPstoRequestName([], undefined, '2026-07-21')).toBe('ПСТО-21.07.26-001')
    expect(isSystemPstoRequestName('ПСТО-21.07.26-001')).toBe(true)
    expect(isSystemPstoRequestName('Заявка ПСТО №3434 от 21.07.2026')).toBe(false)
  })
})
