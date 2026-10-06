import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPercentageLineControlTasks } from '@/lib/percentage-line-tasks'
import * as summaries from '@/lib/percentage-line-summary'

describe('percentage line tasks for U-joints', () => {
  it('counts participating stamps once, not once for every new-welder task', () => {
    const size = 2000
    const rows = Array.from({ length: size }, (_, i) => row(i + 1, { stamp1K: `A${i}`, hasRk: 'да' }))
    const prepared = summaries.buildPercentageLineSummaries(rows)
    let reads = 0
    for (const stamp of prepared[0].stamps) {
      const count = stamp.officialJointCount
      Object.defineProperty(stamp, 'officialJointCount', { get: () => { reads++; return count } })
    }
    const spy = vi.spyOn(summaries, 'buildPercentageLineSummaries').mockReturnValue(prepared)
    try {
      const tasks = buildPercentageLineControlTasks(rows)
      expect(tasks.filter(task => task.issue === 'new-welder')).toHaveLength(size - 1)
      expect(reads).toBeLessThanOrEqual(size * 10)
    } finally { spy.mockRestore() }
  })

  it('does not create a missing-control task when explicit layered PVK closes the U-joint slot', () => {
    const tasks = buildPercentageLineControlTasks([
      row(1, { connectionType: 'У', hasPvk: 'да', layeredControlAssigned: true }),
      row(2),
      row(3),
      row(4),
      row(5),
    ])

    expect(tasks).toHaveLength(0)
  })

  it('does not use PVK on an ordinary joint to close the percentage requirement', () => {
    const tasks = buildPercentageLineControlTasks([
      row(1, { connectionType: 'С', hasPvk: 'да' }),
      row(2),
      row(3),
      row(4),
      row(5),
    ])

    expect(tasks.filter((task) => task.demandKind !== 'pvk')).toEqual([
      expect.objectContaining({
        issue: 'missing',
        title: 'Назначить контроль по процентной линии',
        count: 1,
      }),
    ])
  })

  it('never uses rejected PVK on a U-joint for RK/UZK add-on', () => {
    const tasks = buildPercentageLineControlTasks([
      row(1, { connectionType: 'У17', hasPvk: 'да', pvkResult: 'вырез' }),
      row(2),
      row(3),
      row(4),
      row(5),
    ])

    expect(tasks.filter((task) => task.demandKind !== 'pvk').map((task) => task.issue).sort()).toEqual(['missing'])
    expect(tasks.find((task) => task.issue === 'missing')).toMatchObject({
      requiredControls: 1,
      coveredControls: 0,
      count: 1,
    })
    expect(tasks.find((task) => task.issue === 'rejected-rows')).toBeUndefined()
  })

  it('does not create full-control or suspension tasks after four rejected PVK U-joints', () => {
    const tasks = buildPercentageLineControlTasks(
      Array.from({ length: 6 }, (_, index) =>
        row(index + 1, {
          connectionType: 'У',
          hasPvk: index < 4 ? 'да' : '',
          pvkResult: index < 4 ? 'вырез' : '',
          pvkConclusionDate: index < 4 ? `0${index + 1}.08.2026` : '',
        }),
      ),
    )

    expect(tasks.filter((task) => task.demandKind !== 'pvk').map((task) => task.issue).sort()).toEqual(['missing'])
    expect(tasks.find((task) => task.issue === 'missing')).toMatchObject({
      title: 'Назначить контроль по процентной линии',
      requiredControls: 1,
      coveredControls: 0,
      count: 1,
    })
    expect(tasks.find((task) => task.issue === 'suspend-welder')).toBeUndefined()
  })

  it('never proposes a malformed control date for suspension', () => {
    const tasks = buildPercentageLineControlTasks(
      Array.from({ length: 6 }, (_, index) =>
        row(index + 1, {
          weldDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
          hasRk: index < 4 ? 'да' : '',
          rkResult: index < 4 ? 'вырез' : '',
          rkConclusionDate: index < 3 ? `2026-08-0${index + 1}` : '31.02.2026',
        }),
      ),
    )

    expect(tasks.find((task) => task.issue === 'suspend-welder')).toMatchObject({
      suspensionFrom: '2026-08-03',
    })
    expect(tasks.find((task) => task.issue === 'suspend-welder')?.suspensionFrom)
      .not.toBe('31.02.2026')
  })
})

function row(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    connectionType: 'СШ',
    pvkControlPercent: 0,
    projectTitle: 'TKM5',
    subtitleCode: '-',
    line: '330-01',
    weldControlPercent: '10',
    joint: `S${id}`,
    weldDate: '01.07.2026',
    stamp1K: 'ABC1',
    hasRk: '',
    hasUzk: '',
    hasPvk: '',
    rkResult: '',
    uzkResult: '',
    pvkResult: '',
    ...overrides,
  } as WeldRow
}
