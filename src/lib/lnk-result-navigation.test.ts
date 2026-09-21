import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getLnkResultNavigationEntries,
  getLnkResultNavigationEntryForField,
  getPendingLnkResultMethods,
} from '@/lib/lnk-result-navigation'

describe('LNK result navigation', () => {
  const row = {
    id: 17,
    hasVik: 'да',
    vikRequest: 'Заявка-01',
    vikRequestDate: '2026-08-10',
    vikResult: 'годен',
    vikConclusion: 'Заключение-ВИК-01',
    vikConclusionDate: '2026-08-11',
    hasRk: 'да',
    rkRequest: 'Заявка-01',
    rkRequestDate: '2026-08-10',
    rkResult: 'ожидает НК',
  } as WeldRow

  it('opens the exact method represented by a result or conclusion field', () => {
    expect(getLnkResultNavigationEntryForField(row, 'vikResult')).toMatchObject({
      rowId: 17,
      methodKey: 'vikRequest',
      methodCode: 'ВИК',
      result: 'годен',
    })
    expect(getLnkResultNavigationEntryForField(row, 'vikConclusion')).toMatchObject({
      methodKey: 'vikRequest',
      conclusionName: 'Заключение-ВИК-01',
    })
    expect(getLnkResultNavigationEntryForField(row, 'rkResult')).toBeNull()
  })

  it('separates entered results from pending methods', () => {
    expect(getLnkResultNavigationEntries(row).map((entry) => entry.methodCode)).toEqual(['ВИК'])
    expect(getPendingLnkResultMethods(row).map((method) => method.code)).toEqual(['РК'])
  })

  it('uses permissive stage settings only when they are explicitly provided', () => {
    const staged = {
      ...row,
      pstoRequired: 'да',
      hasRk: 'да',
      rkRequest: 'Заявка-РК-01',
      rkRequestDate: '2026-08-10',
      rkResult: 'ожидает НК',
    }

    expect(getPendingLnkResultMethods(staged).map((method) => method.code)).not.toContain('РК')
    expect(getPendingLnkResultMethods(staged, {
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: true,
    }).map((method) => method.code)).toContain('РК')
  })
})
