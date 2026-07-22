import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { buildLnkResultDraftById } from '@/lib/lnk-result-draft'
import { buildLnkConclusionCorrectionRows } from '@/lib/lnk-result-correction-updates'
import { buildLnkResultRows } from '@/lib/lnk-result-create-updates'
import { getLnkResultSaveBlockReason } from '@/lib/lnk-result-derived-utils'
import { LNK_CUSTOM_RESULT_VALUE } from '@/lib/report-config'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

const baseDraft: LnkResultDraftState = {
  requestName: 'Заявка-001',
  methodKey: 'rkRequest',
  search: '',
  rowIds: new Set([1]),
  result: 'годен',
  rowResults: {},
  controlDate: '2026-07-01',
  conclusionNaming: {
    mode: 'system',
    customName: '',
  },
}

const baseRow = {
  id: 1,
  joint: 'S1',
  weldDate: '2026-07-03',
  hasVik: 'да',
  vikRequest: 'Заявка-ВИК',
  vikRequestDate: '2026-07-03',
  vikResult: 'годен',
  vikConclusionDate: '2026-07-03',
  vikConclusion: 'Заключение-ВИК',
  hasRk: 'да',
  rkRequest: 'Заявка-001',
  rkRequestDate: '2026-07-03',
  rkResult: 'ожидает НК',
} as WeldRow

describe('getLnkResultSaveBlockReason', () => {
  it('blocks LNK control date before weld date when the check is enabled', () => {
    expect(
      getLnkResultSaveBlockReason({
        draft: baseDraft,
        isSaving: false,
        nextConclusionName: 'Заключение-001',
        selectedRows: [baseRow],
      }),
    ).toContain('Дата контроля РК не может быть раньше даты сварки')
  })

  it('allows LNK control date before weld date when the check is disabled', () => {
    expect(
      getLnkResultSaveBlockReason({
        draft: baseDraft,
        isSaving: false,
        nextConclusionName: 'Заключение-001',
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          lnkResultDateAfterWeldDate: false,
          lnkResultRequestDateOrder: false,
          lnkResultVikDateBeforeOther: false,
        },
        selectedRows: [baseRow],
      }),
    ).toBe('')
  })

  it('allows empty control date and conclusion when these LNK checks are disabled', () => {
    expect(
      getLnkResultSaveBlockReason({
        draft: {
          ...baseDraft,
          controlDate: '',
        },
        isSaving: false,
        nextConclusionName: '',
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          lnkResultControlDateRequired: false,
          lnkResultConclusionRequired: false,
        },
        selectedRows: [baseRow],
      }),
    ).toBe('')
  })

  it('keeps repair result for forbidden diameter when repair rules are disabled', () => {
    const repairDraft = { ...baseDraft, result: 'ремонт', controlDate: '2026-07-04' }
    const repairRow = { ...baseRow, d1: '57', d2: '57' } as WeldRow
    const settings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      lnkResultRepairRules: false,
    }

    expect(buildLnkResultDraftById([repairRow], repairDraft, settings)).toEqual({ 1: 'ремонт' })
    expect(
      getLnkResultSaveBlockReason({
        draft: repairDraft,
        isSaving: false,
        nextConclusionName: 'Заключение-001',
        saveCheckSettings: settings,
        selectedRows: [repairRow],
      }),
    ).toBe('')
  })

  it('blocks saving non-VIK result while VIK result is missing', () => {
    const row = {
      ...baseRow,
      vikResult: 'ожидает НК',
      vikConclusionDate: '',
      vikConclusion: '',
      hasUzk: 'да',
      uzkRequest: 'Заявка-УЗК',
      uzkRequestDate: '2026-07-03',
      uzkResult: 'ожидает НК',
    } as WeldRow
    expect(
      getLnkResultSaveBlockReason({
        draft: {
          ...baseDraft,
          controlDate: '2026-07-04',
          methodKey: 'uzkRequest',
          requestName: 'Заявка-УЗК',
          rowResults: { 1: 'годен' },
          result: LNK_CUSTOM_RESULT_VALUE,
        },
        isSaving: false,
        nextConclusionName: 'Заключение-УЗК',
        selectedRows: [row],
      }),
    ).toContain('пока нет результата ВИК')
  })

  it('keeps the same VIK-before-other guard in the save update builder', () => {
    const row = {
      ...baseRow,
      vikResult: 'ожидает НК',
      vikConclusionDate: '',
      vikConclusion: '',
      hasUzk: 'да',
      uzkRequest: 'Заявка-УЗК',
      uzkRequestDate: '2026-07-03',
      uzkResult: 'ожидает НК',
    } as WeldRow

    expect(() =>
      buildLnkResultRows({
        records: [row],
        methodKey: 'uzkRequest',
        controlDate: '2026-07-04',
        resultById: { 1: 'годен' },
        conclusionName: 'Заключение-УЗК',
      }),
    ).toThrow('пока нет результата ВИК')
  })

  it('allows saving a VIK result for an old request without a request date', () => {
    const row = {
      ...baseRow,
      vikRequestDate: '',
      vikResult: 'ожидает НК',
      vikConclusionDate: '',
      vikConclusion: '',
    } as WeldRow

    expect(
      getLnkResultSaveBlockReason({
        draft: {
          ...baseDraft,
          controlDate: '2026-07-04',
          methodKey: 'vikRequest',
          requestName: 'Заявка-ВИК',
          rowResults: { 1: 'годен' },
          result: LNK_CUSTOM_RESULT_VALUE,
        },
        isSaving: false,
        nextConclusionName: 'Заключение-ВИК',
        selectedRows: [row],
      }),
    ).toBe('')
    expect(() =>
      buildLnkResultRows({
        records: [row],
        methodKey: 'vikRequest',
        controlDate: '2026-07-04',
        resultById: { 1: 'годен' },
        conclusionName: 'Заключение-ВИК',
      }),
    ).not.toThrow()
  })

  it('keeps the stored conclusion date when renaming an LNK conclusion', () => {
    const row = {
      ...baseRow,
      rkResult: 'годен',
      rkConclusionDate: '2026-07-21',
      rkConclusion: 'Заключение-РК-21.07.26-001',
    } as WeldRow

    const [updated] = buildLnkConclusionCorrectionRows({
      records: [row],
      methodKey: 'rkRequest',
      conclusionName: 'Заключение №77 от 20.07.2026',
    })

    expect(updated.rkConclusionDate).toBe('2026-07-21')
    expect(updated.rkConclusion).toBe('Заключение №77 от 21.07.2026')
  })
})
