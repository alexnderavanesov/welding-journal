import { describe, expect, it } from 'vitest'

import type { WeldDraft } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import {
  getWeldFormAutoClearHint,
  getWeldFormCancellationResultHint,
  getWeldFormReactivationResultHint,
  getWeldFormSaveBlockReason,
} from '@/lib/weld-form-save-reasons'

describe('getWeldFormSaveBlockReason', () => {
  const initialValue = { id: 1, joint: 'S1' } as WeldDraft

  it('requires a material group when the weld date is filled', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: '',
      connectionType: 'С17',
      weldingMethod: 'РД',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'ЗВ-29 · Укажите группу материалов: при заполненной дате сварки это поле обязательно.',
    )
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

  it('requires a connection type when the weld date is filled', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: '',
      weldingMethod: 'РД',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'ЗВ-30 · Укажите тип соединения: при заполненной дате сварки это поле обязательно.',
    )
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

  it('requires a welding method when the weld date is filled', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      weldDate: '2026-07-01',
      materialGroup: 'М01',
      connectionType: 'С17',
      weldingMethod: '',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'ЗВ-31 · Укажите способ сварки: при заполненной дате сварки это поле обязательно.',
    )
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

  it('allows clearing LNK availability when request only has pending NDT status', () => {
    const draft = { id: 1, joint: 'S1', hasVik: null, vikRequest: 'Заявка-001', vikResult: 'ожидает НК' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
    expect(getWeldFormAutoClearHint(draft, { ...initialValue, hasVik: 'да' } as WeldDraft)).toBe('ВИК: заявка на стык будет удалена')
  })

  it('blocks clearing LNK availability when method result history exists', () => {
    const draft = { id: 1, joint: 'S1', hasVik: null, vikRequest: 'Заявка-001', vikResult: 'годен' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'ЗВ-27 · ВИК: выберите «отменен» либо очистите/удалите результат НК в отчете ЛНК.',
    )
  })

  it('allows disabling control history protection in dangerous form checks', () => {
    const draft = { id: 1, joint: 'S1', hasVik: null, vikRequest: 'Заявка-001', vikResult: 'годен' } as WeldInput

    expect(
      getWeldFormSaveBlockReason(draft, initialValue, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        controlHistoryProtection: false,
      }),
    ).toBeNull()
  })

  it('allows cancelled LNK availability with existing method report history', () => {
    const draft = { id: 1, joint: 'S1', hasVik: 'отменен', vikRequest: 'Заявка-001' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('explains cancelled positive LNK result display', () => {
    const draft = { id: 1, joint: 'S1', hasVik: 'отменен', vikResult: 'годен' } as WeldInput

    expect(getWeldFormCancellationResultHint(draft, { ...initialValue, hasVik: 'да' } as WeldDraft)).toBe(
      'ВИК: результат уже внесен, статус будет «годен (отменен)»',
    )
  })

  it('explains cancelled rejected LNK result cleanup', () => {
    const draft = { id: 1, joint: 'S1', hasRk: 'отменен', rkResult: 'ремонт' } as WeldInput

    expect(getWeldFormCancellationResultHint(draft, { ...initialValue, hasRk: 'да' } as WeldDraft)).toBe(
      'РК: результат уже внесен (ремонт), статус будет «отменен», заявка, дата и заключение будут аннулированы',
    )
  })

  it('explains auto-cleared pending LNK request when availability is cancelled', () => {
    const draft = { id: 1, joint: 'S1', hasVik: 'отменен', vikRequest: 'Заявка-001', vikResult: 'ожидает НК' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
    expect(getWeldFormAutoClearHint(draft, { ...initialValue, hasVik: 'да' } as WeldDraft)).toBe('ВИК: заявка на стык будет удалена')
  })

  it('allows clearing PSTO availability when only request and date exist', () => {
    const draft = { id: 1, joint: 'S1', pstoRequired: null, pstoDate: '10.06.2026' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
  })

  it('allows clearing PSTO availability when request only has pending status', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      pstoRequired: null,
      pstoRequest: 'ПСТО-001',
      pstoDate: '10.06.2026',
      pstoResult: 'ожидает заявку',
    } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBeNull()
    expect(getWeldFormAutoClearHint(draft, { ...initialValue, pstoRequired: 'да' } as WeldDraft)).toBe(
      'ПСТО: заявка и даты на стык будут удалены',
    )
  })

  it('blocks clearing PSTO availability when heat treatment report history exists', () => {
    const draft = { id: 1, joint: 'S1', pstoRequired: null, pstoDate: '10.06.2026', pstoResult: 'проведено' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'ЗВ-27 · ПСТО: выберите «отменен» либо очистите/удалите результат ПСТО.',
    )
  })

  it('explains cancelled positive PSTO result display', () => {
    const draft = { id: 1, joint: 'S1', pstoRequired: 'отменен', pstoResult: 'проведено' } as WeldInput

    expect(getWeldFormCancellationResultHint(draft, { ...initialValue, pstoRequired: 'да' } as WeldDraft)).toBe(
      'ПСТО: результат уже внесен, статус будет «проведено (отменен)»',
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
      'ЗВ-16 · Стык S1: дата заявки РК 08.07.2026 раньше даты сварки 10.07.2026.',
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
      'ЗВ-16 · Стык S1: дата заявки РК 06.07.2026 раньше даты сварки 07.07.2026.',
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
      'ЗВ-24 · Стык S1: дата заявки ПСТО 08.07.2026 раньше даты сварки 10.07.2026.',
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
      'ЗВ-24 · Стык S1: дата заявки ПСТО 06.07.2026 раньше даты сварки 07.07.2026.',
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
      'ЗВ-20 · результат РК - «ремонт» нельзя сохранить при минимальном диаметре 55 мм. Для диаметра меньше 89 мм выберите «вырез» или исправьте D1/D2.',
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
      'ЗВ-20 · результат РК - «ремонт» нельзя сохранить при минимальном диаметре 55 мм. Для диаметра меньше 89 мм выберите «вырез» или исправьте D1/D2.',
    )
  })

  it('allows disabling LNK repair rules for D1/D2 edits in the weld form', () => {
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
      getWeldFormSaveBlockReason(draft, initialValue, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        lnkResultRepairRules: false,
      }),
    ).toBeNull()
  })

  it('shows ZV-20 immediately for old rows that already have forbidden repair by diameter', () => {
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
      'ЗВ-20 · результат РК - «ремонт» нельзя сохранить при минимальном диаметре 55 мм. Для диаметра меньше 89 мм выберите «вырез» или исправьте D1/D2.',
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

    expect(getWeldFormSaveBlockReason(draft, malformedInitial)).toContain('ЗВ-26')
  })

  it('keeps an existing indexed base editable after the setting is disabled', () => {
    const indexedInitial = { id: 3, joint: 'FB01', responsible: '' } as WeldDraft
    const draft = { ...indexedInitial, responsible: 'Иванов' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, indexedInitial)).toBeNull()
  })

  it('allows a new indexed base only when the project setting is enabled', () => {
    const draft = { joint: 'SB43' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, {} as WeldDraft)).toContain('ЗВ-26')
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

  it('allows disabling date format validation without disabling future weld date validation', () => {
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

    expect(getWeldFormSaveBlockReason(malformedDraft, initialValue, settings)).toBeNull()
    expect(getWeldFormSaveBlockReason(futureDraft, initialValue, settings)).toBe('ЗВ-12 · дата сварки не может быть позже сегодняшней.')
  })

  it('allows disabling all soft date checks', () => {
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
    ).toBeNull()
  })

  it('allows disabling system joint rename protection in dangerous form checks', () => {
    const draft = { id: 1, joint: 'F2' } as WeldInput
    const repeatedInitialValue = { id: 1, joint: 'F1R1' } as WeldDraft

    expect(getWeldFormSaveBlockReason(draft, repeatedInitialValue)).toContain('нельзя переименовывать вручную')
    expect(
      getWeldFormSaveBlockReason(draft, repeatedInitialValue, {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        systemJointRenameProtection: false,
      }),
    ).toBeNull()
  })

  it('explains auto-cleared request-only report data', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      hasVik: null,
      vikRequest: 'Заявка-001',
      pstoRequired: null,
      pstoRequest: 'ПСТО-001',
      pstoDate: '10.06.2026',
    } as WeldInput

    expect(getWeldFormAutoClearHint(draft, { ...initialValue, hasVik: 'да', pstoRequired: 'да' } as WeldDraft)).toBe(
      'ВИК: заявка на стык будет удалена; ПСТО: заявка и даты на стык будут удалены',
    )
  })

  it('explains auto-cleared PSTO request data when availability is cancelled without result', () => {
    const draft = {
      id: 1,
      joint: 'S1',
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-001',
      pstoDate: '10.06.2026',
    } as WeldInput

    expect(getWeldFormAutoClearHint(draft, { ...initialValue, pstoRequired: 'да' } as WeldDraft)).toBe(
      'ПСТО: заявка и даты на стык будут удалены',
    )
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
      'РК: сейчас «годен (отменен)», после сохранения будет «годен»',
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
      'ПСТО: сейчас «проведено (отменен)», после сохранения будет «проведено»',
    )
  })
})
