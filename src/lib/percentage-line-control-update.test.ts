import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPercentageLineControlUpdateRows } from '@/lib/percentage-line-control-update'

describe('percentage-line control update', () => {
  it('assigns a current candidate after an authoritative full-line calculation', () => {
    const [updated] = buildPercentageLineControlUpdateRows({
      action: 'assign',
      method: 'РК',
      rows: makeRows(),
      scope: makeScope(),
      targetIds: [1],
    })

    expect(updated).toEqual(expect.objectContaining({ id: 1, hasRk: 'да' }))
  })

  it('rejects a stale action when another user has already closed the line calculation', () => {
    const rows = makeRows().map((row) => row.id === 2 ? { ...row, hasRk: 'да' } as WeldRow : row)

    expect(() => buildPercentageLineControlUpdateRows({
      action: 'assign',
      method: 'РК',
      rows,
      scope: makeScope(),
      targetIds: [1],
    })).toThrow('Расчет процентной линии уже изменился другим пользователем')
  })

  it('rejects more selected rows than the current missing count', () => {
    expect(() => buildPercentageLineControlUpdateRows({
      action: 'assign',
      method: 'УЗК',
      rows: makeRows(),
      scope: makeScope(),
      targetIds: [1, 2],
    })).toThrow('сейчас нужно закрыть не больше 1')
  })

  it('closes a current candidate by explicitly cancelling RK and UZK', () => {
    const [updated] = buildPercentageLineControlUpdateRows({
      action: 'cancel',
      rows: makeRows(),
      scope: makeScope(),
      targetIds: [1],
    })

    expect(updated).toEqual(expect.objectContaining({
      id: 1,
      hasRk: 'отменен',
      hasUzk: 'отменен',
    }))
  })

  it('uses case-insensitive line and stamp identities', () => {
    const [updated] = buildPercentageLineControlUpdateRows({
      action: 'assign',
      method: 'РК',
      rows: makeRows(),
      scope: {
        projectTitle: 'project a',
        subtitleCode: 'sub 1',
        line: 'line 10',
        stamp: 'abc1',
      },
      targetIds: [1],
    })

    expect(updated.id).toBe(1)
  })
})

function makeScope() {
  return {
    projectTitle: 'Project A',
    subtitleCode: 'Sub 1',
    line: 'Line 10',
    stamp: 'ABC1',
  }
}

function makeRows(): WeldRow[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    projectTitle: 'Project A',
    subtitleCode: 'Sub 1',
    line: 'Line 10',
    weldControlPercent: '10',
    joint: `S${index + 1}`,
    weldDate: '01.07.2026',
    stamp1K: index === 0 ? 'abc1' : 'ABC1',
    hasRk: '',
    hasUzk: '',
    rkResult: '',
    uzkResult: '',
  })) as WeldRow[]
}
