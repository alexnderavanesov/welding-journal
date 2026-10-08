import { describe, expect, it } from 'vitest'

import type { WeldDraft } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS, normalizeSaveCheckSettings } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import {
  getControlAvailabilityReportHistoryIssues,
  getWeldFormCancellationResultHint,
  getWeldFormReactivationResultHint,
  getWeldFormSaveBlockReason,
  getWeldStampSaveBlockReason,
} from '@/lib/weld-form-save-reasons'

describe('getWeldFormSaveBlockReason', () => {
  const initialValue = { id: 1, joint: 'S1' } as WeldDraft

  it.each([{ officiality: 'неофициальный' }, { revisionActuality: 'не актуален' }])('keeps excluded assignments read-only but allows reactivation and other edits: %j', excluded => {
    const previous = { ...initialValue, ...excluded, hasRk: 'да' }
    for (const hasRk of [null, 'отменен', 'дополнительный']) {
      expect(getWeldFormSaveBlockReason({ ...previous, hasRk }, previous)).toContain('официального актуального')
    }
    expect(getWeldFormSaveBlockReason({ ...previous, isometry: 'ISO-2' }, previous)).toBeNull()
    expect(getWeldFormSaveBlockReason({ ...previous, officiality: null, revisionActuality: null, hasUzk: 'да' }, previous)).toBeNull()
    expect(getWeldFormSaveBlockReason({ ...initialValue, ...excluded, hasUzk: 'да' }, initialValue)).toContain('официального актуального')
  })

  it('allows a missing material group for SP-03 backfill', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: '',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('allows a missing material group when the dedicated check is disabled', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: '',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue, {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredMaterialGroupWithWeldDate: false,
    })).toBeNull()
  })

  it('allows a missing connection type for SP-03 backfill', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: '',
      weldingMethod: 'РД',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('allows a missing connection type when the dedicated check is disabled', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: '',
      weldingMethod: 'РД',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue, {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredConnectionTypeWithWeldDate: false,
    })).toBeNull()
  })

  it('allows a missing welding method for SP-03 backfill', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: '',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('allows a missing welding method when the dedicated check is disabled', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: '',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue, {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      requiredWeldingMethodWithWeldDate: false,
    })).toBeNull()
  })

  it('allows clearing LNK availability when only request exists', () => {
    const draft = { id: 1, joint: 'S1', hasVik: null, vikRequest: 'Заявка-001' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })



  it('blocks clearing LNK availability when method result history exists', () => {
    const draft = { id: 1, joint: 'S1', hasVik: null, vikRequest: 'Заявка-001', vikResult: 'годен' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-12 · ВИК: выберите «отменен» либо очистите/удалите результат НК в отчете ЛНК.',
    )
  })

  it('keeps a legacy control-history issue visible to the dispatcher without blocking an unrelated edit', () => {
    const legacyRow = {
      id: 1,
      joint: 'S1',
      hasVik: null,
      vikResult: 'годен',
      responsible: '',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(
      { ...legacyRow, responsible: 'Иванов' },
      legacyRow as WeldDraft,
    )).toBeNull()
    expect(getControlAvailabilityReportHistoryIssues(legacyRow)).toEqual([
      expect.objectContaining({ code: 'ВИК', report: 'lnk' }),
    ])
  })

  it('keeps performed PSTO history valid after moving a weld to a line without PSTO', () => {
    const cycle = {
      id: 1,
      joint: 'S1',
      pstoRequest: 'Заявка ПСТО-001',
      pstoRequestDate: '2026-07-01',
      pstoDate: '2026-07-02',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-07-02',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-07-03',
      tvmtConclusion: 'ЗНК-ТВМТ-001',
      hasTvmt: null,
    } as WeldInput

    expect(getWeldFormSaveBlockReason({ ...cycle, pstoRequired: 'да' }, initialValue)).toBeNull()
    expect(getWeldFormSaveBlockReason({ ...cycle, pstoRequired: null }, initialValue)).toBeNull()
  })

  it('does not disable control history through a legacy toggle', () => {
    const draft = { id: 1, joint: 'S1', hasVik: null, vikRequest: 'Заявка-001', vikResult: 'годен' } as WeldInput

    expect(
      getWeldFormSaveBlockReason(draft, initialValue, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        controlHistoryProtection: false,
      }),
    ).toContain('СП-12')
  })

  it('allows cancelled LNK availability with existing method report history', () => {
    const draft = { id: 1, joint: 'S1', hasVik: 'отменен', vikRequest: 'Заявка-001' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('explains cancelled positive LNK result display', () => {
    const draft = { id: 1, joint: 'S1', hasVik: 'отменен', vikResult: 'годен' } as WeldInput

    expect(getWeldFormCancellationResultHint(draft, { ...initialValue, hasVik: 'да' } as WeldDraft)).toBe(
      'ВИК: назначение будет отменено. Заявки, результаты и заключения всех этапов сохраняются; фактический брак остаётся браком.',
    )
  })

  it('explains that cancellation preserves rejected LNK history', () => {
    const draft = { id: 1, joint: 'S1', hasRk: 'отменен', rkResult: 'ремонт' } as WeldInput

    expect(getWeldFormCancellationResultHint(draft, { ...initialValue, hasRk: 'да' } as WeldDraft)).toBe(
      'РК: назначение будет отменено. Заявки, результаты и заключения всех этапов сохраняются; фактический брак остаётся браком.',
    )
  })



  it('allows clearing PSTO availability when only request and date exist', () => {
    const draft = { id: 1, joint: 'S1', pstoRequired: null, pstoDate: '10.06.2026' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })



  it('keeps completed PSTO history valid without an active line assignment', () => {
    const draft = { id: 1, joint: 'S1', pstoRequired: null, pstoDate: '10.06.2026', pstoResult: 'проведено' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('does not treat PSTO financial references as execution history', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      pstoRequired: null,
      pstoBoq: 'Акт-1',
      pstoKs3: 'КС-3-1',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
    expect(getControlAvailabilityReportHistoryIssues(draft)).toEqual([])
  })

  it('explains cancelled positive PSTO result display', () => {
    const draft = { id: 1, joint: 'S1', pstoRequired: 'отменен', pstoResult: 'проведено' } as WeldInput

    expect(getWeldFormCancellationResultHint(draft, { ...initialValue, pstoRequired: 'да' } as WeldDraft)).toBe(
      'ПСТО: назначение будет отменено. Заявки, результаты и заключения всех этапов сохраняются; фактический брак остаётся браком.',
    )
  })

  it('allows empty availability when no related report history exists', () => {
    const draft = { id: 1, joint: 'S1', hasVik: null, pstoRequired: null } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('allows unrelated weld form edits when an old LNK chronology issue already exists', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '10.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      rkRequest: 'Заявка-РК',
      rkRequestDate: '08.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      responsible: 'Иванов',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('blocks weld date edits when the new date breaks LNK chronology', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '07.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      rkRequest: 'Заявка-РК',
      rkRequestDate: '08.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      weldDate: '10.07.2026',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-04 · Стык S1: дата заявки РК (08.07.2026) раньше даты сварки (10.07.2026).',
    )
  })

  it('blocks request date edits when the new date breaks LNK chronology', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '07.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      rkRequest: 'Заявка-РК',
      rkRequestDate: '08.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      rkRequestDate: '06.07.2026',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-04 · Стык S1: дата заявки РК (06.07.2026) раньше даты сварки (07.07.2026).',
    )
  })

  it('allows unrelated weld form edits when an old PSTO chronology issue already exists', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '10.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      pstoRequest: 'Заявка-ПСТО',
      pstoRequestDate: '08.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      responsible: 'Петров',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('blocks weld date edits when the new date breaks PSTO chronology', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '07.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      pstoRequest: 'Заявка-ПСТО',
      pstoRequestDate: '08.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      weldDate: '10.07.2026',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-04 · Стык S1: дата заявки ПСТО (08.07.2026) раньше даты сварки (10.07.2026).',
    )
  })

  it('blocks request date edits when the new date breaks PSTO chronology', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '07.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      pstoRequest: 'Заявка-ПСТО',
      pstoRequestDate: '08.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      pstoRequestDate: '06.07.2026',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-04 · Стык S1: дата заявки ПСТО (06.07.2026) раньше даты сварки (07.07.2026).',
    )
  })

  it('allows restoring a missing PSTO cycle when an old post-TO LNK document already exists', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '07.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Заявка-ВИК',
      vikRequestDate: '10.07.2026',
      vikResult: 'годен',
      vikConclusion: 'ЗНК-ВИК',
      vikConclusionDate: '10.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      pstoRequest: 'Заявка-ПСТО',
      pstoRequestDate: '08.07.2026',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('still blocks a new PSTO date error while restoring an incomplete cycle', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      weldDate: '07.07.2026',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'Заявка-ВИК',
      vikRequestDate: '10.07.2026',
      vikResult: 'годен',
      vikConclusion: 'ЗНК-ВИК',
      vikConclusionDate: '10.07.2026',
    } as WeldDraft
    const draft = {
      ...initialValue,
      pstoRequest: 'Заявка-ПСТО',
      pstoRequestDate: '06.07.2026',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-04 · Стык S1: дата заявки ПСТО (06.07.2026) раньше даты сварки (07.07.2026).',
    )
  })

  it('reads old RK/UZK replacement values as additional availability in form hints', () => {
    const draft = { id: 1, joint: 'S1', hasPvk: 'замена РК/УЗК' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('blocks saving D1/D2 edits when an existing LNK repair becomes forbidden by diameter', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      d1: '100',
      d2: '100',
      hasRk: 'да',
      rkResult: 'ремонт',
    } as WeldDraft
    const draft = {
      ...initialValue,
      d1: '55',
      d2: '57',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-07 · РК: Ремонт по РК недоступен при диаметре меньше 89 мм. Минимальный диаметр стыка: 55 мм.',
    )
  })

  it('blocks saving a new repair result on an existing small-diameter weld', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      d1: '55',
      d2: '57',
      hasVik: 'да',
      vikResult: 'годен',
      hasRk: 'да',
      rkResult: 'годен',
    } as WeldDraft
    const draft = {
      ...initialValue,
      rkResult: 'ремонт',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-07 · РК: Ремонт по РК недоступен при диаметре меньше 89 мм. Минимальный диаметр стыка: 55 мм.',
    )
  })

  it('cannot disable mandatory result rules for D1/D2 edits in the weld form', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      d1: '100',
      d2: '100',
      hasRk: 'да',
      rkResult: 'ремонт',
    } as WeldDraft
    const draft = {
      ...initialValue,
      d1: '55',
      d2: '57',
    } as WeldInput

    expect(
      getWeldFormSaveBlockReason(draft, initialValue, normalizeSaveCheckSettings({ lnkResultRepairRules: false })),
    ).toContain('СП-07')
  })

  it('shows SP-05 immediately for old rows that already have forbidden repair by diameter', () => {
    const initialValue = {
      id: 1,
      joint: 'S1',
      d1: '55',
      d2: '57',
      hasRk: 'да',
      rkResult: 'ремонт',
    } as WeldDraft
    const draft = {
      ...initialValue,
      responsible: 'Иванов',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'СП-07 · РК: Ремонт по РК недоступен при диаметре меньше 89 мм. Минимальный диаметр стыка: 55 мм.',
    )
  })

  it('allows disabling manual joint name validation for ordinary names', () => {
    const draft = { joint: '13' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, {} as WeldDraft)).toContain('начинаться')
    expect(
      getWeldFormSaveBlockReason(draft, {} as WeldDraft, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        manualJointName: false,
      }),
    ).toBeNull()
  })

  it('shows ZV-26 immediately for an old malformed joint name', () => {
    const malformedInitial = { id: 2, joint: 'F1R', responsible: '' } as WeldDraft
    const draft = { ...malformedInitial, responsible: 'Иванов' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, malformedInitial)).toContain('ЗВ-02')
  })

  it('keeps an existing indexed base editable after the setting is disabled', () => {
    const indexedInitial = { id: 3, joint: 'FB01', responsible: '' } as WeldDraft
    const draft = { ...indexedInitial, responsible: 'Иванов' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, indexedInitial)).toBeNull()
  })

  it('allows a new indexed base only when the project setting is enabled', () => {
    const draft = { joint: 'SB43' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, {} as WeldDraft)).toContain('ЗВ-02')
    expect(getWeldFormSaveBlockReason(draft, {} as WeldDraft, DEFAULT_SAVE_CHECK_SETTINGS, {
      systemIndexSettings: {
        ...DEFAULT_SYSTEM_INDEX_SETTINGS,
        allowLeadingLetterIndex: true,
      },
    })).toBeNull()
  })

  it('keeps R/W/Y descendants reserved for system actions', () => {
    const settings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      allowLeadingLetterIndex: true,
    }
    const draft = { joint: 'FB01R1' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, {} as WeldDraft, DEFAULT_SAVE_CHECK_SETTINGS, {
      systemIndexSettings: settings,
    })).toContain('зарезервированы')
    expect(getWeldFormSaveBlockReason(draft, {} as WeldDraft, DEFAULT_SAVE_CHECK_SETTINGS, {
      allowSystemJointName: true,
      systemIndexSettings: settings,
    })).toBeNull()
  })

  it('keeps date format mandatory while future weld date validation remains configurable', () => {
    const malformedDraft = {
      id: 1,
      joint: 'S1',
      weldDate: 'не дата',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput
    const futureDraft = {
      id: 1,
      joint: 'S1',
      weldDate: '2099-01-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput
    const settings = {
      ...DEFAULT_SAVE_CHECK_SETTINGS,
      dateFormat: false,
      weldDateNotFuture: true,
    }

    expect(getWeldFormSaveBlockReason(malformedDraft, initialValue, settings)).toBe('дата сварки: укажите дату в формате ДД.ММ.ГГГГ или ДД.ММ.ГГ.')
    expect(getWeldFormSaveBlockReason(futureDraft, initialValue, settings)).toBe('СП-04 · дата сварки не может быть позже сегодняшней.')
  })

  it('does not disable the ban on future factual weld dates', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2099-01-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput

    expect(
      getWeldFormSaveBlockReason(draft, initialValue, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        dateFormat: false,
        weldDateNotFuture: false,
      }),
    ).toContain('СП-04')
  })

  it('does not let a legacy stamp issue block an unrelated field edit in the form', () => {
    const initialValue = { id: 1, joint: 'S1', stamp1K: 'OLD' } as WeldDraft
    const draft = { ...initialValue, responsible: 'Иванов' } as WeldInput

    expect(getWeldStampSaveBlockReason(draft, { stamp1K: [] }, {
      initialValue,
      saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
    })).toBeNull()
  })

  it('rechecks the official stamp despite the old registry toggle', () => {
    const initialValue = { id: 1, joint: 'S1', stamp1K: 'OLD' } as WeldDraft
    const draft = { ...initialValue, stamp1K: 'NEW' } as WeldInput

    expect(getWeldStampSaveBlockReason(draft, { stamp1K: [] }, {
      initialValue,
      saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
    })).toContain('СП-02')
    expect(getWeldStampSaveBlockReason(draft, { stamp1K: [] }, {
      initialValue,
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        officialRegistry: false,
      },
    })).toContain('СП-02')
  })

  it('keeps archive and DLS option failures on their own save-check codes', () => {
    const draft = { joint: 'S1', stamp1K: 'ABC1' } as WeldInput

    expect(getWeldStampSaveBlockReason(draft, {
      stamp1K: [{ value: 'ABC1', disabled: true, reason: 'клеймо в архиве, дата архивации не указана' }],
    })).toContain('ЗВ-01')
    expect(getWeldStampSaveBlockReason(draft, {
      stamp1K: [{ value: 'ABC1', disabled: true, reason: 'нет ДЛС на способ сварки РД' }],
    })).toContain('СП-02')
  })

  it('does not disable system joint rename protection', () => {
    const draft = { id: 1, joint: 'F2' } as WeldInput
    const repeatedInitialValue = { id: 1, joint: 'F1R1' } as WeldDraft

    expect(getWeldFormSaveBlockReason(draft, repeatedInitialValue)).toContain('нельзя переименовывать вручную')
    expect(
      getWeldFormSaveBlockReason(draft, repeatedInitialValue, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        systemJointRenameProtection: false,
      }),
    ).toContain('СП-09')
  })





  it('does not explain cancellation that was already present when the dialog opened', () => {
    const initialValue = { id: 1, joint: 'S1', hasRk: 'отменен', rkResult: 'годен' } as WeldDraft
    const draft = { id: 1, joint: 'S1', hasRk: 'отменен', rkResult: 'годен' } as WeldInput

    expect(getWeldFormCancellationResultHint(draft, initialValue)).toBeNull()
  })

  it('explains active LNK result restoration after cancelled positive result', () => {
    const initialValue = { id: 1, joint: 'S1', hasRk: 'отменен', rkResult: 'годен' } as WeldDraft
    const draft = { id: 1, joint: 'S1', hasRk: 'да', rkResult: 'годен' } as WeldInput

    expect(getWeldFormReactivationResultHint(draft, initialValue)).toBe(
      'РК: сейчас «годен · назначение отменено», после сохранения будет «годен»',
    )
  })

  it('explains active LNK pending status after cancelled rejected cleanup', () => {
    const initialValue = { id: 1, joint: 'S1', hasRk: 'отменен', rkResult: 'отменен' } as WeldDraft
    const draft = { id: 1, joint: 'S1', hasRk: 'да', rkResult: 'отменен' } as WeldInput

    expect(getWeldFormReactivationResultHint(draft, initialValue)).toBe(
      'РК: сейчас «отменен», после сохранения будет «ожидает заявку»',
    )
  })

  it('explains active PSTO result restoration after cancelled conducted result', () => {
    const initialValue = { id: 1, joint: 'S1', pstoRequired: 'отменен', pstoResult: 'проведено' } as WeldDraft
    const draft = { id: 1, joint: 'S1', pstoRequired: 'да', pstoResult: 'проведено' } as WeldInput

    expect(getWeldFormReactivationResultHint(draft, initialValue)).toBe(
      'ПСТО: сейчас «проведено · назначение отменено», после сохранения будет «проведено»',
    )
  })
})
