import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'

describe('buildRepeatedJointDraft', () => {
  it('starts a fresh pre-TO, PSTO and TVMT cycle without copying related history', () => {
    const draft = buildRepeatedJointDraft({
      id: 10,
      joint: 'F1',
      weldDate: '2026-08-20',
      pstoRequired: 'да',
      hasVik: 'да',
      vikDefectDescription: 'Дефект исходного стыка',
      uzkDefectDescription: 'УЗК исходного стыка',
      pvkDefectDescription: 'ПВК исходного стыка',
      preHeatTreatmentControls: [{
        id: 21,
        weldJointId: 10,
        method: 'ВИК',
        requestName: 'Заявка до ТО',
        result: 'ремонт',
      }],
      pstoRepeatCycles: [{
        id: 31,
        weldJointId: 10,
        sequence: 2,
        pstoResult: 'проведено',
        tvmtResult: 'годен',
      }],
    }, 'F1R1')

    expect((draft as WeldRow).preHeatTreatmentControls).toEqual([])
    expect((draft as WeldRow).pstoRepeatCycles).toEqual([])
    expect(draft.pstoRequired).toBe('да')
    expect(draft.hasVik).toBe('да')
    expect(draft.vikDefectDescription).toBeNull()
    expect(draft.uzkDefectDescription).toBeNull()
    expect(draft.pvkDefectDescription).toBeNull()
    expect(draft.finalStatus).toBe('ожидает ремонт')
  })

  it('does not inherit a rejected duplicate control into a new coil joint', () => {
    const draft = buildRepeatedJointDraft({
      id: 10,
      joint: 'F1',
      weldDate: '2026-08-20',
      duplicateControls: [{
        id: 41,
        weldJointId: 10,
        method: 'РК',
        result: 'ремонт',
        controlDate: '2026-08-20',
        conclusion: 'Дубль РК',
        conclusionDate: '2026-08-20',
      }],
    } as WeldRow, 'F1Y1')

    expect((draft as WeldRow).duplicateControls).toEqual([])
    expect(draft.finalStatus).toBe('ожидает сварку')
  })
})
