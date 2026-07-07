import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

describe('buildRepeatedJointTasks', () => {
  it('creates one official same-name target task for multiple unofficial rejected source rows', () => {
    const rows = [
      row({ id: 1, joint: 'S2', status: 'неофициальный', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S2', status: 'неофициальный', pvkResult: 'вырез' }),
      row({ id: 3, joint: 'S2', status: 'неофициальный', rkResult: 'вырез' }),
    ]

    const createTasks = buildRepeatedJointTasks(rows).filter((task) => task.kind === 'create')

    expect(createTasks).toHaveLength(1)
    expect(createTasks[0]).toEqual(expect.objectContaining({ sourceJoint: 'S2', targetJoint: 'S2' }))
  })

  it('keeps the next repeated joint create task when a premature coil needs integrity check', () => {
    const rows = [
      row({ id: 1, joint: 'S2', pvkResult: 'вырез' }),
      row({ id: 2, joint: 'S2W1', pvkResult: 'вырез' }),
      row({ id: 3, joint: 'S2W2', pvkResult: 'вырез' }),
      row({ id: 4, joint: 'S2Y1', pvkResult: '' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'check', reason: 'проверить целостность катушки' }),
        expect.objectContaining({ kind: 'create', sourceJoint: 'S2W2', targetJoint: 'S2W3' }),
      ]),
    )
  })

  it('offers to rename an orphan good repeated joint back to its missing source joint', () => {
    const tasks = buildRepeatedJointTasks([row({ id: 1, joint: 'S2W1', finalStatus: 'годен' })])

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rename',
          currentJoint: 'S2W1',
          targetJoint: 'S2',
        }),
      ]),
    )
    expect(tasks.some((task) => task.kind === 'check' && task.reason === 'проверить целостность цепочки')).toBe(false)
  })

  it('adds a dispatcher task when a percentage line stamp lacks RK/UZK coverage', () => {
    const rows = Array.from({ length: 10 }, (_, index) => row({ id: index + 1, joint: `S${index + 1}`, stamp1K: 'ABC1' }))

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          line: '330-FG-05-001',
          stamp: 'ABC1',
          count: 1,
        }),
      ]),
    )
  })

  it('adds an excess-control task only for normal yes values on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', hasRk: 'да' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ABC1', hasRk: 'да' }),
      row({ id: 3, joint: 'S3', stamp1K: 'ABC1', hasRk: 'дополнительный' }),
      ...Array.from({ length: 7 }, (_, index) => row({ id: index + 4, joint: `S${index + 4}`, stamp1K: 'ABC1' })),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'excess',
          stamp: 'ABC1',
          count: 1,
        }),
      ]),
    )
  })

  it('requires both RK and UZK to be cancelled for deliberate coverage on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', hasRk: 'отменен' }),
      ...Array.from({ length: 9 }, (_, index) => row({ id: index + 2, joint: `S${index + 2}`, stamp1K: 'ABC1' })),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('treats RK and UZK cancelled together as deliberate coverage on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', hasRk: 'отменен', hasUzk: 'отменен' }),
      ...Array.from({ length: 9 }, (_, index) => row({ id: index + 2, joint: `S${index + 2}`, stamp1K: 'ABC1' })),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('adds a new-welder task for additional official stamps on a percentage line', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', weldDate: '2026-07-01' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ABC1', weldDate: '2026-07-02' }),
      row({ id: 3, joint: 'S3', stamp1K: 'ZZ99', weldDate: '2026-07-03' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'new-welder',
          title: 'Новый сварщик на процентной линии',
          stamp: 'ZZ99',
        }),
      ]),
    )
    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'new-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('keeps accepted new-welder percentage-line tasks stable for the same stamp', () => {
    const baseRows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', weldDate: '2026-07-01' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ARCH', weldDate: '2026-07-02' }),
    ]
    const changedRows = [
      ...baseRows,
      row({ id: 3, joint: 'S3', stamp1K: 'ARCH', weldDate: '2026-07-03' }),
      row({ id: 4, joint: 'S4', stamp1K: 'ZZ99', weldDate: '2026-07-04' }),
    ]

    const baseNewWelderTasks = buildRepeatedJointTasks(baseRows).filter(
      (task) => task.kind === 'percentage-line-control' && task.issue === 'new-welder',
    )
    const changedNewWelderTasks = buildRepeatedJointTasks(changedRows).filter(
      (task) => task.kind === 'percentage-line-control' && task.issue === 'new-welder',
    )

    const acceptedStampTask = baseNewWelderTasks.find((task) => task.kind === 'percentage-line-control' && task.stamp === 'ARCH')
    const sameStampTask = changedNewWelderTasks.find((task) => task.kind === 'percentage-line-control' && task.stamp === 'ARCH')
    const thirdStampTask = changedNewWelderTasks.find((task) => task.kind === 'percentage-line-control' && task.stamp === 'ZZ99')

    expect(sameStampTask?.key).toBe(acceptedStampTask?.key)
    expect(thirdStampTask?.key).not.toBe(acceptedStampTask?.key)
  })

  it('adds a percentage-line task for rejected primary official controls', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        rkResult: index === 0 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
          count: 1,
        }),
      ]),
    )
  })

  it('starts percentage-line follow-up when a primary joint is rejected by a non-RK/UZK control', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        hasRfa: index === 0 ? 'дополнительный' : '',
        rfaResult: index === 0 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
          count: 1,
        }),
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
          requiredControls: 3,
          coveredControls: 0,
          count: 3,
        }),
      ]),
    )
  })

  it('does not count PSTO as a rejected primary percentage-line control', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        hasRk: index === 0 ? 'да' : '',
        rkResult: index === 0 ? 'годен' : '',
        hasPsto: index === 1 ? 'да' : '',
        pstoResult: index === 1 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })

  it('does not count rejected repair joints toward the primary rejected percentage-line limit', () => {
    const rows = [
      row({ id: 1, joint: 'S1', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S2', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S3', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 4, joint: 'S1R1', stamp1K: 'ABC1', rkResult: 'вырез' }),
      row({ id: 5, joint: 'S4', stamp1K: 'ABC1' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'rejected-primary',
          stamp: 'ABC1',
          count: 3,
        }),
      ]),
    )
  })

  it('adds only one extra RK/UZK requirement after a rejected primary joint on a 1 percent line', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        weldControlPercent: '1',
        rkResult: index === 0 ? 'вырез' : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
          requiredControls: 2,
          coveredControls: 1,
          count: 1,
        }),
      ]),
    )
  })

  it('adds a suspend-welder warning after the fourth rejected primary percentage-line joint', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        rkResult: index < 4 ? 'вырез' : '',
        rkConclusionDate: index < 4 ? `0${index + 1}.07.2026` : '',
      }),
    )

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          title: 'Отстранить сварщика от работы',
          stamp: 'ABC1',
          count: 4,
          suspensionFrom: '04.07.2026',
        }),
      ]),
    )
  })

  it('does not add a suspend-welder warning when the stamp is already suspended on the fourth rejected date', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      row({
        id: index + 1,
        joint: `S${index + 1}`,
        stamp1K: 'ABC1',
        rkResult: index < 4 ? 'вырез' : '',
        rkConclusionDate: index < 4 ? `0${index + 1}.07.2026` : '',
      }),
    )
    const suspensions: WelderStampSuspensionRecord[] = [
      { id: 1, naksStamp: 'ABC1', suspendedFrom: '04.07.2026', suspendedTo: '' },
    ]

    const tasks = buildRepeatedJointTasks(rows, [], suspensions)

    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
          title: 'Назначить 100% РК/УЗК по клейму',
        }),
      ]),
    )
  })

  it('does not ask for missing full-control joints when the remaining RK and UZK are cancelled', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, index) =>
        row({
          id: index + 1,
          joint: `S${index + 1}`,
          stamp1K: 'ABC1',
          rkResult: 'вырез',
        }),
      ),
      row({ id: 5, joint: 'S5', stamp1K: 'ABC1', hasRk: 'отменен', hasUzk: 'отменен' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'suspend-welder',
          stamp: 'ABC1',
        }),
      ]),
    )
    expect(tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'percentage-line-control',
          issue: 'missing',
          stamp: 'ABC1',
        }),
      ]),
    )
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: values.projectTitle ?? 'ТКМ5',
    subtitleCode: values.subtitleCode ?? '-',
    line: values.line ?? '330-FG-05-001',
    weldControlPercent: values.weldControlPercent ?? '10',
    joint: values.joint ?? 'S1',
    weldDate: values.weldDate ?? '2026-07-01',
    ...values,
  } as WeldRow
}
