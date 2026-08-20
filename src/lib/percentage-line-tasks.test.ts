import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildPercentageLineControlTasks } from '@/lib/percentage-line-tasks'

describe('percentage line tasks for U-joints', () => {
  it('does not create a missing-control task when PVK closes the U-joint slot', () => {
    const tasks = buildPercentageLineControlTasks([
      row(1, { connectionType: 'У', hasPvk: 'да' }),
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

    expect(tasks).toEqual([
      expect.objectContaining({
        issue: 'missing',
        title: 'Назначить контроль по процентной линии',
        count: 1,
      }),
    ])
  })

  it('uses rejected PVK on a U-joint for add-on and dispatcher details', () => {
    const tasks = buildPercentageLineControlTasks([
      row(1, { connectionType: 'У17', hasPvk: 'да', pvkResult: 'вырез' }),
      row(2),
      row(3),
      row(4),
      row(5),
    ])

    expect(tasks.map((task) => task.issue).sort()).toEqual(['missing', 'rejected-primary'])
    expect(tasks.find((task) => task.issue === 'missing')).toMatchObject({
      requiredControls: 3,
      coveredControls: 1,
      count: 2,
    })
    expect(tasks.find((task) => task.issue === 'rejected-primary')?.details).toContain('На У-стыках сюда входит и ПВК')
  })

  it('creates full-control and suspension tasks after four rejected PVK U-joints', () => {
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

    expect(tasks.map((task) => task.issue).sort()).toEqual(['missing', 'rejected-primary', 'suspend-welder'])
    expect(tasks.find((task) => task.issue === 'missing')).toMatchObject({
      title: 'Назначить 100% контроль по клейму',
      requiredControls: 6,
      coveredControls: 4,
      count: 2,
    })
    expect(tasks.find((task) => task.issue === 'suspend-welder')).toMatchObject({
      suspensionFrom: '04.08.2026',
    })
  })
})

function row(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
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
    hasPvk: '',
    rkResult: '',
    uzkResult: '',
    pvkResult: '',
    ...overrides,
  } as WeldRow
}
