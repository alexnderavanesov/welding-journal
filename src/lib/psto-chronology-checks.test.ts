import { describe, expect, it } from 'vitest'

import { getDispatcherPstoChronologyIssues, getPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

describe('psto chronology checks', () => {
  it('checks weld date, PSTO request date and PSTO result date order', () => {
    const rows = [
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-04',
        pstoRequest: 'ПСТО-08.07.26-001',
        pstoRequestDate: '2026-07-08',
        pstoResult: 'проведено',
        pstoDate: '2026-07-05',
      },
    ] as Parameters<typeof getPstoChronologyIssues>[0]

    expect(getPstoChronologyIssues(rows)[0]?.message).toBe(
      'Стык F1: дата результата ПСТО 05.07.2026 раньше даты заявки ПСТО 08.07.2026.',
    )
  })

  it('does not block PSTO chronology when the save check is disabled', () => {
    const rows = [
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-04',
        pstoRequest: 'ПСТО-01.07.26-001',
        pstoRequestDate: '2026-07-01',
      },
    ] as Parameters<typeof getPstoChronologyIssues>[0]

    expect(
      getPstoChronologyIssues(rows, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        pstoResultRequestDateOrder: false,
      }),
    ).toEqual([])
  })

  it('shows every independent PSTO chronology problem in dispatcher diagnostics', () => {
    const issues = getDispatcherPstoChronologyIssues([
      {
        id: 1,
        joint: 'F1',
        weldDate: '2026-07-10',
        pstoRequest: 'ПСТО-001',
        pstoResult: 'проведено',
        pstoDate: '2026-07-05',
      },
    ])

    expect(issues.map((issue) => issue.kind)).toEqual([
      'request-date-missing',
      'weld-after-result',
    ])
  })
})
