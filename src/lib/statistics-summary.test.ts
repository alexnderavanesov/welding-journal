import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildStatisticsStateRowIds, buildStatisticsSummary, getCurrentStatisticsWeek } from '@/lib/statistics-summary'

describe('getCurrentStatisticsWeek', () => {
  it('returns the local Monday through Sunday containing the selected day', () => {
    expect(getCurrentStatisticsWeek(new Date(2026, 7, 19, 12))).toEqual({
      from: '2026-08-17',
      to: '2026-08-23',
    })
  })
})

describe('buildStatisticsSummary', () => {
  it('counts only real PSTO results as closed', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', pstoRequest: 'ПСТО-001', pstoRequestDate: '2026-07-01', pstoDate: '2026-07-02', pstoResult: 'проведено' },
      { id: 2, weldDate: '2026-07-01', pstoRequest: 'ПСТО-002', pstoRequestDate: '2026-07-01', pstoDate: '2026-07-02', pstoResult: 'проведено (отменен)' },
      { id: 3, weldDate: '2026-07-01', pstoRequired: 'отменен', pstoRequest: 'ПСТО-003', pstoResult: 'отменен' },
      { id: 4, weldDate: '2026-07-01', pstoDate: '2026-07-02', pstoResult: 'проведено' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.pstoRequests).toBe(2)
    expect(summary.pstoClosed).toBe(2)
    expect(summary.pstoTotalClosed).toBe(3)
    expect(summary.pstoMethod.closedWithoutRequest).toBe(1)
    expect(summary.pstoClosurePercent).toBe(100)
  })

  it('does not count PSTO rows with no need in request and closure statistics', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-001',
        pstoRequestDate: '2026-07-01',
        pstoDate: '2026-07-02',
        pstoResult: 'проведено',
      },
      {
        id: 2,
        weldDate: '2026-07-01',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-002',
        pstoRequestDate: '2026-07-01',
        pstoDate: '2026-07-02',
        pstoResult: 'проведено',
      },
      {
        id: 3,
        weldDate: '2026-07-01',
        finalStatus: 'не годен',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-003',
        pstoResult: 'ожидает заявку',
      },
      {
        id: 4,
        weldDate: '2026-07-01',
        pstoRequired: 'отменен',
        pstoRequest: 'ПСТО-004',
        pstoResult: 'отменен',
      },
      {
        id: 5,
        weldDate: '2026-07-01',
        pstoRequired: 'да',
      },
      {
        id: 6,
        weldDate: '2026-07-01',
        pstoRequired: 'да',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.pstoRequests).toBe(2)
    expect(summary.pstoClosed).toBe(2)
    expect(summary.pstoTotalClosed).toBe(2)
    expect(summary.pstoMethod.waitingRequest).toBe(2)
    expect(summary.pstoClosurePercent).toBe(100)
  })

  it('does not count cancelled LNK controls as closed results', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', rkRequest: 'Заявка-001', rkRequestDate: '2026-07-01', rkConclusionDate: '2026-07-02', rkResult: 'годен' },
      { id: 2, weldDate: '2026-07-01', rkRequest: 'Заявка-002', rkRequestDate: '2026-07-01', rkConclusionDate: '2026-07-02', rkResult: 'годен (отменен)' },
      { id: 3, weldDate: '2026-07-01', hasRk: 'отменен', rkRequest: 'Заявка-003', rkResult: 'отменен' },
      { id: 4, weldDate: '2026-07-01', rkConclusionDate: '2026-07-02', rkResult: 'ремонт' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')
    const rk = summary.methods.find((method) => method.code === 'РК')

    expect(rk?.requests).toBe(2)
    expect(rk?.closed).toBe(2)
    expect(rk?.totalClosed).toBe(3)
    expect(rk?.closedWithoutRequest).toBe(1)
    expect(rk?.closurePercent).toBe(100)
  })

  it('does not count LNK rows with no need in request and closure statistics', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkRequest: 'Заявка-001',
        rkRequestDate: '2026-07-01',
        rkConclusionDate: '2026-07-02',
        rkResult: 'годен',
      },
      {
        id: 2,
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkRequest: 'Заявка-002',
        rkRequestDate: '2026-07-01',
        rkConclusionDate: '2026-07-02',
        rkResult: 'годен (отменен)',
      },
      {
        id: 3,
        weldDate: '2026-07-01',
        hasVik: 'да',
        vikResult: 'вырез',
        hasRk: 'да',
        rkRequest: 'Заявка-003',
        rkResult: 'ожидает НК',
      },
      {
        id: 4,
        weldDate: '2026-07-01',
        hasRk: 'отменен',
        rkRequest: 'Заявка-004',
        rkResult: 'отменен',
      },
      {
        id: 5,
        weldDate: '2026-07-01',
        hasRk: 'да',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')
    const rk = summary.methods.find((method) => method.code === 'РК')

    expect(rk?.requests).toBe(2)
    expect(rk?.closed).toBe(2)
    expect(rk?.totalClosed).toBe(2)
    expect(rk?.good).toBe(2)
    expect(rk?.waitingRequest).toBe(1)
    expect(rk?.closurePercent).toBe(100)
  })

  it('separates waiting request and waiting control counters', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', hasVik: 'да' },
      { id: 2, weldDate: '2026-07-01', hasVik: 'да', vikRequest: 'Заявка-001', vikRequestDate: '2026-07-01' },
      { id: 3, weldDate: '2026-07-01', hasVik: 'да', vikRequest: 'Заявка-002', vikRequestDate: '2026-07-01', vikConclusionDate: '2026-07-02', vikResult: 'годен' },
      { id: 4, weldDate: '2026-07-01', hasVik: 'отменен', vikRequest: 'Заявка-003' },
      { id: 5, weldDate: '2026-07-01', hasVik: 'да', vikConclusionDate: '2026-07-02', vikResult: 'ремонт' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')
    const vik = summary.methods.find((method) => method.code === 'ВИК')

    expect(vik?.requests).toBe(2)
    expect(vik?.closed).toBe(1)
    expect(vik?.waitingControl).toBe(1)
    expect(vik?.waitingRequest).toBe(1)
    expect(vik?.closedWithoutRequest).toBe(1)
    expect(summary.waitingControl).toBe(1)
    expect(vik?.rowIds).toMatchObject({
      requests: [2, 3],
      closed: [3],
      closedWithoutRequest: [5],
      waitingRequest: [1],
      waitingControl: [2],
    })
    expect(buildStatisticsStateRowIds(rows, '2026-07-01', '2026-07-31', 'joints').waitingControl).toEqual([2])
  })

  it('counts events by their own dates in the default mode', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-06-20',
        hasVik: 'да',
        vikRequest: 'Заявка-001',
        lnkCreatedAt: '2026-07-02T10:00:00.000Z',
        vikConclusionDate: '2026-08-01',
        vikResult: 'годен',
      },
      {
        id: 2,
        weldDate: '2026-06-21',
        hasVik: 'да',
        vikRequest: 'Заявка-002',
        lnkCreatedAt: '2026-06-30T10:00:00.000Z',
        vikConclusionDate: '2026-07-03',
        vikResult: 'годен',
      },
      {
        id: 3,
        weldDate: '2026-07-04',
        hasVik: 'да',
      },
      {
        id: 4,
        weldDate: '2026-06-25',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-001',
        pstoCreatedAt: '2026-07-05T10:00:00.000Z',
        pstoDate: '2026-07-06',
        pstoResult: 'проведено',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')
    const vik = summary.methods.find((method) => method.code === 'ВИК')

    expect(summary.totalRows).toBe(1)
    expect(summary.welded).toBe(1)
    expect(vik?.requests).toBe(1)
    expect(vik?.closed).toBe(1)
    expect(vik?.waitingRequest).toBe(1)
    expect(summary.pstoRequests).toBe(1)
    expect(summary.pstoClosed).toBe(1)
    expect(summary.controlDynamics).toEqual([
      expect.objectContaining({ date: '2026-07-02', lnkRequests: 1, lnkClosed: 0, lnkRequestRowIds: [1] }),
      expect.objectContaining({ date: '2026-07-03', lnkRequests: 0, lnkClosed: 1, lnkClosedRowIds: [2] }),
      expect.objectContaining({ date: '2026-07-05', pstoRequests: 1, pstoClosed: 0, pstoRequestRowIds: [4] }),
      expect.objectContaining({ date: '2026-07-06', pstoRequests: 0, pstoClosed: 1, pstoClosedRowIds: [4] }),
    ])
  })

  it('groups control events into calendar weeks and preserves exact clickable row ids', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-06-20',
        hasVik: 'да',
        vikRequest: 'Заявка-001',
        vikRequestDate: '2026-07-01',
        vikConclusionDate: '2026-07-02',
        vikResult: 'годен',
      },
      {
        id: 2,
        weldDate: '2026-06-21',
        hasVik: 'да',
        hasRk: 'да',
        vikRequest: 'Заявка-002',
        vikRequestDate: '2026-07-05',
        rkRequest: 'Заявка-003',
        rkRequestDate: '2026-07-05',
        vikConclusionDate: '2026-07-06',
        vikResult: 'годен',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints', undefined, 'week')

    expect(summary.controlDynamicsScale).toBe('week')
    expect(summary.controlDynamics).toEqual([
      expect.objectContaining({
        date: '2026-06-29',
        dateTo: '2026-07-05',
        lnkRequests: 3,
        lnkClosed: 1,
        lnkRequestRowIds: [1, 2],
        lnkClosedRowIds: [1],
      }),
      expect.objectContaining({
        date: '2026-07-06',
        dateTo: '2026-07-12',
        lnkRequests: 0,
        lnkClosed: 1,
        lnkRequestRowIds: [],
        lnkClosedRowIds: [2],
      }),
    ])
  })

  it('automatically uses monthly buckets for a one-year period', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-08-10',
        hasVik: 'да',
        vikRequest: 'Заявка-001',
        vikRequestDate: '2026-08-12',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-01-01', '2026-12-31', 'joints', undefined, 'auto')

    expect(summary.controlDynamicsScale).toBe('month')
    expect(summary.controlDynamics).toEqual([
      expect.objectContaining({
        date: '2026-08-01',
        dateTo: '2026-08-31',
        lnkRequests: 1,
        lnkRequestRowIds: [1],
      }),
    ])
  })

  it('counts method request positions and positive cancelled results in event statistics', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        hasRk: 'отменен',
        rkRequest: 'Заявка-02.07.2026-001',
        rkResult: 'отменен',
      },
      {
        id: 2,
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkRequest: 'Заявка-02.07.2026-004',
        rkResult: 'ожидает НК',
      },
      {
        id: 3,
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkRequest: 'Заявка-02.07.2026-003',
        rkResult: 'ожидает НК',
      },
      {
        id: 4,
        weldDate: '2026-07-01',
        hasRk: 'отменен',
        rkRequest: 'Заявка-01.07.2026-005',
        rkConclusionDate: '2026-07-01',
        rkResult: 'годен (отменен)',
      },
      {
        id: 5,
        weldDate: '2026-07-01',
        hasRk: 'да',
        rkRequest: 'Заявка-01.07.2026-006',
        rkConclusionDate: '2026-07-01',
        rkResult: 'годен',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')
    const rk = summary.methods.find((method) => method.code === 'РК')

    expect(rk?.requests).toBe(4)
    expect(rk?.closed).toBe(2)
    expect(rk?.good).toBe(2)
    expect(rk?.waitingControl).toBe(2)
    expect(rk?.closurePercent).toBe(50)
  })

  it('counts request coverage by welded joint positions independently of WDI and request dates', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-10',
        wdi: '',
        hasVik: 'да',
        vikRequest: 'Заявка-ВИК-001',
        vikRequestDate: '2026-06-30',
        hasRk: 'дополнительный',
        pstoRequired: 'дополнительный',
        pstoRequest: 'ПСТО-001',
        pstoRequestDate: '2026-06-29',
      },
      {
        id: 2,
        weldDate: '2026-07-11',
        wdi: '0',
        hasVik: 'да',
        pstoRequired: 'да',
      },
      {
        id: 3,
        weldDate: '2026-06-20',
        wdi: '12',
        hasVik: 'да',
        vikRequest: 'Заявка-ВИК-002',
        vikRequestDate: '2026-07-15',
        pstoRequired: 'да',
        pstoRequest: 'ПСТО-002',
        pstoRequestDate: '2026-07-15',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'wdi')
    const vik = summary.methods.find((method) => method.code === 'ВИК')
    const rk = summary.methods.find((method) => method.code === 'РК')

    expect(vik).toMatchObject({
      requiredRequests: 2,
      createdRequests: 1,
      requestCoveragePercent: 50,
      requests: 12,
    })
    expect(rk).toMatchObject({
      requiredRequests: 1,
      createdRequests: 0,
      requestCoveragePercent: 0,
    })
    expect(summary.lnkRequiredRequests).toBe(3)
    expect(summary.lnkCreatedRequests).toBe(1)
    expect(summary.lnkRequestCoveragePercent).toBeCloseTo(100 / 3)
    expect(summary.pstoRequiredRequests).toBe(2)
    expect(summary.pstoCreatedRequests).toBe(1)
    expect(summary.pstoRequestCoveragePercent).toBe(50)
    expect(summary.pstoRequests).toBe(12)
  })

  it('counts welded repeated joints as completed repairs', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', joint: 'S1' },
      { id: 2, weldDate: '2026-07-02', joint: 'S1R1' },
      { id: 3, weldDate: '2026-07-03', joint: 'S1R1W1' },
      { id: 4, joint: 'S1R1W2' },
      { id: 5, weldDate: '2026-07-04', joint: 'S2Y1' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.completedRepairs).toBe(3)
  })

  it('keeps the current unwelded backlog separate from period statistics', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', hasVik: 'да', vikRequest: 'Заявка-001', vikResult: 'годен' },
      { id: 2, joint: 'S2' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.welded).toBe(1)
    expect(summary.totalRows).toBe(1)
    expect(summary.waitingWeld).toBe(0)
    expect(summary.backlogTotal).toBe(1)
    expect(summary.backlogWaitingWeld).toBe(1)
    expect(summary.backlogWaitingRepair).toBe(0)
  })

  it('returns only ids from the same period and backlog status rules', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', hasVik: 'да', vikResult: 'годен' },
      { id: 2, weldDate: '2026-07-02', hasVik: 'да', vikResult: 'вырез' },
      { id: 3, weldDate: '2026-06-30', hasVik: 'да', vikResult: 'годен' },
      { id: 4, joint: 'S4' },
    ] as WeldRow[]

    const ids = buildStatisticsStateRowIds(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(ids.good).toEqual([1])
    expect(ids.rejected).toEqual([2])
    expect(ids.backlog).toEqual([4])
    expect(ids.backlogWaitingWeld).toEqual([4])
  })

  it('counts good and rejected duplicate results once per joint and keeps their links independent', () => {
    const duplicate = (id: number, result: 'годен' | 'ремонт' | 'вырез') => ({
      id,
      weldJointId: id,
      method: 'ВИК' as const,
      result,
      controlDate: '2026-07-10',
      conclusion: `Дубль-${id}`,
      conclusionDate: '2026-07-11',
    })
    const rows = [
      { id: 1, weldDate: '2026-07-01', wdi: '2', duplicateControls: [duplicate(1, 'годен'), duplicate(11, 'годен')] },
      { id: 2, weldDate: '2026-07-02', wdi: '3', duplicateControls: [duplicate(2, 'ремонт')] },
      { id: 3, weldDate: '2026-07-03', wdi: '4', duplicateControls: [duplicate(3, 'годен'), duplicate(4, 'вырез')] },
      { id: 4, weldDate: '2026-06-30', wdi: '5', duplicateControls: [duplicate(5, 'годен')] },
    ] as WeldRow[]

    const jointSummary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')
    const wdiSummary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'wdi')
    const ids = buildStatisticsStateRowIds(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(jointSummary.duplicateGood).toBe(2)
    expect(jointSummary.duplicateRejected).toBe(2)
    expect(wdiSummary.duplicateGood).toBe(6)
    expect(wdiSummary.duplicateRejected).toBe(7)
    expect(ids.duplicateGood).toEqual([1, 3])
    expect(ids.duplicateRejected).toEqual([2, 3])
  })

  it('counts official same-name repeat after unofficial rejected joint as waiting repair', () => {
    const rows = [
      {
        id: 1,
        projectTitle: 'УПС1',
        subtitleCode: '200',
        line: 'LIN-243-11-3321',
        joint: 'S2',
        weldDate: '2026-07-03',
        status: 'неофициальный',
        hasRk: 'да',
        rkResult: 'вырез',
      },
      {
        id: 2,
        projectTitle: 'УПС1',
        subtitleCode: '200',
        line: 'LIN-243-11-3321',
        joint: 'S2',
        hasRk: 'да',
      },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.waitingRepair).toBe(0)
    expect(summary.waitingWeld).toBe(0)
    expect(summary.backlogWaitingRepair).toBe(1)
  })
})
