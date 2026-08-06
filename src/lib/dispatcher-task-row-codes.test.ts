import { describe, expect, it } from 'vitest'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
  DISPATCHER_TASK_FILTER_KEY,
  buildDispatcherTaskIndexRows,
  buildDispatcherTaskServerFilters,
  parseDispatcherTaskServerFilter,
} from '@/lib/dispatcher-task-row-codes'
import { ROW_ID_LIST_FILTER_KEY, buildRowIdListFilters, parseRowIdListFilter } from '@/lib/report-hidden-filters'
import { buildWeldColumnValueFilter } from '@/lib/weld-table-filtering'

function row(id: number, partial: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'Проект 1',
    subtitleCode: 'Шифр 1',
    line: 'Линия 1',
    joint: `S${id}`,
    ...partial,
  }
}

function lineTask(rowValue: WeldRow): DispatcherTask {
  return {
    kind: 'line-consistency',
    key: 'line-percent',
    row: rowValue,
    projectTitle: String(rowValue.projectTitle),
    subtitleCode: String(rowValue.subtitleCode),
    line: String(rowValue.line),
    fieldKey: 'weldControlPercent',
    fieldLabel: 'Контроль швов, (%)',
    title: 'Проверить % контроля линии',
    values: ['10', '25'],
    details: 'Значения различаются.',
  }
}

function stampTask(rowValue: WeldRow): DispatcherTask {
  return {
    kind: 'check',
    key: `stamp-${rowValue.id}`,
    row: rowValue,
    sourceRow: rowValue,
    sourceJoint: String(rowValue.joint),
    targetJoint: String(rowValue.joint),
    baseJoint: String(rowValue.joint),
    suffix: 'R',
    reason: 'проверить клеймо',
  }
}

describe('dispatcher task row codes', () => {
  it('translates task filters into server row filters for the whole report', () => {
    const withTasks = buildDispatcherTaskServerFilters(
      { [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITH_FILTER },
    )
    const withoutTasks = buildDispatcherTaskServerFilters(
      { [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITHOUT_FILTER },
    )
    const exactCode = buildDispatcherTaskServerFilters(
      { [DISPATCHER_TASKS_FIELD_KEY]: buildWeldColumnValueFilter(['ДЗ-18']) },
    )

    expect(parseDispatcherTaskServerFilter(withTasks[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'with',
      codes: [],
      dismissedTaskKeys: [],
    })
    expect(parseDispatcherTaskServerFilter(withoutTasks[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'without',
      codes: [],
      dismissedTaskKeys: [],
    })
    expect(parseDispatcherTaskServerFilter(exactCode[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'codes',
      codes: ['ДЗ-18'],
      dismissedTaskKeys: [],
    })
    expect(Object.keys(withTasks)).not.toContain(ROW_ID_LIST_FILTER_KEY)
  })

  it('keeps an existing selected-row filter and sends dismissed task keys separately', () => {
    const filters = buildDispatcherTaskServerFilters(
      {
        ...buildRowIdListFilters([2, 3]),
        [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITH_FILTER,
      },
      ['task-hidden', 'task-hidden'],
    )

    expect(parseRowIdListFilter(filters[ROW_ID_LIST_FILTER_KEY])).toEqual({
      rowIds: [2, 3],
      mode: 'include',
    })
    expect(parseDispatcherTaskServerFilter(filters[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'with',
      codes: [],
      dismissedTaskKeys: ['task-hidden'],
    })
  })

  it('builds a persistent row index with exact task keys and all rows of a line', () => {
    const rows = [
      row(1),
      row(2),
      row(3, { subtitleCode: 'Шифр 2' }),
    ]

    expect(buildDispatcherTaskIndexRows([lineTask(rows[0]), stampTask(rows[0])], rows)).toEqual([
      { rowId: 1, taskKey: 'stamp-1', code: 'ДЗ-18' },
      { rowId: 1, taskKey: 'line-percent', code: 'ДЗ-24' },
      { rowId: 2, taskKey: 'line-percent', code: 'ДЗ-24' },
    ])
  })
})
