import { describe, expect, it } from 'vitest'
import type {
  DispatcherTask,
  RepeatedJointCheckTask,
  RepeatedJointCoilTask,
  RepeatedJointDuplicateCheckTask,
  RepeatedJointRenameTask,
  PercentageLineControlTask,
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
  getDispatcherTasksForJointPicture,
  getDispatcherTasksForLinePicture,
  isDispatcherTaskDirectlyRelatedToJoint,
  isDispatcherTaskRelatedToRow,
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

function systemWarningTask(rowValue: WeldRow): RepeatedJointCheckTask {
  return {
    ...stampTask(rowValue),
    key: `sp-01-${rowValue.id}`,
    reason: 'завершить предыдущие этапы контроля',
    systemWarningCode: 'СП-01',
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

  it('relates a line task to every row of the same line without case sensitivity', () => {
    const source = row(1, { projectTitle: 'Project', subtitleCode: 'S1', line: 'Lin123' })
    const task = lineTask(source) as Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>

    expect(isDispatcherTaskRelatedToRow(task, row(2, {
      projectTitle: ' project ',
      subtitleCode: 's1',
      line: 'LIN123',
    }))).toBe(true)
    expect(isDispatcherTaskRelatedToRow(task, row(3, { line: 'LIN124' }))).toBe(false)
  })

  it('keeps line-scoped tasks out of a joint picture while retaining them in the line picture', () => {
    const selected = row(2, { projectTitle: ' project ', subtitleCode: 's1', line: 'LIN123' })
    const source = row(1, { projectTitle: 'Project', subtitleCode: 'S1', line: 'Lin123' })
    const task: PercentageLineControlTask = {
      kind: 'percentage-line-control',
      key: 'percentage-line-control:new-welder:lin123:a1',
      row: source,
      issue: 'new-welder',
      projectTitle: 'Project',
      subtitleCode: 'S1',
      line: 'Lin123',
      stamp: 'A1',
      title: 'Новый сварщик на процентной линии',
      details: 'Проверьте клеймо.',
      requiredControls: 1,
      coveredControls: 0,
      assignedControls: 0,
      count: 2,
    }

    expect(isDispatcherTaskRelatedToRow(task, selected)).toBe(true)
    expect(isDispatcherTaskDirectlyRelatedToJoint(task, selected)).toBe(false)
    expect(getDispatcherTasksForJointPicture([task], selected)).toEqual([])
    expect(getDispatcherTasksForLinePicture([task], selected)).toEqual([task])
    expect(getDispatcherTasksForLinePicture([task], row(3, { line: 'LIN124' }))).toEqual([])
  })

  it('collects joint-specific tasks from every joint of the selected line for the line picture', () => {
    const first = row(1, { line: 'Линия 1' })
    const second = row(2, { line: 'Линия 1' })
    const otherLine = row(3, { line: 'Линия 2' })
    const firstTask = stampTask(first)
    const secondTask = stampTask(second)
    const otherTask = stampTask(otherLine)

    expect(getDispatcherTasksForLinePicture([firstTask, secondTask, otherTask], first)).toEqual([
      firstTask,
      secondTask,
    ])
  })

  it('indexes a duplicate task on every matching joint in the same line', () => {
    const rows = [
      row(1, { projectTitle: 'Project', subtitleCode: 'S1', line: 'Lin123', joint: 'S1' }),
      row(2, { projectTitle: ' project ', subtitleCode: 's1', line: 'LIN123', joint: 's1' }),
      row(3, { projectTitle: 'Project', subtitleCode: 'S1', line: 'Lin124', joint: 'S1' }),
    ]
    const task: RepeatedJointDuplicateCheckTask = {
      kind: 'duplicate-check',
      key: 'duplicate-check:project:s1:lin123:s1',
      row: rows[0],
      sourceJoint: 'S1',
      baseJoint: 'S1',
      count: 2,
    }

    expect(buildDispatcherTaskIndexRows([task], rows)).toEqual([
      { rowId: 1, taskKey: task.key, code: 'ДЗ-14' },
      { rowId: 2, taskKey: task.key, code: 'ДЗ-14' },
    ])
  })

  it('relates chain repair tasks to both sides of the affected chain step', () => {
    const source = row(1, { joint: 'S1' })
    const target = row(2, { joint: 'S1R1' })
    const task: RepeatedJointCheckTask = {
      ...stampTask(target),
      sourceRow: source,
      sourceJoint: 'S1',
      targetJoint: 'S1R1',
      baseJoint: 'S1',
    }

    expect(isDispatcherTaskRelatedToRow(task, source)).toBe(true)
    expect(isDispatcherTaskRelatedToRow(task, target)).toBe(true)
  })

  it('indexes new grouped dispatcher codes for the virtual field', () => {
    const rows = [row(1)]

    expect(buildDispatcherTaskIndexRows([coreDataTask(rows[0])], rows)).toEqual([
      { rowId: 1, taskKey: 'core-1', code: 'ДЗ-31' },
    ])
  })

  it('persists SP-01 in the row index and exposes it through the virtual dispatcher field', () => {
    const rows = [row(1)]
    const persistedRows = buildDispatcherTaskIndexRows([systemWarningTask(rows[0])], rows)

    expect(persistedRows).toEqual([
      { rowId: 1, taskKey: 'sp-01-1', code: 'СП-01' },
    ])
    const { activeByRowId, allByRowId } = buildMergedDispatcherTaskCodes(
      persistedRows.map(({ rowId, code }) => ({ rowId, code })),
      [],
    )
    expect(activeByRowId.get(1)).toBe('СП-01')
    expect(allByRowId.get(1)).toBe('СП-01')
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
