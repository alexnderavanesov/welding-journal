import { describe, expect, it } from 'vitest'
import type { WeldInput } from '@/lib/weld-fields'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import {
  getDispatcherLnkChronologyIssues,
  getLnkChronologyIssues,
} from '@/lib/lnk-chronology-checks'

describe('getLnkChronologyIssues', () => {
  it('blocks a conclusion date before the LNK request date', () => {
    const issues = getLnkChronologyIssues([
      {
        joint: 'F1',
        weldDate: '2026-07-01',
        rkRequest: 'Заявка-08.07.26-001',
        rkRequestDate: '2026-07-08',
        rkResult: 'годен',
        rkConclusionDate: '2026-07-05',
      },
    ] as WeldInput[])

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'request-after-conclusion',
        methodCode: 'РК',
        reason: 'проверить даты заявки ЛНК',
      }),
      expect.objectContaining({
        kind: 'vik-missing-before-other',
        methodCode: 'РК',
        reason: 'дозаполнить ВИК перед другим НК',
      }),
    ])
  })

  it('blocks other NDT results until VIK has a result', () => {
    const issues = getLnkChronologyIssues([
      {
        joint: 'F2',
        weldDate: '2026-07-01',
        rkRequestDate: '2026-07-02',
        rkResult: 'годен',
        rkConclusionDate: '2026-07-03',
      },
    ] as WeldInput[])

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'vik-missing-before-other',
        methodCode: 'РК',
      }),
    )
  })

  it('does not block saving a result only because an old request has no request date', () => {
    const issues = getLnkChronologyIssues([
      {
        joint: 'F2',
        weldDate: '2026-07-01',
        vikRequest: 'Заявка-ВИК',
        vikResult: 'годен',
        vikConclusionDate: '2026-07-03',
      },
    ] as WeldInput[])

    expect(issues).toEqual([])
  })

  it('keeps missing LNK request date visible for dispatcher diagnostics', () => {
    const issues = getDispatcherLnkChronologyIssues([
      {
        joint: 'F2',
        weldDate: '2026-07-01',
        vikRequest: 'Заявка-ВИК',
        vikResult: 'годен',
        vikConclusionDate: '2026-07-03',
      },
    ] as WeldInput[])

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'request-date-missing',
        methodCode: 'ВИК',
        reason: 'проверить даты заявки ЛНК',
      }),
    )
  })

  it('blocks other NDT dates before the VIK date', () => {
    const issues = getLnkChronologyIssues([
      {
        joint: 'F3',
        weldDate: '2026-07-01',
        vikRequestDate: '2026-07-02',
        vikResult: 'годен',
        vikConclusionDate: '2026-07-10',
        rkRequestDate: '2026-07-02',
        rkResult: 'годен',
        rkConclusionDate: '2026-07-09',
      },
    ] as WeldInput[])

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'vik-after-other',
        methodCode: 'РК',
        reason: 'проверить порядок ВИК и НК',
      }),
    )
  })

  it('respects disabled save-check settings', () => {
    const issues = getLnkChronologyIssues(
      [
        {
          joint: 'F4',
          weldDate: '2026-07-10',
          rkRequestDate: '2026-07-01',
          rkResult: 'годен',
          rkConclusionDate: '2026-06-30',
        },
      ] as WeldInput[],
      {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        lnkResultRequestDateOrder: false,
        lnkResultVikDateBeforeOther: false,
        lnkResultVikRequiredBeforeOther: false,
      },
    )

    expect(issues).toEqual([])
  })
})
