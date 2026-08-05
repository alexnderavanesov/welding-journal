import { describe, expect, it } from 'vitest'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
  attachDispatcherTaskCodes,
  buildDispatcherTaskCodesByRowId,
  buildDispatcherTaskFilterOptions,
  buildDispatcherTaskServerFilters,
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
  it('assigns a line task to every row of the exact project, code and line', () => {
    const rows = [
      row(1),
      row(2),
      row(3, { subtitleCode: 'Шифр 2' }),
      row(4, { projectTitle: 'Проект 2' }),
      row(5, { line: 'Линия 2' }),
    ]

    const codes = buildDispatcherTaskCodesByRowId([lineTask(rows[0])], rows)

    expect([...codes.entries()]).toEqual([
      [1, ['ДЗ-24']],
      [2, ['ДЗ-24']],
    ])
  })

  it('keeps several task codes on one row without duplicates', () => {
    const rows = [row(1), row(2)]
    const codes = buildDispatcherTaskCodesByRowId(
      [lineTask(rows[0]), stampTask(rows[0]), stampTask(rows[0])],
      rows,
    )

    expect(codes.get(1)).toEqual(['ДЗ-18', 'ДЗ-24'])
    expect(codes.get(2)).toEqual(['ДЗ-24'])
    expect(attachDispatcherTaskCodes(rows, codes).map((candidate) => candidate.dispatcherTasks)).toEqual([
      'ДЗ-18, ДЗ-24',
      'ДЗ-24',
    ])
    expect(buildDispatcherTaskFilterOptions(codes)).toEqual([
      { value: 'ДЗ-18', label: 'ДЗ-18', count: 1 },
      { value: 'ДЗ-24', label: 'ДЗ-24', count: 2 },
    ])
  })

  it('translates task filters into server row filters for the whole report', () => {
    const codes = new Map<number, string[]>([
      [1, ['ДЗ-18', 'ДЗ-24']],
      [2, ['ДЗ-24']],
    ])

    const withTasks = buildDispatcherTaskServerFilters(
      { [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITH_FILTER },
      codes,
    )
    const withoutTasks = buildDispatcherTaskServerFilters(
      { [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITHOUT_FILTER },
      codes,
    )
    const exactCode = buildDispatcherTaskServerFilters(
      { [DISPATCHER_TASKS_FIELD_KEY]: buildWeldColumnValueFilter(['ДЗ-18']) },
      codes,
    )

    expect(parseRowIdListFilter(withTasks[ROW_ID_LIST_FILTER_KEY])).toEqual({
      rowIds: [1, 2],
      mode: 'include',
    })
    expect(parseRowIdListFilter(withoutTasks[ROW_ID_LIST_FILTER_KEY])).toEqual({
      rowIds: [1, 2],
      mode: 'exclude',
    })
    expect(parseRowIdListFilter(exactCode[ROW_ID_LIST_FILTER_KEY])).toEqual({
      rowIds: [1],
      mode: 'include',
    })
  })

  it('combines the task filter with an existing selected-row filter', () => {
    const codes = new Map<number, string[]>([
      [1, ['ДЗ-18']],
      [2, ['ДЗ-24']],
    ])
    const filters = buildDispatcherTaskServerFilters(
      {
        ...buildRowIdListFilters([2, 3]),
        [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITH_FILTER,
      },
      codes,
    )

    expect(parseRowIdListFilter(filters[ROW_ID_LIST_FILTER_KEY])).toEqual({
      rowIds: [2],
      mode: 'include',
    })
  })
})
