import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLineConsistencyTasks } from '@/lib/line-consistency-tasks'

describe('line consistency tasks', () => {
  it('creates a task when control percent differs within the same line', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', weldControlPercent: '100' }),
      row({ id: 2, line: '330-FG-05-001', weldControlPercent: '10' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      kind: 'line-consistency',
      line: '330-FG-05-001',
      fieldKey: 'weldControlPercent',
      title: 'Проверить % контроля линии',
      values: ['100', '10'],
    })
  })

  it('does not create a task when line values are equal', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', groupName: 'Б(а)', category: 'II', weldControlPercent: '100' }),
      row({ id: 2, line: '330-FG-05-001', groupName: 'Б(а)', category: 'II', weldControlPercent: '100' }),
    ])

    expect(tasks).toHaveLength(0)
  })

  it('checks group and category independently', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', groupName: 'Б(а)', category: 'II' }),
      row({ id: 2, line: '330-FG-05-001', groupName: 'В', category: 'III' }),
    ])

    expect(tasks.map((task) => task.fieldKey).sort()).toEqual(['category', 'groupName'])
  })

  it('creates a task when control presence differs within the same line and percent', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да', hasRk: 'да', hasPvk: 'да' }),
      row({ id: 2, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да', hasRk: 'да' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      kind: 'line-consistency',
      line: '330-FG-05-001',
      fieldKey: 'controlPresence',
      title: 'Проверить назначение контроля линии',
      values: ['ВИК, РК, ПВК', 'ВИК, РК'],
    })
  })

  it('does not create a control presence task for percentage lines below 100 percent', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', weldControlPercent: '25', hasVik: 'да', hasRk: 'да', hasPvk: 'да' }),
      row({ id: 2, line: '330-FG-05-001', weldControlPercent: '25', hasVik: 'да' }),
    ])

    expect(tasks).toHaveLength(0)
  })

  it('does not create a control presence task when a method is cancelled on one joint', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да', hasRk: 'отменен' }),
      row({ id: 2, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да', hasRk: 'да' }),
      row({ id: 3, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да', hasRk: 'да' }),
    ])

    expect(tasks).toHaveLength(0)
  })

  it('does not create a control presence task when a method is additional on one joint', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да', hasRk: 'дополнительный' }),
      row({ id: 2, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да' }),
      row({ id: 3, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да' }),
    ])

    expect(tasks).toHaveLength(0)
  })

  it('does not compare control presence between different control percents', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', weldControlPercent: '100', hasVik: 'да', hasRk: 'да' }),
      row({ id: 2, line: '330-FG-05-001', weldControlPercent: '10', hasVik: 'да' }),
    ])

    expect(tasks.map((task) => task.fieldKey)).toEqual(['weldControlPercent'])
  })

  it('creates a separate PSTO task regardless of line control percent', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, line: '330-FG-05-001', weldControlPercent: '25', pstoRequired: 'да' }),
      row({ id: 2, line: '330-FG-05-001', weldControlPercent: '25', pstoRequired: '' }),
      row({ id: 3, line: '330-FG-05-001', weldControlPercent: '25', pstoRequired: '' }),
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      kind: 'line-consistency',
      line: '330-FG-05-001',
      fieldKey: 'pstoPresence',
      title: 'Проверить ПСТО по линии',
      values: ['ПСТО есть: 1', 'ПСТО нет: 2'],
    })
  })

  it('does not create a PSTO task when every joint has PSTO or every joint has no PSTO', () => {
    expect(
      buildLineConsistencyTasks([
        row({ id: 1, pstoRequired: 'да' }),
        row({ id: 2, pstoRequired: 'да' }),
      ]),
    ).toHaveLength(0)

    expect(
      buildLineConsistencyTasks([
        row({ id: 1, pstoRequired: '' }),
        row({ id: 2, pstoRequired: '' }),
      ]),
    ).toHaveLength(0)
  })

  it('does not compare PSTO between different project and subtitle line groups', () => {
    const tasks = buildLineConsistencyTasks([
      row({ id: 1, projectTitle: 'P1', subtitleCode: '400', line: 'LIN-1', pstoRequired: 'да' }),
      row({ id: 2, projectTitle: 'P2', subtitleCode: '400', line: 'LIN-1', pstoRequired: '' }),
      row({ id: 3, projectTitle: 'P1', subtitleCode: '500', line: 'LIN-1', pstoRequired: '' }),
    ])

    expect(tasks).toHaveLength(0)
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: values.projectTitle ?? 'ТКМ5',
    subtitleCode: values.subtitleCode ?? '-',
    line: values.line ?? '330-FG-05-001',
    joint: values.joint ?? `S${values.id ?? 1}`,
    ...values,
  } as WeldRow
}
