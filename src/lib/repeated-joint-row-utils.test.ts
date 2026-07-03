import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'

describe('getJointChainRows', () => {
  it('orders same-name unofficial sources by weld date before the official repeat', () => {
    const rows = [
      {
        id: 1,
        projectTitle: 'УПС1',
        subtitleCode: '200',
        line: 'LIN-243-11-3321',
        joint: 'S2',
        hasRk: 'да',
      },
      {
        id: 2,
        projectTitle: 'УПС1',
        subtitleCode: '200',
        line: 'LIN-243-11-3321',
        joint: 'S2',
        weldDate: '2026-07-02',
        status: 'неофициальный',
        hasRk: 'да',
        rkResult: 'вырез',
      },
      {
        id: 3,
        projectTitle: 'УПС1',
        subtitleCode: '200',
        line: 'LIN-243-11-3321',
        joint: 'S2',
        weldDate: '2026-07-01',
        status: 'неофициальный',
        hasPvk: 'да',
        pvkResult: 'вырез',
      },
      {
        id: 4,
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
        id: 5,
        projectTitle: 'УПС1',
        subtitleCode: '200',
        line: 'LIN-243-11-3321',
        joint: 'S2W1',
        weldDate: '2026-07-03',
        hasRk: 'да',
        rkResult: 'годен',
      },
    ] as WeldRow[]

    const chainRows = getJointChainRows(rows, rows[0])

    expect(chainRows.map((row) => row.id)).toEqual([3, 2, 4, 1, 5])
  })
})
