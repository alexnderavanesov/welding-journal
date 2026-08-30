import { describe, expect, it } from 'vitest'

import {
  applyLatestPstoCycleToStatisticsRows,
  prepareStatisticsHeatTreatmentRows,
} from '@/lib/statistics-psto-cycle'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildStatisticsSummary } from '@/lib/statistics-summary'

describe('PSTO cycle values for statistics', () => {
  it('hydrates pre-TO controls before statistics and percentage-line calculations', () => {
    const [prepared] = prepareStatisticsHeatTreatmentRows(
      [{ id: 7, joint: 'F7', pstoRequired: 'да', hasRk: 'да' } as WeldRow],
      [],
      [{
        id: 17,
        weldJointId: 7,
        method: 'РК',
        requestName: 'Заявка РК до ТО',
        requestDate: '2026-08-01',
        result: 'ремонт',
        conclusionDate: '2026-08-02',
        conclusionName: 'Заключение РК до ТО',
      }],
    )

    expect(prepared.preHeatTreatmentControls).toHaveLength(1)
    expect(prepared.preRkResult).toBe('ремонт')
  })

  it('uses the latest repeat TVMT instead of the failed primary result', () => {
    const [row] = applyLatestPstoCycleToStatisticsRows([{
      id: 1,
      pstoRequired: 'да',
      tvmtRequest: 'ТВМТ-1',
      tvmtRequestDate: '2026-08-02',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-03',
      tvmtConclusion: 'ЗНК-ТВМТ-1',
    } as WeldRow], [
      {
        id: 11,
        weldJointId: 1,
        sequence: 2,
        tvmtRequest: 'ТВМТ-2',
        tvmtRequestDate: '2026-08-05',
        tvmtResult: 'годен',
        tvmtConclusionDate: '2026-08-06',
        tvmtConclusion: 'ЗНК-ТВМТ-2',
      },
    ])

    expect(row).toEqual(expect.objectContaining({
      tvmtRequest: 'ТВМТ-2',
      tvmtRequestDate: '2026-08-05',
      tvmtResult: 'годен',
      tvmtConclusionDate: '2026-08-06',
      tvmtConclusion: 'ЗНК-ТВМТ-2',
    }))
  })

  it('clears the old TVMT from current statistics while the repeat cycle is still at PSTO', () => {
    const [row] = applyLatestPstoCycleToStatisticsRows([{
      id: 1,
      pstoRequired: 'да',
      tvmtRequest: 'ТВМТ-1',
      tvmtResult: 'не годен',
      tvmtConclusion: 'ЗНК-ТВМТ-1',
    } as WeldRow], [{
      id: 12,
      weldJointId: 1,
      sequence: 2,
      pstoRequest: 'ПСТО-2',
    }])

    expect(row.tvmtRequest).toBeNull()
    expect(row.tvmtResult).toBeNull()
    expect(row.tvmtConclusion).toBeNull()
    expect(row.pstoRequest).toBe('ПСТО-2')
    expect(row.pstoResult).toBeNull()
  })

  it('uses PSTO and TVMT from one latest cycle', () => {
    const [row] = applyLatestPstoCycleToStatisticsRows([{
      id: 1,
      pstoRequest: 'ПСТО-1',
      pstoResult: 'проведено',
      tvmtResult: 'не годен',
    } as WeldRow], [{
      id: 13,
      weldJointId: 1,
      sequence: 2,
      pstoRequest: 'ПСТО-2',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'ТВМТ-2',
      tvmtResult: 'годен',
    }])

    expect(row).toEqual(expect.objectContaining({
      pstoRequest: 'ПСТО-2',
      pstoResult: 'проведено',
      pstoDate: '2026-08-10',
      tvmtRequest: 'ТВМТ-2',
      tvmtResult: 'годен',
    }))
  })

  it('keeps a physically started repeat in statistics after official line cancellation', () => {
    const rows = applyLatestPstoCycleToStatisticsRows([{
      id: 1,
      weldDate: '2026-08-01',
      pstoRequired: 'отменен',
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      tvmtRequest: 'ТВМТ-1',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-04',
    } as WeldRow], [{
      id: 14,
      weldJointId: 1,
      sequence: 2,
      pstoRequest: 'ПСТО-2',
      pstoRequestDate: '2026-08-05',
      pstoDate: '2026-08-06',
      pstoResult: 'проведено',
    }])

    const summary = buildStatisticsSummary(rows, '2026-08-01', '2026-08-31', 'joints')

    expect(summary.pstoMethod).toMatchObject({
      requiredRequests: 1,
      createdRequests: 1,
      requests: 1,
      closed: 1,
      waitingControl: 0,
    })
    expect(summary.tvmtMethod).toMatchObject({
      requiredRequests: 1,
      createdRequests: 0,
      waitingRequest: 1,
    })
  })

  it('ignores a stale request-only repeat after moving to a line without PSTO', () => {
    const rows = applyLatestPstoCycleToStatisticsRows([{
      id: 2,
      weldDate: '2026-08-01',
      pstoRequired: null,
      pstoRequest: 'ПСТО-1',
      pstoRequestDate: '2026-08-02',
      pstoResult: 'проведено',
      pstoDate: '2026-08-03',
      tvmtRequest: 'ТВМТ-1',
      tvmtResult: 'не годен',
      tvmtConclusionDate: '2026-08-04',
    } as WeldRow], [{
      id: 15,
      weldJointId: 2,
      sequence: 2,
      pstoRequest: 'ПСТО-2',
      pstoRequestDate: '2026-08-05',
    }])

    const summary = buildStatisticsSummary(rows, '2026-08-01', '2026-08-31', 'joints')

    expect(rows[0]?.pstoRepeatCycles).toHaveLength(0)
    expect(summary.pstoMethod).toMatchObject({
      requiredRequests: 1,
      createdRequests: 1,
      requests: 1,
      closed: 1,
      waitingControl: 0,
    })
    expect(summary.tvmtMethod).toMatchObject({ requiredRequests: 1, rejected: 1 })
  })
})
