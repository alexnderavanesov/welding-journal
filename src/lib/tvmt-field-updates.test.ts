import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPrimaryTvmtRequestRows,
  buildPrimaryTvmtResultRows,
  canAddPrimaryTvmtResult,
  canCreatePrimaryTvmtRequest,
} from '@/lib/tvmt-field-updates'

describe('primary TVMT updates', () => {
  it('creates a request only after PSTO and does not require the legacy assignment flag', () => {
    const source = row({ hasTvmt: null })
    expect(canCreatePrimaryTvmtRequest(source)).toBe(true)

    const [updated] = buildPrimaryTvmtRequestRows({
      records: [source],
      requestName: 'Заявка ТВМТ-001',
      requestDate: '2026-08-22',
    })
    expect(updated).toMatchObject({
      hasTvmt: null,
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-08-22',
      tvmtResult: 'ожидает НК',
      finalStatus: 'ожидает НК',
    })
  })

  it('blocks TVMT dates before PSTO', () => {
    expect(() => buildPrimaryTvmtRequestRows({
      records: [row()],
      requestName: 'Заявка ТВМТ-001',
      requestDate: '2026-08-20',
    })).toThrow('не может быть раньше даты ПСТО')
  })

  it('stores a failed TVMT without a repair or cut result', () => {
    const requested = row({
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-08-22',
      tvmtResult: 'ожидает НК',
    })
    expect(canAddPrimaryTvmtResult(requested)).toBe(true)

    const [updated] = buildPrimaryTvmtResultRows({
      records: [requested],
      controlDate: '2026-08-23',
      result: 'не годен',
      conclusionName: 'ЗНК-ТВМТ-001',
    })
    expect(updated).toMatchObject({
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-23',
      tvmtConclusion: 'ЗНК-ТВМТ-001',
      finalStatus: 'ожидает заявку',
    })
  })

  it('does not complete TVMT after an already stored primary LNK set', () => {
    const requested = row({
      tvmtRequest: 'Заявка ТВМТ-001',
      tvmtRequestDate: '2026-08-22',
      tvmtResult: 'ожидает НК',
      vikRequestDate: '2026-08-22',
      vikConclusionDate: '2026-08-22',
      vikConclusion: 'ЗНК-ВИК основной',
    })

    expect(() => buildPrimaryTvmtResultRows({
      records: [requested],
      controlDate: '2026-08-23',
      result: 'годен',
      conclusionName: 'ЗНК-ТВМТ-001',
    })).toThrow('раньше ТВМТ')
  })
})

function row(values: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 1,
    joint: 'F1',
    weldDate: '2026-08-15',
    pstoRequired: 'да',
    pstoRequest: 'Заявка ПСТО-001',
    pstoRequestDate: '2026-08-18',
    pstoDate: '2026-08-21',
    pstoResult: 'проведено',
    hasVik: 'да',
    preHeatTreatmentControls: [{
      id: 1,
      weldJointId: 1,
      method: 'ВИК',
      requestName: 'Заявка ВИК до ТО',
      requestDate: '2026-08-16',
      result: 'годен',
      conclusionDate: '2026-08-17',
      conclusionName: 'ЗНК-ВИК до ТО',
    }],
    vikRequest: 'Заявка ВИК-001',
    vikResult: 'годен',
    ...values,
  } as WeldRow
}
