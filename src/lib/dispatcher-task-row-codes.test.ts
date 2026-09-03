import { describe, expect, it } from 'vitest'
import type {
  DispatcherTask,
  RepeatedJointCheckTask,
  RepeatedJointCoilTask,
  RepeatedJointRenameTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
  DISPATCHER_TASK_FILTER_KEY,
  buildDispatcherTaskIndexRows,
  buildMergedDispatcherTaskCodes,
  buildDispatcherTaskServerFilters,
  buildWeldColumnFilterOptionsRequestFilters,
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

function stampTask(rowValue: WeldRow): RepeatedJointCheckTask {
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

function coreDataTask(rowValue: WeldRow): DispatcherTask {
  return {
    ...stampTask(rowValue),
    key: `core-${rowValue.id}`,
    reason: 'проверить основные данные стыка',
  }
}

function earlyCoilTask(rowValue: WeldRow): RepeatedJointCoilTask {
  return {
    kind: 'coil',
    key: `early-coil-${rowValue.id}`,
    row: rowValue,
    sourceJoint: String(rowValue.joint),
    targetJoints: [`${String(rowValue.joint)}Y1`, `${String(rowValue.joint)}Y2`],
    result: 'ремонт',
    methodCode: 'ВИК',
    transitionMode: 'early-decision',
  }
}

function renameTask(rows: WeldRow[]): RepeatedJointRenameTask {
  return {
    kind: 'rename',
    key: 'rename-chain-2',
    row: rows[1]!,
    sourceRow: rows[0]!,
    sourceJoint: 'S1',
    currentJoint: 'S1R1',
    targetJoint: 'S1W1',
    baseJoint: 'S1',
    changes: [
      { rowId: rows[1]!.id, currentJoint: 'S1R1', targetJoint: 'S1W1' },
      { rowId: rows[2]!.id, currentJoint: 'S1R2', targetJoint: 'S1W1R1' },
    ],
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
    })
    expect(parseDispatcherTaskServerFilter(withoutTasks[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'without',
      codes: [],
    })
    expect(parseDispatcherTaskServerFilter(exactCode[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'codes',
      codes: ['ДЗ-18'],
    })
    expect(Object.keys(withTasks)).not.toContain(ROW_ID_LIST_FILTER_KEY)
  })

  it('keeps an existing selected-row filter without mixing local task visibility into server data', () => {
    const filters = buildDispatcherTaskServerFilters(
      {
        ...buildRowIdListFilters([2, 3]),
        [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITH_FILTER,
      },
    )

    expect(parseRowIdListFilter(filters[ROW_ID_LIST_FILTER_KEY])).toEqual({
      rowIds: [2, 3],
      mode: 'include',
    })
    expect(parseDispatcherTaskServerFilter(filters[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'with',
      codes: [],
    })
  })

  it('builds linked filter options from all active filters except the opened column', () => {
    const filters = buildWeldColumnFilterOptionsRequestFilters(
      {
        projectTitle: buildWeldColumnValueFilter(['Проект А']),
        line: buildWeldColumnValueFilter(['Линия 1']),
        [DISPATCHER_TASKS_FIELD_KEY]: buildWeldColumnValueFilter(['ДЗ-30']),
      },
      'line',
    )

    expect(filters.projectTitle).toBe(buildWeldColumnValueFilter(['Проект А']))
    expect(filters.line).toBeUndefined()
    expect(filters[DISPATCHER_TASKS_FIELD_KEY]).toBeUndefined()
    expect(parseDispatcherTaskServerFilter(filters[DISPATCHER_TASK_FILTER_KEY])).toEqual({
      mode: 'codes',
      codes: ['ДЗ-30'],
    })
  })

  it('does not apply the dispatcher filter to its own linked option list', () => {
    const filters = buildWeldColumnFilterOptionsRequestFilters(
      {
        projectTitle: buildWeldColumnValueFilter(['Проект А']),
        line: buildWeldColumnValueFilter(['Линия 1']),
        [DISPATCHER_TASKS_FIELD_KEY]: buildWeldColumnValueFilter(['ДЗ-30']),
      },
      DISPATCHER_TASKS_FIELD_KEY,
    )

    expect(filters.projectTitle).toBe(buildWeldColumnValueFilter(['Проект А']))
    expect(filters.line).toBe(buildWeldColumnValueFilter(['Линия 1']))
    expect(filters[DISPATCHER_TASKS_FIELD_KEY]).toBeUndefined()
    expect(filters[DISPATCHER_TASK_FILTER_KEY]).toBeUndefined()
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

  it('indexes new grouped dispatcher codes for the virtual field', () => {
    const rows = [row(1)]

    expect(buildDispatcherTaskIndexRows([coreDataTask(rows[0])], rows)).toEqual([
      { rowId: 1, taskKey: 'core-1', code: 'ДЗ-31' },
    ])
  })

  it('persists an accepted early-coil recovery task as ДЗ-09 in the virtual field', () => {
    const rows = [row(1)]
    const persistedRows = buildDispatcherTaskIndexRows([earlyCoilTask(rows[0])], rows)

    expect(persistedRows).toEqual([
      { rowId: 1, taskKey: 'early-coil-1', code: 'ДЗ-09' },
    ])
    const { activeByRowId, allByRowId } = buildMergedDispatcherTaskCodes(
      persistedRows.map(({ rowId, code }) => ({ rowId, code })),
      [],
    )
    expect(activeByRowId.get(1)).toBe('ДЗ-09')
    expect(allByRowId.get(1)).toBe('ДЗ-09')
  })

  it('indexes one chain rename task on every row changed by the atomic plan', () => {
    const rows = [
      row(1, { joint: 'S1' }),
      row(2, { joint: 'S1R1' }),
      row(3, { joint: 'S1R2' }),
    ]

    const persistedRows = buildDispatcherTaskIndexRows([renameTask(rows)], rows)

    expect(persistedRows).toEqual([
      { rowId: 2, taskKey: 'rename-chain-2', code: 'ДЗ-11' },
      { rowId: 3, taskKey: 'rename-chain-2', code: 'ДЗ-11' },
    ])
    const { allByRowId } = buildMergedDispatcherTaskCodes(persistedRows, [])
    expect(allByRowId.get(2)).toBe('ДЗ-11')
    expect(allByRowId.get(3)).toBe('ДЗ-11')
  })

  it('keeps active codes separate while exposing the union in the virtual field', () => {
    const { activeByRowId, allByRowId } = buildMergedDispatcherTaskCodes(
      [
        { rowId: 1, code: 'ДЗ-18' },
        { rowId: 2, code: 'ДЗ-24' },
      ],
      [
        { rowId: 1, code: 'ДЗ-24' },
        { rowId: 1, code: 'ДЗ-18' },
        { rowId: 3, code: 'ДЗ-01' },
      ],
    )

    expect(activeByRowId.get(1)).toBe('ДЗ-18')
    expect(allByRowId.get(1)).toBe('ДЗ-18, ДЗ-24')
    expect(activeByRowId.has(3)).toBe(false)
    expect(allByRowId.get(3)).toBe('ДЗ-01')
  })
})
