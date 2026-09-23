import { describe, expect, it } from 'vitest'
import type { WeldInput } from '@/lib/weld-fields'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import {
  findFirstLnkChronologySaveBlockReason,
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

  it('reports every missing part of a pending LNK request before a result exists', () => {
    const issues = getDispatcherLnkChronologyIssues([
      {
        joint: 'F2',
        weldDate: '2026-07-01',
        vikRequest: 'Заявка-ВИК',
        rkRequestDate: '2026-07-02',
      },
    ] as WeldInput[])

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'request-date-missing', methodCode: 'ВИК' }),
      expect.objectContaining({ kind: 'request-name-missing', methodCode: 'РК' }),
    ]))
  })

  it('reports missing request name and date when a result exists without a request', () => {
    const issues = getDispatcherLnkChronologyIssues([
      {
        joint: 'F2',
        weldDate: '2026-07-01',
        vikResult: 'годен',
        vikConclusionDate: '2026-07-03',
        vikConclusion: 'ЗВИК-1',
      },
    ] as WeldInput[])

    expect(issues.map((issue) => issue.kind)).toEqual([
      'request-date-missing',
      'request-name-missing',
    ])
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

  it('reports invalid dates in primary, pre-TO and duplicate controls for dispatcher diagnostics', () => {
    const issues = getDispatcherLnkChronologyIssues([{
      id: 1,
      joint: 'F2',
      vikRequest: 'Заявка-ВИК',
      vikRequestDate: '31.02.2026',
      vikResult: 'годен',
      vikConclusionDate: '2023-12-31',
      vikConclusion: 'ВИК-1',
      preHeatTreatmentControls: [{
        id: 10,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: 'не дата',
        result: 'годен',
        conclusionDate: '32.07.2026',
        conclusionName: 'ВИК до ТО-1',
      }],
      duplicateControls: [{
        id: 20,
        weldJointId: 1,
        method: 'РК',
        result: 'годен',
        controlDate: '31.02.2026',
        conclusion: 'РК-дубль-1',
        conclusionDate: '2023-12-31',
      }],
    } as WeldInput])

    expect(issues.filter((issue) => issue.kind.endsWith('-invalid'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'request-date-invalid', methodCode: 'ВИК' }),
      expect.objectContaining({ kind: 'conclusion-date-invalid', methodCode: 'ВИК' }),
      expect.objectContaining({ kind: 'request-date-invalid', methodCode: 'ВИК до ТО' }),
      expect.objectContaining({ kind: 'conclusion-date-invalid', methodCode: 'ВИК до ТО' }),
      expect.objectContaining({ kind: 'request-date-invalid', methodCode: 'РК (дубль)' }),
      expect.objectContaining({ kind: 'conclusion-date-invalid', methodCode: 'РК (дубль)' }),
    ]))
    expect(issues.some((issue) => issue.kind === 'request-date-missing')).toBe(false)
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
        lnkResultDateAfterWeldDate: false,
        lnkResultRequestDateOrder: false,
        lnkResultVikDateBeforeOther: false,
        lnkResultVikRequiredBeforeOther: false,
      },
    )

    expect(issues).toEqual([])
  })

  it('enforces ZV-15 independently when ZV-16 is disabled', () => {
    const settings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      lnkResultRequestDateOrder: false,
      lnkResultVikRequiredBeforeOther: false,
    }
    const rows = [{
      joint: 'F4',
      weldDate: '2026-07-10',
      rkRequest: 'Заявка-РК',
      rkRequestDate: '2026-07-11',
      rkResult: 'годен',
      rkConclusionDate: '2026-07-09',
    }] as WeldInput[]

    expect(getLnkChronologyIssues(rows, settings)).toContainEqual(expect.objectContaining({
      kind: 'weld-after-conclusion',
      methodCode: 'РК',
    }))
    expect(findFirstLnkChronologySaveBlockReason(rows, settings)).toContain('ЗВ-15')
  })

  it('does not apply ZV-16 request ordering when only ZV-15 is enabled', () => {
    const issues = getLnkChronologyIssues([{
      joint: 'F4',
      weldDate: '2026-07-10',
      rkRequest: 'Заявка-РК',
      rkRequestDate: '2026-07-09',
      rkResult: 'годен',
      rkConclusionDate: '2026-07-11',
    }] as WeldInput[], {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      lnkResultRequestDateOrder: false,
      lnkResultVikRequiredBeforeOther: false,
    })

    expect(issues).toEqual([])
  })

  it('enforces ZV-15 for pre-TO LNK independently from ZV-16', () => {
    const issues = getLnkChronologyIssues([{
      id: 4,
      joint: 'F4',
      weldDate: '2026-07-10',
      preHeatTreatmentControls: [{
        id: 40,
        weldJointId: 4,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-07-11',
        result: 'годен',
        conclusionDate: '2026-07-09',
      }],
    } as WeldInput], {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      lnkResultRequestDateOrder: false,
    })

    expect(issues).toContainEqual(expect.objectContaining({
      kind: 'weld-after-conclusion',
      methodCode: 'ВИК до ТО',
    }))
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

  it('keeps actual post-heat-treatment results after good TVMT', () => {
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
      vikResult: 'годен',
      vikConclusionDate: '2026-08-10',
    } as WeldInput])

    expect(issues).toContainEqual(expect.objectContaining({
      kind: 'post-before-tvmt',
      methodCode: 'ВИК',
    }))
  })

  it('keeps DZ-20 temporary while legacy primary LNK is completed with a separate pre-TO chain', () => {
    const legacyPrimary = {
      id: 8,
      joint: 'F8',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Существующая заявка ВИК основная',
      vikRequestDate: '2026-08-07',
      vikResult: 'годен',
      vikConclusionDate: '2026-08-08',
      vikConclusion: 'Существующее заключение ВИК основное',
    } as WeldInput

    expect(getLnkChronologyIssues([legacyPrimary])).toContainEqual(expect.objectContaining({
      kind: 'post-before-psto-cycle',
      methodCode: 'ВИК',
    }))

    const withPreControl = {
      ...legacyPrimary,
      preHeatTreatmentControls: [{
        id: 80,
        weldJointId: 8,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        requestDate: '2026-08-02',
        result: 'годен',
        conclusionDate: '2026-08-03',
        conclusionName: 'Заключение ВИК до ТО',
      }],
    } as WeldInput
    expect(getLnkChronologyIssues([withPreControl])).toContainEqual(expect.objectContaining({
      kind: 'post-before-psto-cycle',
      methodCode: 'ВИК',
    }))

    const completedHistory = {
      ...withPreControl,
      pstoRequest: 'Заявка ПСТО',
      pstoRequestDate: '2026-08-04',
      pstoResult: 'проведено',
      pstoDate: '2026-08-05',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtRequestDate: '2026-08-05',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-06',
      tvmtConclusion: 'Заключение ТВМТ',
    } as WeldInput
    expect(getLnkChronologyIssues([completedHistory]).filter((issue) => (
      issue.kind === 'post-before-psto-cycle' ||
      issue.kind === 'post-before-psto' ||
      issue.kind === 'post-before-tvmt'
    ))).toEqual([])
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
