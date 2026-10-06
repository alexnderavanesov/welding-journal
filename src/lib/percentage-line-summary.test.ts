import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPercentageLineSummaries,
} from '@/lib/percentage-line-summary'

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

  it('treats stamp casing as the same official stamp', () => {
    const summaries = buildPercentageLineSummaries([
      makeRow(1, { stamp1K: 'ABC1' }),
      makeRow(2, { stamp1K: 'abc1' }),
    ])

    expect(summaries[0].stamps).toHaveLength(1)
    expect(summaries[0].stamps[0]).toEqual(expect.objectContaining({
      stamp: 'ABC1',
      officialJointCount: 2,
    }))
  })

  it('adds two controls after a rejected primary joint when line percent is above 1', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      makeRow(index + 1, { joint: `S${index + 1}`, rkResult: index === 0 ? 'вырез' : '' }),
    )

    const stamp = getOnlyStamp(rows)

    expect(stamp.baseRequiredControls).toBe(1)
    expect(stamp.rejectedControlRows).toBe(1)
    expect(stamp.additionalRequiredControls).toBe(2)
    expect(stamp.requiredControls).toBe(3)
  })

  it('does not add surcharge for rejected VIK without pretending RK was performed', () => {
    const rows = [
      makeRow(1, { joint: 'S1', hasVik: 'дополнительный', vikResult: 'вырез', hasRk: 'да' }),
      makeRow(2, { joint: 'S2' }),
      makeRow(3, { joint: 'S3' }),
      makeRow(4, { joint: 'S4' }),
      makeRow(5, { joint: 'S5' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.completedControls).toBe(0)
    expect(stamp.rejectedControlRows).toBe(0)
    expect(stamp.rejectedJoints).toBe(1)
    expect(stamp.additionalRequiredControls).toBe(0)
    expect(stamp.requiredControls).toBe(1)
  })

  it('counts only rejected RK/UZK before heat treatment for surcharge', () => {
    const rkRows = [
      makeRow(1, {
        joint: 'S1',
        pstoRequired: 'да',
        hasRk: 'да',
        preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'вырез' }],
      }),
      ...Array.from({ length: 4 }, (_, index) => makeRow(index + 2, { joint: `S${index + 2}` })),
    ]
    const vikRows = rkRows.map((row, index) => index === 0
      ? makeRow(1, {
        joint: 'S1',
        pstoRequired: 'да',
        hasVik: 'да',
        preHeatTreatmentControls: [{ id: 2, weldJointId: 1, method: 'ВИК', result: 'вырез' }],
      })
      : row)

    expect(getOnlyStamp(rkRows)).toEqual(expect.objectContaining({
      rejectedControlRows: 1,
      additionalRequiredControls: 2,
    }))
    expect(getOnlyStamp(vikRows)).toEqual(expect.objectContaining({
      rejectedControlRows: 0,
      additionalRequiredControls: 0,
    }))
  })

  it('adds required RK/UZK controls after a rejected primary duplicate RK or UZK result', () => {
    const rows = [
      makeRow(1, {
        joint: 'S1',
        duplicateControls: [{ id: 1, weldJointId: 1, method: 'РК', result: 'вырез', controlDate: '', conclusion: '', conclusionDate: '' }],
      }),
      makeRow(2, { joint: 'S2' }),
      makeRow(3, { joint: 'S3' }),
      makeRow(4, { joint: 'S4' }),
      makeRow(5, { joint: 'S5' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.rejectedControlRows).toBe(1)
    expect(stamp.additionalRequiredControls).toBe(2)
    expect(stamp.requiredControls).toBe(3)
  })

  it('excludes rejected duplicate VIK from common surcharge', () => {
    const rows = [
      makeRow(1, {
        joint: 'S1',
        duplicateControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'вырез', controlDate: '', conclusion: '', conclusionDate: '' }],
      }),
      makeRow(2, { joint: 'S2' }),
      makeRow(3, { joint: 'S3' }),
      makeRow(4, { joint: 'S4' }),
      makeRow(5, { joint: 'S5' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.rejectedControlRows).toBe(0)
    expect(stamp.rejectedJoints).toBe(1)
    expect(stamp.additionalRequiredControls).toBe(0)
    expect(stamp.requiredControls).toBe(1)
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

  it('preserves full norm but limits actionable demand when no candidates remain', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, index) =>
        makeRow(index + 1, {
          joint: `S${index + 1}`,
          hasRk: 'да',
          rkResult: 'вырез',
          weldControlPercent: '25',
        }),
      ),
      makeRow(5, {
        joint: 'S5',
        hasPvk: 'дополнительный',
        pvkResult: 'вырез',
        weldControlPercent: '25',
      }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.fullControlRequired).toBe(true)
    expect(stamp.calculatedRequiredControls).toBe(5)
    expect(stamp.availableRequiredControls).toBe(4)
    expect(stamp.requiredControls).toBe(4)
    expect(stamp.coveredControls).toBe(4)
    expect(stamp.rejectedCoveredControls).toBe(4)
    expect(stamp.rejectedCoveredJointNames).toEqual(['S1', 'S2', 'S3', 'S4'])
    expect(stamp.missingControls).toBe(0)
    expect(stamp.missingCandidateJointNames).toEqual([])
  })

  it('neither adds surcharge nor common coverage for rejected additional PVK', () => {
    const rows = [
      makeRow(1, { joint: 'S1', weldControlPercent: '25', hasRk: 'да' }),
      makeRow(2, { joint: 'S2', weldControlPercent: '25', hasRk: 'да' }),
      makeRow(3, { joint: 'S3', weldControlPercent: '25', hasPvk: 'дополнительный', pvkResult: 'вырез' }),
      ...Array.from({ length: 14 }, (_, index) => makeRow(index + 4, { joint: `S${index + 4}`, weldControlPercent: '25' })),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.calculatedRequiredControls).toBe(4)
    expect(stamp.availableRequiredControls).toBe(16)
    expect(stamp.requiredControls).toBe(4)
    expect(stamp.coveredControls).toBe(2)
    expect(stamp.rejectedCoveredControls).toBe(0)
    expect(stamp.missingControls).toBe(2)
  })

  it('does not count rejected repair descendants toward the fourth primary rejection', () => {
    const rows = [
      makeRow(1, { joint: 'S1', rkResult: 'вырез' }),
      makeRow(2, { joint: 'S1R1', rkResult: 'вырез' }),
      makeRow(3, { joint: 'S2', rkResult: 'вырез' }),
      makeRow(4, { joint: 'S3', rkResult: 'вырез' }),
      makeRow(5, { joint: 'S4' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.rejectedControlRows).toBe(3)
    expect(stamp.rejectedJointNames).toEqual(['S1', 'S2', 'S3'])
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
    expect(stamp.assignedControls).toBe(4)
    expect(stamp.cancelledAssignedControls).toBe(2)
    expect(stamp.coveredControls).toBe(6)
    expect(stamp.missingControls).toBe(0)
  })

  it('treats cancelled RK and UZK plus another additional control as separate assignments', () => {
    const rows = [
      makeRow(1, { joint: 'S1', hasRk: 'да' }),
      makeRow(2, { joint: 'S2', hasRk: 'отменен', hasUzk: 'отменен', hasPvk: 'дополнительный' }),
      makeRow(3, { joint: 'S3' }),
      makeRow(4, { joint: 'S4' }),
      makeRow(5, { joint: 'S5' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.requiredControls).toBe(1)
    expect(stamp.assignedControls).toBe(1)
    expect(stamp.cancelledAssignedControls).toBe(1)
    expect(stamp.cancelledAssignedJointNames).toEqual(['S2'])
    expect(stamp.coveredControls).toBe(2)
    expect(stamp.excessControls).toBe(1)
  })

  it('reads old RK/UZK replacement text as additional non-percentage control', () => {
    const rows = [
      makeRow(1, { joint: 'S1', hasRk: 'да' }),
      makeRow(2, { joint: 'S2', hasPvk: 'замена РК/УЗК' }),
      makeRow(3, { joint: 'S3' }),
      makeRow(4, { joint: 'S4' }),
      makeRow(5, { joint: 'S5' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.requiredControls).toBe(1)
    expect(stamp.assignedControls).toBe(1)
    expect(stamp.coveredControls).toBe(1)
    expect(stamp.excessControls).toBe(0)
  })

  it('uses explicit layered PVK as a common slot only for a U-joint', () => {
    const uJointStamp = getOnlyStamp([
      makeRow(1, { connectionType: 'У17', layeredControlAssigned: true, hasPvk: 'да', pvkResult: 'годен' }),
      makeRow(2),
    ])

    expect(uJointStamp.assignedControls).toBe(1)
    expect(uJointStamp.coveredControls).toBe(1)
    expect(uJointStamp.completedControls).toBe(1)
    expect(uJointStamp.missingControls).toBe(0)

    const ordinaryStamp = getOnlyStamp([
      makeRow(1, { connectionType: 'С', hasPvk: 'да', pvkResult: 'годен' }),
      makeRow(2),
    ])

    expect(ordinaryStamp.assignedControls).toBe(0)
    expect(ordinaryStamp.coveredControls).toBe(0)
    expect(ordinaryStamp.missingControls).toBe(1)
    expect(ordinaryStamp.assignmentCandidateRowIds).toEqual([1, 2])
  })

  it('counts several normal methods as one slot and flags the duplicate assignment', () => {
    const stamp = getOnlyStamp([
      makeRow(1, { connectionType: 'У', hasRk: 'да', hasUzk: 'да', hasPvk: 'да' }),
      makeRow(2),
    ])

    expect(stamp.assignedControls).toBe(1)
    expect(stamp.normalAssignedControls).toBe(1)
    expect(stamp.coveredControls).toBe(1)
    expect(stamp.excessControls).toBe(1)
    expect(stamp.duplicateAssignmentRowIds).toEqual([1])
  })

  it('counts additional PVK only in its own PVK quota, never in common coverage', () => {
    const stamp = getOnlyStamp([
      makeRow(1, { connectionType: 'У', hasPvk: 'дополнительный' }),
      makeRow(2),
    ])

    expect(stamp.assignedControls).toBe(0)
    expect(stamp.pvk.additionalRowIds).toEqual([1])
    expect(stamp.pvk.coveredRowIds).toEqual([1])
    expect(stamp.additionalAssignedControls).toBe(0)
    expect(stamp.coveredControls).toBe(0)
    expect(stamp.missingControls).toBe(1)
    expect(stamp.excessControls).toBe(0)
  })

  it('never uses rejected own or duplicate PVK for surcharge or common coverage', () => {
    const addOnStamp = getOnlyStamp([
      makeRow(1, { connectionType: 'У', hasPvk: 'да', pvkResult: 'вырез' }),
      makeRow(2),
      makeRow(3),
      makeRow(4),
      makeRow(5),
    ])

    expect(addOnStamp.rejectedControlRows).toBe(0)
    expect(addOnStamp.additionalRequiredControls).toBe(0)
    expect(addOnStamp.requiredControls).toBe(1)

    const fullControlStamp = getOnlyStamp(
      Array.from({ length: 6 }, (_, index) =>
        makeRow(index + 1, {
          connectionType: 'У',
          hasPvk: index < 4 ? 'да' : '',
          duplicateControls:
            index < 4
              ? [{ id: index + 1, weldJointId: index + 1, method: 'ПВК', result: 'вырез', controlDate: '', conclusion: '', conclusionDate: '' }]
              : [],
        }),
      ),
    )

    expect(fullControlStamp.rejectedControlRows).toBe(0)
    expect(fullControlStamp.fullControlRequired).toBe(false)
    expect(fullControlStamp.calculatedRequiredControls).toBe(1)
    expect(fullControlStamp.requiredControls).toBe(1)
  })

  it('additional control and C cancellation both displace ordinary yes from the rounded allowance', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, index) => makeRow(index + 1, { joint: `S${index + 1}`, weldControlPercent: '25', hasRk: 'да' })),
      makeRow(7, { joint: 'S7', weldControlPercent: '25', hasRk: 'дополнительный' }),
      makeRow(8, { joint: 'S8', weldControlPercent: '25', hasRk: 'отменен', hasUzk: 'отменен' }),
      ...Array.from({ length: 13 }, (_, index) => makeRow(index + 9, { joint: `S${index + 9}`, weldControlPercent: '25' })),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.requiredControls).toBe(5)
    expect(stamp.assignedControls).toBe(7)
    expect(stamp.additionalAssignedControls).toBe(1)
    expect(stamp.cancelledAssignedControls).toBe(1)
    expect(stamp.normalAssignedControls).toBe(6)
    expect(stamp.excessControls).toBe(3)
    expect(stamp.excessCandidateJointNames).toEqual(['S6', 'S5', 'S4'])
  })

  it('counts additional RK toward the rounded norm and integer surcharge', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, index) =>
        makeRow(index + 1, {
          joint: `S${index + 1}`,
          weldControlPercent: '25',
          hasRk: 'да',
          rkResult: index === 0 ? 'вырез' : '',
        }),
      ),
      makeRow(7, { joint: 'S7', weldControlPercent: '25', hasRk: 'дополнительный' }),
      ...Array.from({ length: 14 }, (_, index) => makeRow(index + 8, { joint: `S${index + 8}`, weldControlPercent: '25' })),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.baseRequiredControls).toBe(5)
    expect(stamp.additionalRequiredControls).toBe(2)
    expect(stamp.requiredControls).toBe(7)
    expect(stamp.assignedControls).toBe(7)
    expect(stamp.additionalAssignedControls).toBe(1)
    expect(stamp.coveredControls).toBe(7)
    expect(stamp.missingControls).toBe(0)
  })

  it('does not offer an already additional-covered joint as a missing-control candidate', () => {
    const rows = [
      makeRow(1, { joint: 'S1', hasRk: 'да' }),
      makeRow(2, { joint: 'S2', rkResult: 'вырез' }),
      makeRow(3, { joint: 'S3', hasUzk: 'дополнительный' }),
      makeRow(4, { joint: 'S4', officiality: 'неофициальный' }),
      makeRow(5, { joint: 'S5', revisionActuality: 'не актуален' }),
      makeRow(6, { joint: 'S6' }),
    ]

    const stamp = getOnlyStamp(rows)

    expect(stamp.missingCandidateJointNames).toEqual(['S6'])
    expect(stamp.assignmentCandidateJointNames).toEqual(['S6'])
    expect(stamp.assignmentCandidateRowIds).toEqual([6])
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
    expect(stamp.additionalAssignedControls).toBe(1)
    expect(stamp.additionalAssignedJointNames).toEqual(['S2'])
    expect(stamp.excessControls).toBe(1)
    expect(stamp.excessCandidateRowIds).toEqual([1])
  })

  it('keeps actual per-stamp quotas without the removed theoretical potential', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, index) =>
        makeRow(index + 1, {
          joint: `S${index + 1}`,
          stamp1K: 'AAA1',
          hasRk: index < 4 ? 'да' : '',
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        makeRow(index + 31, {
          joint: `S${index + 31}`,
          stamp1K: 'BBB2',
          hasRk: index < 2 ? 'да' : '',
        }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        makeRow(index + 34, {
          joint: `S${index + 34}`,
          stamp1K: 'CCC3',
          hasRk: index === 0 ? 'да' : '',
        }),
      ),
    ]

    const initial = buildPercentageLineSummaries(rows)[0]
    expect(initial.stamps.reduce((total, stamp) => total + stamp.excessControls, 0)).toBe(2)
    expect(initial.stamps.reduce((total, stamp) => total + stamp.requiredControls, 0)).toBe(5)
    expect(initial).not.toHaveProperty('potentialControlReduction')
  })

  it('retains all six actual places when two stamps are added to a 35-joint line', () => {
    const rows = Array.from({ length: 35 }, (_, index) =>
      makeRow(index + 1, {
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        stamp1Z: index === 0 ? 'AAAA' : index === 1 ? 'BBBB' : '',
      }),
    )

    const summary = buildPercentageLineSummaries(rows)[0]

    expect(summary.stamps).toHaveLength(3)
    expect(summary.stamps.reduce((total, stamp) => total + stamp.requiredControls, 0)).toBe(6)
    expect(summary).not.toHaveProperty('potentialControlReduction')
  })

  it('keeps full control on the rejected stamp separate from the other stamp', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      makeRow(index + 1, {
        joint: `S${index + 1}`,
        weldControlPercent: '1',
        stamp1K: index < 4 ? 'AAA1' : 'BBB2',
        hasRk: 'да',
        rkResult: index < 4 ? 'вырез' : '',
      }),
    )

    const summary = buildPercentageLineSummaries(rows)[0]
    expect(summary.stamps.find(stamp => stamp.stamp === 'AAA1')).toMatchObject({ requiredControls: 4, fullControlRequired: true })
    expect(summary.stamps.find(stamp => stamp.stamp === 'BBB2')).toMatchObject({ requiredControls: 1, fullControlRequired: false })
  })

  it('sorts percentage lines by required controls, project, subtitle and line', () => {
    const rows = [
      makeRow(1, { line: 'LINE-LOW', joint: 'S1' }),
      makeRow(2, { line: 'LINE-HIGH', joint: 'S2', weldControlPercent: '25' }),
      makeRow(3, { line: 'LINE-HIGH', joint: 'S3', weldControlPercent: '25' }),
      makeRow(4, { line: 'LINE-HIGH', joint: 'S4', weldControlPercent: '25' }),
      makeRow(5, { line: 'LINE-HIGH', joint: 'S5', weldControlPercent: '25' }),
      makeRow(6, { line: 'LINE-HIGH', joint: 'S6', weldControlPercent: '25' }),
      makeRow(7, { projectTitle: 'A', subtitleCode: '500', line: 'LINE-SAME-B', joint: 'S7' }),
      makeRow(8, { projectTitle: 'A', subtitleCode: '400', line: 'LINE-SAME-A', joint: 'S8' }),
      makeRow(9, { line: 'LINE-HIGH', joint: 'S9', weldControlPercent: '25' }),
    ]

    const summaries = buildPercentageLineSummaries(rows)

    expect(summaries.map((summary) => summary.line)).toEqual(['LINE-HIGH', 'LINE-SAME-A', 'LINE-SAME-B', 'LINE-LOW'])
    expect(summaries.map((summary) => summary.stamps.reduce((total, stamp) => total + stamp.requiredControls, 0))).toEqual([2, 1, 1, 1])
  })

  it('sorts stamps inside a percentage line by welded count, excess controls and stamp name', () => {
    const rows = [
      makeRow(1, { joint: 'S1', stamp1K: 'BBB2' }),
      makeRow(2, { joint: 'S2', stamp1K: 'AAA1', hasRk: 'да' }),
      makeRow(3, { joint: 'S3', stamp1K: 'AAA1', hasRk: 'да' }),
      makeRow(4, { joint: 'S4', stamp1K: 'CCC3', hasRk: 'да' }),
      makeRow(5, { joint: 'S5', stamp1K: 'CCC3', hasRk: 'да' }),
    ]

    const stamps = buildPercentageLineSummaries(rows)[0].stamps

    expect(stamps.map((stamp) => stamp.stamp)).toEqual(['AAA1', 'CCC3', 'BBB2'])
    expect(stamps.map((stamp) => stamp.officialJointCount)).toEqual([2, 2, 1])
    expect(stamps.map((stamp) => stamp.excessControls)).toEqual([1, 1, 0])
  })

  it('does not treat a line with missing percent values as a percentage line', () => {
    const rows = [
      makeRow(1, { joint: 'S1', weldControlPercent: '10' }),
      makeRow(2, { joint: 'S2', weldControlPercent: '' }),
    ]

    expect(buildPercentageLineSummaries(rows)).toHaveLength(0)
  })

  it('does not merge different percentage lines that contain separator characters', () => {
    const summaries = buildPercentageLineSummaries([
      makeRow(1, { projectTitle: 'A|B', subtitleCode: 'C', line: 'LIN-1' }),
      makeRow(2, { projectTitle: 'A', subtitleCode: 'B|C', line: 'LIN-1' }),
    ])

    expect(summaries).toHaveLength(2)
    expect(summaries.map((summary) => summary.rowCount)).toEqual([1, 1])
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
    connectionType: 'СШ',
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
