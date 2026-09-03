import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  evaluateEarlyCoilCandidate,
  isSafeEarlyCoilReplacementRow,
} from '@/lib/early-coil-candidate'

describe('evaluateEarlyCoilCandidate', () => {
  it('allows an early coil directly after the first rejected joint', () => {
    const source = row({ id: 1, joint: 'F51', rkResult: 'ремонт' })

    expect(evaluateEarlyCoilCandidate([source], source)).toEqual({
      candidate: expect.objectContaining({
        sourceJoint: 'F51',
        targetJoints: ['F51Y1', 'F51Y2'],
        result: 'ремонт',
      }),
      reason: null,
    })
  })

  it('uses the current nested coil branch as the next coil base', () => {
    const rows = [
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1Y1', rkResult: 'ремонт' }),
      row({ id: 3, joint: 'S1Y2', rkResult: '' }),
    ]

    expect(evaluateEarlyCoilCandidate(rows, rows[1]).candidate).toEqual(expect.objectContaining({
      targetJoints: ['S1Y1Y1', 'S1Y1Y2'],
    }))
  })

  it('replaces only an untouched expected R/W draft', () => {
    const createdAt = '2026-09-02T08:00:00.000Z'
    const base = row({ id: 1, joint: 'S1', rkResult: 'ремонт' })
    const source = row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' })
    const emptyExpected = row({
      id: 3,
      joint: 'S1R2',
      weldDate: null,
      rkResult: null,
      createdAt,
      updatedAt: createdAt,
    })

    expect(evaluateEarlyCoilCandidate([base, source, emptyExpected], source).candidate)
      .toEqual(expect.objectContaining({ replacementRow: emptyExpected }))

    const editedExpected = { ...emptyExpected, updatedAt: '2026-09-02T08:01:00.000Z' }
    expect(evaluateEarlyCoilCandidate([base, source, editedExpected], source).reason)
      .toMatch(/уже содержит данные, историю или документы/)
  })

  it('blocks replacement when controls or documents are attached', () => {
    const empty = row({ id: 2, joint: 'S1R1', weldDate: null, rkResult: null })

    expect(isSafeEarlyCoilReplacementRow(empty)).toBe(false)
    expect(isSafeEarlyCoilReplacementRow({
      ...empty,
      duplicateControls: [{ id: 1 }] as never,
    })).toBe(false)
    expect(isSafeEarlyCoilReplacementRow(empty, new Set([2]))).toBe(false)
  })

  it('blocks stale, completed and already accepted branches', () => {
    const source = row({ id: 1, joint: 'S1', rkResult: 'ремонт' })
    const current = row({ id: 2, joint: 'S1R1', rkResult: 'ремонт' })
    expect(evaluateEarlyCoilCandidate([source, current], source).reason)
      .toMatch(/уже содержит данные, историю или документы/)

    expect(evaluateEarlyCoilCandidate([
      source,
      row({ id: 3, joint: 'S1Y1', rkResult: '' }),
      row({ id: 4, joint: 'S1Y2', rkResult: '' }),
    ], source).reason).toMatch(/уже существует/)

    expect(evaluateEarlyCoilCandidate([source], source, {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    }).reason).toMatch(/уже принято/)

    expect(evaluateEarlyCoilCandidate([
      { ...source, officiality: 'неофициальный' },
    ], { ...source, officiality: 'неофициальный' }).reason).toMatch(/официального/)
  })
})

function row(values: Partial<WeldRow> & { updatedAt?: unknown }): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: values.projectTitle ?? 'Проект',
    subtitleCode: values.subtitleCode ?? 'Шифр',
    line: values.line ?? 'Линия',
    joint: values.joint ?? 'S1',
    weldDate: values.weldDate === undefined ? '2026-09-01' : values.weldDate,
    ...values,
  } as WeldRow
}
