import { describe, expect, it } from 'vitest'

import {
  PRE_HEAT_TREATMENT_LNK_METHODS,
  buildPreHeatTreatmentControlSnapshot,
  buildPrimaryLnkControlSnapshot,
  getRequiredLnkControlStages,
  getPrimaryLnkStageBlockReason,
  getPrimaryPstoStartBlockReason,
  getPrimaryPstoStartStatusLabel,
  getRejectedPreHeatTreatmentControls,
  isPreHeatTreatmentLnkMethodCode,
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
    expect(isPreHeatTreatmentLnkMethodCode('РФА')).toBe(false)
    expect(isPreHeatTreatmentLnkMethodCode('СТЛС')).toBe(false)
    expect(isPreHeatTreatmentLnkMethodCode('МКК')).toBe(false)
  })

  it('requires both stages only when PSTO and the selected method are assigned', () => {
    const row = { pstoRequired: 'да', hasVik: 'да', hasRk: 'да', hasRfa: 'да' }

    expect(getRequiredLnkControlStages(row, 'ВИК')).toEqual(['beforeHeatTreatment', 'primary'])
    expect(getRequiredLnkControlStages(row, 'РК')).toEqual(['beforeHeatTreatment', 'primary'])
    expect(getRequiredLnkControlStages(row, 'РФА')).toEqual(['primary'])
    expect(getRequiredLnkControlStages(row, 'УЗК')).toEqual([])
  })

  it('keeps every assigned method in the primary stage when PSTO is absent', () => {
    const row = { pstoRequired: '', hasVik: 'да', hasRfa: 'да' }

    expect(getRequiredLnkControlStages(row, 'ВИК')).toEqual(['primary'])
    expect(getRequiredLnkControlStages(row, 'РФА')).toEqual(['primary'])
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
    expect(getPrimaryLnkStageBlockReason(base, 'РФА')).toBe('')
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
