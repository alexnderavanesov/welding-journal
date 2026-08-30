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
    expect(draft.finalStatus).toBe('ожидает ремонт')
  })
})
