import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildStatisticsSummary } from '@/lib/statistics-summary'

describe('buildStatisticsSummary', () => {
  it('counts only real PSTO results as closed', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', pstoRequest: 'ПСТО-001', pstoResult: 'проведено' },
      { id: 2, weldDate: '2026-07-01', pstoRequest: 'ПСТО-002', pstoResult: 'проведено (отменен)' },
      { id: 3, weldDate: '2026-07-01', pstoRequired: 'отменен', pstoRequest: 'ПСТО-003', pstoResult: 'отменен' },
      { id: 4, weldDate: '2026-07-01', pstoResult: 'проведено' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints', 'welded-joints')

    expect(summary.pstoRequests).toBe(2)
    expect(summary.pstoClosed).toBe(2)
    expect(summary.pstoTotalClosed).toBe(3)
    expect(summary.pstoMethod.closedWithoutRequest).toBe(1)
    expect(summary.pstoClosurePercent).toBe(100)
  })

  it('does not count cancelled LNK controls as closed results', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', rkRequest: 'Заявка-001', rkResult: 'годен' },
      { id: 2, weldDate: '2026-07-01', rkRequest: 'Заявка-002', rkResult: 'годен (отменен)' },
      { id: 3, weldDate: '2026-07-01', hasRk: 'отменен', rkRequest: 'Заявка-003', rkResult: 'отменен' },
      { id: 4, weldDate: '2026-07-01', rkResult: 'ремонт' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints', 'welded-joints')
    const rk = summary.methods.find((method) => method.code === 'РК')

    expect(rk?.requests).toBe(2)
    expect(rk?.closed).toBe(2)
    expect(rk?.totalClosed).toBe(3)
    expect(rk?.closedWithoutRequest).toBe(1)
    expect(rk?.closurePercent).toBe(100)
  })

  it('separates waiting request and waiting control counters', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', hasVik: 'да' },
      { id: 2, weldDate: '2026-07-01', hasVik: 'да', vikRequest: 'Заявка-001' },
      { id: 3, weldDate: '2026-07-01', hasVik: 'да', vikRequest: 'Заявка-002', vikResult: 'годен' },
      { id: 4, weldDate: '2026-07-01', hasVik: 'отменен', vikRequest: 'Заявка-003' },
      { id: 5, weldDate: '2026-07-01', hasVik: 'да', vikResult: 'ремонт' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints', 'welded-joints')
    const vik = summary.methods.find((method) => method.code === 'ВИК')

    expect(vik?.requests).toBe(2)
    expect(vik?.closed).toBe(1)
    expect(vik?.waitingControl).toBe(1)
    expect(vik?.waitingRequest).toBe(1)
    expect(vik?.closedWithoutRequest).toBe(1)
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

  it('keeps unwelded pending joints visible in status statistics', () => {
    const rows = [
      { id: 1, weldDate: '2026-07-01', hasVik: 'да', vikRequest: 'Заявка-001', vikResult: 'годен' },
      { id: 2, joint: 'S2' },
    ] as WeldRow[]

    const summary = buildStatisticsSummary(rows, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.welded).toBe(1)
    expect(summary.totalRows).toBe(2)
    expect(summary.waitingWeld).toBe(1)
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

    expect(summary.waitingRepair).toBe(1)
    expect(summary.waitingWeld).toBe(0)
  })
})
