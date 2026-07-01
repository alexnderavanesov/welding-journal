import { describe, expect, it } from 'vitest'

import type { WeldDraft } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'
import {
  getWeldFormAutoClearHint,
  getWeldFormCancellationResultHint,
  getWeldFormReactivationResultHint,
  getWeldFormSaveBlockReason,
} from '@/lib/weld-form-save-reasons'

describe('getWeldFormSaveBlockReason', () => {
  const initialValue = { id: 1, joint: 'S1' } as WeldDraft

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
      'ВИК: выберите «отменен» либо очистите/удалите результат НК в отчете ЛНК.',
    )
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
      'ПСТО: заявка и дата на стык будут удалены',
    )
  })

  it('blocks clearing PSTO availability when heat treatment report history exists', () => {
    const draft = { id: 1, joint: 'S1', pstoRequired: null, pstoDate: '10.06.2026', pstoResult: 'проведено' } as WeldInput

    expect(getWeldFormSaveBlockReason(draft, initialValue)).toBe(
      'ПСТО: выберите «отменен» либо очистите/удалите результат ПСТО.',
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
      'ВИК: заявка на стык будет удалена; ПСТО: заявка и дата на стык будут удалены',
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
      'ПСТО: заявка и дата на стык будут удалены',
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
