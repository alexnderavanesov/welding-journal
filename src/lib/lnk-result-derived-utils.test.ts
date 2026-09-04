import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { buildLnkResultDraftById } from '@/lib/lnk-result-draft'
import { buildLnkConclusionCorrectionRows, buildLnkResultCorrectionRow } from '@/lib/lnk-result-correction-updates'
import { buildLnkResultRows } from '@/lib/lnk-result-create-updates'
import {
  getLnkResultSaveBlockReason,
  getSelectedLnkResultMethods,
  getSelectedLnkResultRows,
} from '@/lib/lnk-result-derived-utils'
import { LNK_CUSTOM_RESULT_VALUE } from '@/lib/report-config'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'

const baseDraft: LnkResultDraftState = {
  requestName: 'Заявка-001',
  requestDate: '2026-07-03',
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

const rkExposureTable = {
  fileName: 'Экспозиции.xlsx',
  uploadedAt: '2026-08-07T00:00:00.000Z',
  entries: [{
    diameter: 89,
    options: [{ label: 'по 2 экспозициям', values: ['1', '2'], isDefault: true, note: '' }],
  }],
}

describe('getLnkResultSaveBlockReason', () => {
  it('does not expose a result method when every requested control is complete', () => {
    const completeRow = {
      ...baseRow,
      rkResult: 'годен',
      rkConclusionDate: '2026-07-04',
      rkConclusion: 'Заключение-001',
    } as WeldRow

    expect(getSelectedLnkResultMethods([completeRow])).toEqual([])
    expect(getSelectedLnkResultMethods([baseRow]).map((method) => method.code)).toEqual(['РК'])
  })

  it('selects only rows from the matching LNK request date', () => {
    const rows = [
      baseRow,
      {
        ...baseRow,
        id: 2,
        rkRequestDate: '2026-08-06',
      },
    ] as WeldRow[]

    expect(
      getSelectedLnkResultRows(rows, {
        ...baseDraft,
        rowIds: new Set([1, 2]),
      }).map((row) => row.id),
    ).toEqual([1])
  })

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

  it('accepts filled names for every split conclusion group when the shared custom name is empty', () => {
    const rows = [
      baseRow,
      { ...baseRow, id: 2, joint: 'S2' },
    ] as WeldRow[]
    const systemDocumentCreationPlan: SystemDocumentCreationPlan = {
      type: 'lnkConclusion',
      methodCode: 'РК',
      mode: 'joint',
      groups: rows.map((row) => ({
        key: `joint:${row.id}`,
        label: `Стык ${row.joint}`,
        rowIds: [row.id],
        rows: [row],
        name: `вик${row.id}`,
        useSystemName: false,
        isMissingValueFallback: false,
      })),
      missingSummary: '',
      error: '',
    }

    expect(
      getLnkResultSaveBlockReason({
        draft: {
          ...baseDraft,
          controlDate: '2026-07-04',
          rowIds: new Set(rows.map((row) => row.id)),
          conclusionNaming: {
            mode: 'custom',
            customName: '',
            customGroupNames: {
              'joint:1': 'вик1',
              'joint:2': 'вик2',
            },
          },
        },
        isSaving: false,
        nextConclusionName: '',
        selectedRows: rows,
        systemDocumentCreationPlan,
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
          requestDate: '2026-07-03',
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
          requestDate: '',
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

  it('rejects an arbitrary LNK date even when an old setting disabled ZV-14', () => {
    expect(() => buildLnkResultRows({
      records: [baseRow],
      methodKey: 'rkRequest',
      controlDate: 'после ремонта',
      resultById: { 1: 'годен' },
      conclusionName: 'Заключение-РК',
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        lnkResultControlDateFormat: false,
        lnkResultDateAfterWeldDate: false,
        lnkResultRequestDateOrder: false,
      },
    })).toThrow('Дата контроля')
  })

  it('keeps the stored conclusion date separate from a custom LNK conclusion name', () => {
    const row = {
      ...baseRow,
      rkResult: 'годен',
      rkConclusionDate: '2026-07-21',
      rkConclusion: 'Заключение-РК-21.07.26-001',
    } as WeldRow

    const [updated] = buildLnkConclusionCorrectionRows({
      records: [row],
      methodKey: 'rkRequest',
      conclusionName: 'Заключение №77',
    })

    expect(updated.rkConclusionDate).toBe('2026-07-21')
    expect(updated.rkConclusion).toBe('Заключение №77')
  })

  it('creates the default RK exposure description when the RK result is first saved', () => {
    const [updated] = buildLnkResultRows({
      records: [{ ...baseRow, d1: 95, d2: 95, connectionType: 'С17' }],
      methodKey: 'rkRequest',
      controlDate: '2026-07-04',
      resultById: { 1: 'годен' },
      conclusionName: 'Заключение-РК',
      rkExposureTable,
    })

    expect(updated.lnkDefectDescription).toBe('1: ДНО\n2: ДНО')
    expect(updated.rkExposureConfirmedDiameter).toBe(95)
  })

  it('keeps VIK defect descriptions consistent across result changes and deletion', () => {
    const [good] = buildLnkResultRows({
      records: [baseRow],
      methodKey: 'vikRequest',
      controlDate: '2026-07-04',
      resultById: { 1: 'годен' },
      conclusionName: 'Заключение-ВИК',
    })
    expect(good.vikDefectDescription).toBe('ДНО')

    const rejected = buildLnkResultCorrectionRow({
      record: good,
      methodKey: 'vikRequest',
      result: 'ремонт',
    })
    expect(rejected.vikDefectDescription).toBeNull()

    const cut = buildLnkResultCorrectionRow({
      record: { ...rejected, vikDefectDescription: 'Трещина 12 мм' },
      methodKey: 'vikRequest',
      result: 'вырез',
    })
    expect(cut.vikDefectDescription).toBe('Трещина 12 мм')

    const cleared = buildLnkResultCorrectionRow({
      record: cut,
      methodKey: 'vikRequest',
      result: null,
    })
    expect(cleared.vikDefectDescription).toBeNull()
  })

  it('preserves manually edited RK descriptions when the same result is saved again', () => {
    const updated = buildLnkResultCorrectionRow({
      record: {
        ...baseRow,
        d1: 95,
        d2: 95,
        connectionType: 'С17',
        rkResult: 'годен',
        rkConclusionDate: '2026-07-04',
        rkConclusion: 'Заключение-РК',
        lnkDefectDescription: '1: участок 1а\n2: участок 2б',
        rkExposureConfirmedDiameter: 95,
      },
      methodKey: 'rkRequest',
      result: 'годен',
      rkExposureTable,
    })

    expect(updated.lnkDefectDescription).toBe('1: участок 1а\n2: участок 2б')
    expect(updated.rkExposureConfirmedDiameter).toBe(95)
  })

  it('clears only the selected split conclusion result', () => {
    const rows = [16, 17, 18].map((number) => ({
      ...baseRow,
      id: number,
      joint: `F${number}`,
      vikResult: 'годен',
      vikConclusionDate: '2026-08-25',
      vikConclusion: `ЗНК-ВИК-25.08.2026-${String(number).padStart(3, '0')}`,
    })) as WeldRow[]

    const updated17 = buildLnkResultCorrectionRow({
      record: rows[1],
      methodKey: 'vikRequest',
      result: null,
    })
    const result = rows.map((sourceRow) => sourceRow.id === updated17.id ? updated17 : sourceRow)

    expect(result.map((sourceRow) => sourceRow.vikConclusion)).toEqual([
      'ЗНК-ВИК-25.08.2026-016',
      null,
      'ЗНК-ВИК-25.08.2026-018',
    ])
    expect(result.map((sourceRow) => sourceRow.vikResult)).toEqual(['годен', null, 'годен'])
    expect(updated17.vikDefectDescription).toBeNull()
  })

  it('allows correcting a result while an older post-TO chronology issue is being repaired', () => {
    const row = {
      ...baseRow,
      pstoRequired: 'да',
      pstoRequest: 'ПСТО-001',
      pstoRequestDate: '2026-07-04',
      pstoResult: 'ожидает',
      vikRequest: 'Заявка ВИК после ТО',
      vikRequestDate: '2026-07-05',
      vikResult: 'годен',
      vikConclusionDate: '2026-07-05',
      vikConclusion: 'ЗНК-ВИК-001',
    } as WeldRow

    const updated = buildLnkResultCorrectionRow({
      record: row,
      methodKey: 'vikRequest',
      result: null,
    })

    expect(updated).toEqual(expect.objectContaining({
      vikRequest: 'Заявка ВИК после ТО',
      vikResult: null,
      vikConclusionDate: null,
      vikConclusion: null,
    }))
  })

  it('still blocks a correction that creates a new VIK ordering violation', () => {
    const row = {
      ...baseRow,
      rkResult: 'годен',
      rkConclusionDate: '2026-07-04',
      rkConclusion: 'ЗНК-РК-001',
    } as WeldRow

    expect(() => buildLnkResultCorrectionRow({
      record: row,
      methodKey: 'vikRequest',
      result: null,
    })).toThrow('нельзя сохранять результат РК, пока нет результата ВИК')
  })
})
