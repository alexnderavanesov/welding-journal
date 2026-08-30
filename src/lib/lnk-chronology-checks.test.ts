import { describe, expect, it } from 'vitest'
import type { WeldInput } from '@/lib/weld-fields'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import {
  getDispatcherLnkChronologyIssues,
  getLnkChronologyIssues,
  getLnkResultRemovalBlockReason,
} from '@/lib/lnk-chronology-checks'

describe('getLnkChronologyIssues', () => {
  it('explains why VIK cannot be removed while later NDT results exist', () => {
    const row = {
      joint: 'F1',
      vikResult: 'годен',
      rkResult: 'годен',
      uzkResult: 'ремонт',
    } as WeldInput

    expect(getLnkResultRemovalBlockReason(row, 'vikRequest')).toBe(
      'Результат ВИК нельзя удалить, пока сохранены результаты следующих видов НК: РК, УЗК. Сначала удалите их результаты.',
    )
    expect(getLnkResultRemovalBlockReason(row, 'rkRequest')).toBe('')
    expect(getLnkResultRemovalBlockReason(row, 'vikRequest', {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      lnkResultVikRequiredBeforeOther: false,
    })).toBe('')
  })

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
        reason: 'проверить даты ЛНК',
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
        reason: 'проверить даты ЛНК',
      }),
    )
  })

  it('shows every independent LNK chronology problem in dispatcher diagnostics', () => {
    const issues = getDispatcherLnkChronologyIssues([
      {
        joint: 'F2',
        weldDate: '2026-07-10',
        vikRequest: 'Заявка-ВИК',
        vikResult: 'годен',
        vikConclusionDate: '2026-07-03',
      },
    ] as WeldInput[])

    expect(issues.map((issue) => issue.kind)).toEqual([
      'request-date-missing',
      'weld-after-conclusion',
    ])
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

  it('keeps pre-heat-treatment documents no later than the first PSTO', () => {
    const issues = getLnkChronologyIssues([{
      id: 1,
      joint: 'F5',
      weldDate: '2026-08-01',
      pstoDate: '2026-08-10',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-11',
        result: 'годен',
        conclusionDate: '2026-08-12',
      }],
    } as WeldInput])

    expect(issues.filter((issue) => issue.kind === 'pre-after-psto')).toHaveLength(2)
  })

  it('keeps post-heat-treatment documents after good TVMT', () => {
    const issues = getLnkChronologyIssues([{
      joint: 'F6',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-11',
      hasVik: 'да',
      vikRequest: 'Заявка ВИК после ТО',
      vikRequestDate: '2026-08-10',
    } as WeldInput])

    expect(issues).toContainEqual(expect.objectContaining({
      kind: 'post-before-tvmt',
      methodCode: 'ВИК',
    }))
  })

  it('does not treat duplicate controls as pre/post chronology records', () => {
    const issues = getLnkChronologyIssues([{
      joint: 'F7',
      pstoRequired: 'да',
      duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'годен', controlDate: '2026-01-01' }],
    } as WeldInput])

    expect(issues).toEqual([])
  })
})
