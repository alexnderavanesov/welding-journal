import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPercentageLineSummaries } from '@/lib/percentage-line-summary'

describe('buildPercentageLineSummaries', () => {
  it('calculates base required controls per official stamp with minimum one and rounding up', () => {
    const rows = Array.from({ length: 15 }, (_, index) => makeRow(index + 1, { joint: `S${index + 1}` }))

    const stamp = getOnlyStamp(rows)

    expect(stamp.officialJointCount).toBe(15)
    expect(stamp.baseRequiredControls).toBe(2)
    expect(stamp.requiredControls).toBe(2)
  })

  it('counts required controls separately for each official stamp on the same percentage line', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, index) => makeRow(index + 1, { joint: `S${index + 1}`, stamp1K: 'AAA1' })),
      ...Array.from({ length: 5 }, (_, index) => makeRow(index + 6, { joint: `S${index + 6}`, stamp1K: 'BBB2' })),
    ]

    const summaries = buildPercentageLineSummaries(rows)[0].stamps

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stamp: 'AAA1', officialJointCount: 5, requiredControls: 1 }),
        expect.objectContaining({ stamp: 'BBB2', officialJointCount: 5, requiredControls: 1 }),
      ]),
    )
  })

  it('adds two controls after a rejected primary joint when line percent is above 1', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      makeRow(index + 1, { joint: `S${index + 1}`, rkResult: index === 0 ? 'вырез' : '' }),
    )

    const stamp = getOnlyStamp(rows)

    expect(stamp.baseRequiredControls).toBe(1)
    expect(stamp.rejectedPrimaryControls).toBe(1)
    expect(stamp.additionalRequiredControls).toBe(2)
    expect(stamp.requiredControls).toBe(3)
  })

  it('counts a rejected primary joint by any control method, not only RK or UZK', () => {
    const rows = [
      makeRow(1, { joint: 'S1', hasRfa: 'дополнительный', rfaResult: 'вырез', hasRk: 'да' }),
      makeRow(2, { joint: 'S2' }),
      makeRow(3, { joint: 'S3' }),
      makeRow(4, { joint: 'S4' }),
      makeRow(5, { joint: 'S5' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.completedControls).toBe(1)
    expect(stamp.rejectedPrimaryControls).toBe(1)
    expect(stamp.rejectedJoints).toBe(1)
    expect(stamp.additionalRequiredControls).toBe(2)
    expect(stamp.requiredControls).toBe(3)
  })

  it('adds one control after a rejected primary joint on a 1 percent line', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      makeRow(index + 1, {
        joint: `S${index + 1}`,
        weldControlPercent: '1',
        rkResult: index === 0 ? 'ремонт' : '',
      }),
    )

    const stamp = getOnlyStamp(rows)

    expect(stamp.baseRequiredControls).toBe(1)
    expect(stamp.additionalRequiredControls).toBe(1)
    expect(stamp.requiredControls).toBe(2)
  })

  it('requires full control for a stamp after the fourth rejected primary joint', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      makeRow(index + 1, {
        joint: `S${index + 1}`,
        rkResult: index < 4 ? 'вырез' : '',
        hasRk: index < 4 ? 'да' : '',
      }),
    )

    const stamp = getOnlyStamp(rows)

    expect(stamp.fullControlRequired).toBe(true)
    expect(stamp.requiredControls).toBe(6)
    expect(stamp.missingControls).toBe(2)
  })

  it('does not count rejected repair descendants toward the full-control counter', () => {
    const rows = [
      makeRow(1, { joint: 'S1', rkResult: 'вырез' }),
      makeRow(2, { joint: 'S1R1', rkResult: 'вырез' }),
      makeRow(3, { joint: 'S2', rkResult: 'вырез' }),
      makeRow(4, { joint: 'S3', rkResult: 'вырез' }),
      makeRow(5, { joint: 'S4' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.rejectedPrimaryControls).toBe(3)
    expect(stamp.rejectedPrimaryJointNames).toEqual(['S1', 'S2', 'S3'])
    expect(stamp.fullControlRequired).toBe(false)
  })

  it('treats RK and UZK cancelled together as intentionally covered for missing-control checks', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      makeRow(index + 1, {
        joint: `S${index + 1}`,
        rkResult: index < 4 ? 'вырез' : '',
        hasRk: index < 4 ? 'да' : 'отменен',
        hasUzk: index < 4 ? '' : 'отменен',
      }),
    )

    const stamp = getOnlyStamp(rows)

    expect(stamp.fullControlRequired).toBe(true)
    expect(stamp.requiredControls).toBe(6)
    expect(stamp.coveredControls).toBe(6)
    expect(stamp.missingControls).toBe(0)
  })

  it('does not report additional controls as excess', () => {
    const rows = [
      makeRow(1, { joint: 'S1', hasRk: 'да' }),
      makeRow(2, { joint: 'S2', hasRk: 'дополнительный' }),
      makeRow(3, { joint: 'S3' }),
      makeRow(4, { joint: 'S4' }),
      makeRow(5, { joint: 'S5' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.requiredControls).toBe(1)
    expect(stamp.assignedControls).toBe(2)
    expect(stamp.excessControls).toBe(0)
  })

  it('does not treat a line with missing percent values as a percentage line', () => {
    const rows = [
      makeRow(1, { joint: 'S1', weldControlPercent: '10' }),
      makeRow(2, { joint: 'S2', weldControlPercent: '' }),
    ]

    expect(buildPercentageLineSummaries(rows)).toHaveLength(0)
  })
})

function getOnlyStamp(rows: WeldRow[]) {
  const summaries = buildPercentageLineSummaries(rows)
  expect(summaries).toHaveLength(1)
  expect(summaries[0].stamps).toHaveLength(1)
  return summaries[0].stamps[0]
}

function makeRow(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'TKM5',
    subtitleCode: '-',
    line: '330-01',
    weldControlPercent: '10',
    joint: `S${id}`,
    weldDate: '01.07.2026',
    stamp1K: 'ABC1',
    hasRk: '',
    hasUzk: '',
    rkResult: '',
    uzkResult: '',
    ...overrides,
  } as WeldRow
}
