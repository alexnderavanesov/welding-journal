import { describe, expect, it } from 'vitest'

import type { WeldInput } from '@/lib/weld-fields'
import {
  PRE_HEAT_TREATMENT_LNK_METHODS,
  buildPreHeatTreatmentControlSnapshot,
  buildPrimaryLnkControlSnapshot,
  getRequiredLnkControlStages,
  getPrimaryLnkStageAccess,
  getPrimaryLnkStageBlockReason,
  getPreHeatTreatmentPendingFinalStatus,
  getPrimaryPstoStartBlockReason,
  getPrimaryPstoStartStatusLabel,
  getRejectedPreHeatTreatmentControls,
  isPreHeatTreatmentLnkMethodCode,
  type PreHeatTreatmentControlRecord,
} from '@/lib/lnk-control-stage'

describe('LNK control stages', () => {
  it('allows pre-heat-treatment control only for VIK, RK, UZK and PVK', () => {
    expect(PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => method.code)).toEqual([
      'ВИК',
      'РК',
      'УЗК',
      'ПВК',
    ])
    expect(isPreHeatTreatmentLnkMethodCode(' вик ')).toBe(true)
    expect(isPreHeatTreatmentLnkMethodCode('ТВМТ')).toBe(false)
  })

  it('requires both stages only when PSTO and the selected method are assigned', () => {
    const row = { pstoRequired: 'да', hasVik: 'да', hasRk: 'да' }

    expect(getRequiredLnkControlStages(row, 'ВИК')).toEqual(['beforeHeatTreatment', 'primary'])
    expect(getRequiredLnkControlStages(row, 'РК')).toEqual(['beforeHeatTreatment', 'primary'])
    expect(getRequiredLnkControlStages(row, 'УЗК')).toEqual([])
  })

  it('keeps every assigned method in the primary stage when PSTO is absent', () => {
    const row = { pstoRequired: '', hasVik: 'да' }

    expect(getRequiredLnkControlStages(row, 'ВИК')).toEqual(['primary'])
  })

  it('requires pre-control for every assigned PSTO row, including obsolete exemptions', () => {
    const row = {
      pstoRequired: 'да',
      pstoRequest: 'Историческая заявка ПСТО',
      hasVik: 'да',
      preHeatTreatmentLnkExempt: true,
    }

    expect(getRequiredLnkControlStages(row, 'ВИК')).toEqual(['beforeHeatTreatment', 'primary'])
    expect(getPrimaryPstoStartBlockReason(row)).toContain('Сначала создайте заявки НК до ТО')
    expect(getPreHeatTreatmentPendingFinalStatus(row)).toBe('ожидает заявку')
    expect(getPrimaryLnkStageBlockReason(row, 'ВИК')).toContain('НК до ТО')
    expect(getPrimaryLnkStageBlockReason({
      ...row,
      pstoRequest: 'Заявка ПСТО',
      pstoDate: '2026-09-02',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-09-02',
    }, 'ВИК')).toContain('НК до ТО')
  })

  it('opens primary LNK after an officially cancelled cycle with failed TVMT', () => {
    expect(getPrimaryLnkStageBlockReason({
      pstoRequired: 'отменен',
      hasVik: 'да',
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'не годен',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
      }],
    } as WeldInput & { preHeatTreatmentControls: PreHeatTreatmentControlRecord[] }, 'ВИК')).toBe('')
  })

  it('treats all existing weld fields as the primary or post-heat-treatment record', () => {
    expect(buildPrimaryLnkControlSnapshot({
      rkRequest: 'Заявка РК-1',
      rkRequestDate: '2026-08-01',
      rkResult: 'годен',
      rkConclusionDate: '2026-08-02',
      rkConclusion: 'ЗНК-РК-1',
    }, 'РК')).toEqual({
      stage: 'primary',
      methodCode: 'РК',
      requestName: 'Заявка РК-1',
      requestDate: '2026-08-01',
      result: 'годен',
      conclusionDate: '2026-08-02',
      conclusionName: 'ЗНК-РК-1',
    })
  })

  it('rejects unsupported methods in pre-heat-treatment storage', () => {
    expect(buildPreHeatTreatmentControlSnapshot({
      id: 1,
      weldJointId: 10,
      method: 'ТВМТ',
      result: 'годен',
    })).toBeNull()

    expect(buildPreHeatTreatmentControlSnapshot({
      id: 2,
      weldJointId: 10,
      method: 'ВИК',
      result: 'годен',
    })).toMatchObject({
      stage: 'beforeHeatTreatment',
      methodCode: 'ВИК',
      result: 'годен',
    })
  })

  it('opens post-heat-treatment control only after pre-control, PSTO and good TVMT', () => {
    const base = {
      id: 1,
      joint: 'F1',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-11',
      preHeatTreatmentControls: [],
    }
    expect(getPrimaryLnkStageBlockReason(base, 'ВИК')).toContain('завершите НК до ТО: ВИК')

    const preComplete = {
      ...base,
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
        conclusionDate: '2026-08-04',
      }],
    }
    expect(getPrimaryLnkStageBlockReason(preComplete, 'ВИК')).toBe('')
    expect(getPrimaryLnkStageBlockReason({ ...preComplete, tvmtResult: 'не годен' }, 'ВИК'))
      .toContain('требуется повторная ПСТО')
  })

  it('keeps an incomplete staged workflow blocked in strict mode', () => {
    const access = getPrimaryLnkStageAccess({
      id: 1,
      joint: 'F1',
      pstoRequired: 'да',
      hasVik: 'да',
    } as unknown as Parameters<typeof getPrimaryLnkStageAccess>[0], 'ВИК', {
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })

    expect(access.status).toBe('blocked')
    expect(access.reason).toContain('Сначала завершите НК до ТО: ВИК')
    expect(access.debt?.missingPreHeatTreatmentControls).toEqual([
      { methodCode: 'ВИК', nextAction: 'request' },
    ])
  })

  it('allows manual primary LNK with a warning in permissive mode', () => {
    const access = getPrimaryLnkStageAccess({
      id: 1,
      joint: 'F1',
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
      }],
    } as unknown as Parameters<typeof getPrimaryLnkStageAccess>[0], 'ВИК', {
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: true,
    })

    expect(access.status).toBe('allowed-with-warning')
    expect(access.debt?.missingPreHeatTreatmentControls).toEqual([
      { methodCode: 'ВИК', nextAction: 'result' },
    ])
  })

  it('keeps the existing PSTO-to-primary sequence when pre-TO control is disabled', () => {
    const settings = {
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: true,
    }
    expect(getPrimaryLnkStageAccess({
      id: 1,
      joint: 'F1',
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentLnkExempt: true,
    } as unknown as Parameters<typeof getPrimaryLnkStageAccess>[0], 'ВИК', settings).status).toBe('blocked')
    expect(getPrimaryLnkStageAccess({
      id: 1,
      joint: 'F1',
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentLnkExempt: true,
      pstoRequest: 'Заявка ПСТО',
      pstoResult: 'проведено',
      tvmtRequest: 'Заявка ТВМТ',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-09-02',
    } as unknown as Parameters<typeof getPrimaryLnkStageAccess>[0], 'ВИК', settings)).toEqual({ status: 'ready', reason: '', debt: null })
  })

  it('keeps a rejected pre-TO result blocked even in permissive mode', () => {
    const access = getPrimaryLnkStageAccess({
      id: 1,
      joint: 'F1',
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'вырез',
      }],
    } as unknown as Parameters<typeof getPrimaryLnkStageAccess>[0], 'ВИК', {
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: true,
    })

    expect(access.status).toBe('blocked')
    expect(access.reason).toContain('Основной этап НК для этого стыка не требуется')
    expect(access.debt).toBeNull()
  })

  it('does not use duplicate controls in primary-stage readiness', () => {
    const row = {
      pstoRequired: 'да',
      hasVik: 'да',
      duplicateControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'годен' }],
    }

    expect(getPrimaryLnkStageBlockReason(row, 'ВИК')).toContain('завершите НК до ТО: ВИК')
    expect(getPrimaryPstoStartBlockReason(row)).toContain('создайте заявки НК до ТО: ВИК')
  })

  it('starts primary PSTO only after every assigned pre-TO method is good', () => {
    const base = {
      id: 1,
      pstoRequired: 'да',
      hasVik: 'да',
      hasRk: 'да',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'годен',
      }, {
        id: 2,
        weldJointId: 1,
        method: 'РК',
        requestName: 'Заявка РК до ТО',
        result: 'ожидает НК',
      }],
    }

    expect(getPrimaryPstoStartBlockReason(base as unknown as Parameters<typeof getPrimaryPstoStartBlockReason>[0]))
      .toContain('годные результаты НК до ТО: РК')
    expect(getPrimaryPstoStartStatusLabel(base as unknown as Parameters<typeof getPrimaryPstoStartStatusLabel>[0]))
      .toBe('ожидает НК до ТО: РК')
    expect(getPrimaryPstoStartBlockReason({
      ...base,
      preHeatTreatmentControls: base.preHeatTreatmentControls.map((control) => ({
        ...control,
        result: 'годен',
      })),
    } as unknown as Parameters<typeof getPrimaryPstoStartBlockReason>[0])).toBe('')
  })

  it('describes rejected pre-TO control as no need for downstream stages', () => {
    const rejected = {
      pstoRequired: 'да',
      hasVik: 'да',
      preHeatTreatmentControls: [{
        id: 1,
        weldJointId: 1,
        method: 'ВИК',
        requestName: 'Заявка ВИК до ТО',
        result: 'вырез',
      }],
    }

    expect(getPrimaryPstoStartBlockReason(rejected)).toContain('ПСТО и ТВМТ для этого стыка не требуются')
    expect(getPrimaryLnkStageBlockReason(rejected, 'ВИК')).toContain('Основной этап НК для этого стыка не требуется')
  })

  it('distinguishes a missing pre-TO request from an existing PSTO request', () => {
    expect(getPrimaryPstoStartStatusLabel({
      pstoRequired: 'да',
      hasVik: 'да',
    })).toBe('ожидает заявку НК до ТО: ВИК')
  })

  it('does not treat a rejected pre-TO result as active after the method is cancelled', () => {
    const control = {
      id: 1,
      weldJointId: 1,
      method: 'РК',
      requestName: 'Заявка РК до ТО',
      result: 'ремонт',
      conclusionDate: '2026-08-02',
      conclusionName: 'Заключение РК до ТО',
    }

    expect(getRejectedPreHeatTreatmentControls({
      pstoRequired: 'да',
      hasRk: 'да',
      preHeatTreatmentControls: [control],
    } as unknown as Parameters<typeof getRejectedPreHeatTreatmentControls>[0])).toHaveLength(1)
    expect(getRejectedPreHeatTreatmentControls({
      pstoRequired: 'да',
      hasRk: 'отменен',
      preHeatTreatmentControls: [control],
    } as unknown as Parameters<typeof getRejectedPreHeatTreatmentControls>[0])).toEqual([])
    expect(getRejectedPreHeatTreatmentControls({
      pstoRequired: 'отменен',
      hasRk: 'да',
      preHeatTreatmentControls: [control],
    } as unknown as Parameters<typeof getRejectedPreHeatTreatmentControls>[0])).toEqual([])
    expect(getRejectedPreHeatTreatmentControls({
      pstoRequired: 'отменен',
      pstoResult: 'проведено',
      hasRk: 'да',
      preHeatTreatmentControls: [control],
    } as unknown as Parameters<typeof getRejectedPreHeatTreatmentControls>[0])).toHaveLength(1)
  })
})
