import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildWelderStatisticsSummary } from '@/lib/welder-statistics-summary'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

describe('buildWelderStatisticsSummary', () => {
  it('splits WDI between fact stamps of one welder set as 40/30/30', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        wdi: '10',
        stamp1KFact: 'ROOT',
        stamp1ZFact: 'FILL',
        stamp1OFact: 'FILL',
        hasVik: 'да',
        vikResult: 'годен',
      },
    ] as WeldRow[]

    const summary = buildWelderStatisticsSummary(rows, [], '2026-07-01', '2026-07-31', 'wdi')

    expect(summary.rows.find((row) => row.stamp === 'ROOT')?.total).toBe(4)
    expect(summary.rows.find((row) => row.stamp === 'FILL')?.total).toBe(6)
    expect(summary.good).toBe(10)
  })

  it('splits WDI between two fact welder sets as 20/15/15 + 20/15/15', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        wdi: '10',
        stamp1KFact: 'A111',
        stamp1ZFact: 'A111',
        stamp1OFact: 'A111',
        stamp2KFact: 'B222',
        stamp2ZFact: 'B222',
        stamp2OFact: 'B222',
        hasRk: 'да',
        rkResult: 'вырез',
      },
    ] as WeldRow[]

    const summary = buildWelderStatisticsSummary(rows, [], '2026-07-01', '2026-07-31', 'wdi')

    expect(summary.rows.find((row) => row.stamp === 'A111')?.total).toBe(5)
    expect(summary.rows.find((row) => row.stamp === 'B222')?.total).toBe(5)
    expect(summary.rejected).toBe(10)
    expect(summary.defectPercent).toBe(100)
  })

  it('uses NAKS stamp when a fact internal stamp belongs to a registry record with NAKS', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        stamp1KFact: '1111',
        stamp1ZFact: '1111',
        stamp1OFact: '1111',
        hasVik: 'да',
        vikRequest: 'Заявка-001',
      },
    ] as WeldRow[]
    const welderStamps = [welderStamp({ naksStamp: 'ABC1', internalStamp: '1111', welderName: 'Иванов И.И.' })]

    const summary = buildWelderStatisticsSummary(rows, welderStamps, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0]).toMatchObject({
      stamp: 'ABC1',
      welderName: 'Иванов И.И.',
      total: 1,
      waitingControl: 1,
    })
  })

  it('uses internal stamp when the registry record has no NAKS stamp', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        stamp1KFact: '7777',
        stamp1ZFact: '7777',
        stamp1OFact: '7777',
        hasVik: 'да',
      },
    ] as WeldRow[]
    const welderStamps = [welderStamp({ naksStamp: '', internalStamp: '7777' })]

    const summary = buildWelderStatisticsSummary(rows, welderStamps, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.rows[0]).toMatchObject({
      stamp: '7777',
      total: 1,
      waitingRequest: 1,
    })
  })

  it('prefers exact NAKS stamp over another welder internal stamp alias', () => {
    const rows = [
      {
        id: 1,
        weldDate: '2026-07-01',
        stamp1KFact: 'ARCH',
        stamp1ZFact: 'ARCH',
        stamp1OFact: 'ARCH',
        hasVik: 'да',
      },
    ] as WeldRow[]
    const welderStamps = [
      welderStamp({ naksStamp: 'ABC1', internalStamp: 'ARCH', welderName: 'Петров Владислав' }),
      welderStamp({ naksStamp: 'ARCH', internalStamp: '', welderName: 'Иванов Иван' }),
    ]

    const summary = buildWelderStatisticsSummary(rows, welderStamps, '2026-07-01', '2026-07-31', 'joints')

    expect(summary.rows[0]).toMatchObject({
      stamp: 'ARCH',
      welderName: 'Иванов Иван',
      total: 1,
    })
  })

  it('tracks F/S totals and can filter welders by joint type', () => {
    const rows = [
      {
        id: 1,
        joint: 'S1',
        weldDate: '2026-07-01',
        stamp1KFact: 'ABC1',
        stamp1ZFact: 'ABC1',
        stamp1OFact: 'ABC1',
        hasVik: 'да',
        vikResult: 'годен',
      },
      {
        id: 2,
        joint: 'F2W1',
        weldDate: '2026-07-02',
        stamp1KFact: 'ABC1',
        stamp1ZFact: 'ABC1',
        stamp1OFact: 'ABC1',
        hasRk: 'да',
        rkResult: 'вырез',
      },
    ] as WeldRow[]

    const all = buildWelderStatisticsSummary(rows, [], '2026-07-01', '2026-07-31', 'joints')
    const onlyF = buildWelderStatisticsSummary(rows, [], '2026-07-01', '2026-07-31', 'joints', 'f')
    const onlyS = buildWelderStatisticsSummary(rows, [], '2026-07-01', '2026-07-31', 'joints', 's')

    expect(all.rows[0]).toMatchObject({ stamp: 'ABC1', total: 2, fTotal: 1, sTotal: 1, good: 1, rejected: 1 })
    expect(onlyF.rows[0]).toMatchObject({ stamp: 'ABC1', total: 1, fTotal: 1, sTotal: 0, rejected: 1 })
    expect(onlyS.rows[0]).toMatchObject({ stamp: 'ABC1', total: 1, fTotal: 0, sTotal: 1, good: 1 })
  })
})

function welderStamp(value: Partial<WelderStampRecord>): WelderStampRecord {
  return {
    id: 1,
    naksStamp: '',
    welderName: '',
    internalStamp: '',
    weldType: 'РАД',
    materialGroups: '',
    diameterFrom: '1',
    diameterTo: '1000',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    naksPermits: [],
    dlsPermits: [],
    archived: false,
    ...value,
  }
}
