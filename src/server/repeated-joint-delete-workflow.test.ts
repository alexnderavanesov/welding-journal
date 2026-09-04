import { describe, expect, it } from 'vitest'

import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import type { RepeatedJointDeleteTask, WeldRow } from '@/lib/dispatcher-types'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { findCurrentObsoleteRepeatedJointDeleteTask } from '@/server/repeated-joint-delete-workflow'

const validationContext = {
  dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
  systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
  welderStamps: [],
  welderStampSuspensions: [],
}

describe('obsolete repeated-joint delete workflow', () => {
  it('authorizes only the exact delete task rebuilt from current line rows', () => {
    const rows = makeObsoleteRows()
    const task = getDeleteTask(rows)

    expect(findCurrentObsoleteRepeatedJointDeleteTask({
      data: {
        taskKey: task.key,
        target: { id: task.row.id, version: 'v1' },
      },
      earlyCoilDecisionSourceRowIds: new Set(),
      rows,
      validationContext,
    })).toEqual(expect.objectContaining({ kind: 'delete', row: expect.objectContaining({ id: 2 }) }))
  })

  it('rejects deletion when another user made the repeated joint necessary', () => {
    const initialRows = makeObsoleteRows()
    const task = getDeleteTask(initialRows)
    const currentRows = initialRows.map((row) => row.id === 1
      ? { ...row, rkResult: 'ремонт' } as WeldRow
      : row)

    expect(() => findCurrentObsoleteRepeatedJointDeleteTask({
      data: {
        taskKey: task.key,
        target: { id: task.row.id, version: 'v1' },
      },
      earlyCoilDecisionSourceRowIds: new Set(),
      rows: currentRows,
      validationContext,
    })).toThrow('Задача на удаление уже изменилась')
  })

  it('rejects deletion when another user filled the repeated-joint draft', () => {
    const initialRows = makeObsoleteRows()
    const task = getDeleteTask(initialRows)
    const currentRows = initialRows.map((row) => row.id === 2
      ? { ...row, weldDate: '2026-09-04' } as WeldRow
      : row)

    expect(() => findCurrentObsoleteRepeatedJointDeleteTask({
      data: {
        taskKey: task.key,
        target: { id: task.row.id, version: 'v1' },
      },
      earlyCoilDecisionSourceRowIds: new Set(),
      rows: currentRows,
      validationContext,
    })).toThrow('Задача на удаление уже изменилась')
  })
})

function getDeleteTask(rows: WeldRow[]) {
  return buildRepeatedJointTasks(rows).find(
    (task): task is RepeatedJointDeleteTask => task.kind === 'delete',
  )!
}

function makeObsoleteRows(): WeldRow[] {
  return [
    makeRow({ id: 1, joint: 'S12' }),
    makeRow({ id: 2, joint: 'S12R1', weldDate: null, finalStatus: 'ожидает ремонт' }),
  ]
}

function makeRow(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: 'ТКМ5',
    subtitleCode: '-',
    line: '330-FG-05-001',
    weldControlPercent: '10',
    joint: 'S1',
    weldDate: '2026-07-01',
    ...values,
  } as WeldRow
}
