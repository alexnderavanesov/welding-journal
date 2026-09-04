import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import {
  getDuplicateJointKey,
  getJointChainRows,
  getRepeatedJointBranchKey,
} from '@/lib/repeated-joint-row-utils'
import { getDuplicateKeys } from '@/lib/weld-table-duplicates'

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
        officiality: 'неофициальный',
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
        officiality: 'неофициальный',
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
        officiality: 'неофициальный',
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

  it('does not mix indexed and similarly named base chains', () => {
    const rows = [
      jointRow(1, 'F01'),
      jointRow(2, 'F01R1'),
      jointRow(3, 'F01A'),
      jointRow(4, 'F01AR1'),
      jointRow(5, 'FB01'),
      jointRow(6, 'FB01R1'),
    ]

    expect(getJointChainRows(rows, rows[0]).map((row) => row.id)).toEqual([1, 2])
    expect(getJointChainRows(rows, rows[2]).map((row) => row.id)).toEqual([3, 4])
    expect(getJointChainRows(rows, rows[4]).map((row) => row.id)).toEqual([5, 6])
  })

  it('keeps composite chain and duplicate identities unambiguous', () => {
    const colonLeft = jointRow(1, 'F1', {
      projectTitle: 'A:B',
      subtitleCode: 'C',
    })
    const colonRight = jointRow(2, 'F1', {
      projectTitle: 'A',
      subtitleCode: 'B:C',
    })
    const pipeLeft = jointRow(3, 'F2', {
      projectTitle: 'A|B',
      subtitleCode: 'C',
    })
    const pipeRight = jointRow(4, 'F2', {
      projectTitle: 'A',
      subtitleCode: 'B|C',
    })

    expect(getJointChainConsistencyKey(colonLeft)).not.toBe(getJointChainConsistencyKey(colonRight))
    expect(getRepeatedJointBranchKey(colonLeft)).not.toBe(getRepeatedJointBranchKey(colonRight))
    expect(getDuplicateJointKey(pipeLeft)).not.toBe(getDuplicateJointKey(pipeRight))
    expect(getDuplicateKeys([pipeLeft, pipeRight])).toEqual(new Set())
  })
})

function jointRow(id: number, joint: string, values: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'LIN-1',
    joint,
    ...values,
  } as WeldRow
}
