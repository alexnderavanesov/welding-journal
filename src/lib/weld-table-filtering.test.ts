import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
} from '@/lib/dispatcher-task-row-codes'
import { buildPercentageLineStampFilters, buildRowIdListFilters } from '@/lib/report-navigation'
import {
  buildWeldColumnValueFilter,
  filterWeldRowsByColumns,
  getWeldColumnFilterRowText,
  groupWeldDateTimeFilterOptions,
  sortWeldDateTimeFilterOptions,
} from '@/lib/weld-table-filtering'

function row(partial: Partial<WeldRow>): WeldRow {
  return {
    id: crypto.randomUUID(),
    projectTitle: 'ТКМ5',
    subtitleCode: '1',
    line: '330-01',
    joint: '',
    ...partial,
  } as WeldRow
}

describe('filterWeldRowsByColumns', () => {
  it('applies the quick search across identity and material fields together with column filters', () => {
    const rows = [
      row({ joint: 'S13', line: 'LIN-1', materialFullName1: 'Труба 09Г2С' }),
      row({ joint: 'F20', line: 'LIN-2', materialFullName1: 'Труба 12Х18Н10Т' }),
      row({ joint: 'F21', line: 'LIN-1', materialFullName1: 'Труба 12Х18Н10Т' }),
    ]

    expect(filterWeldRowsByColumns(rows, { search: '09г2с' }).map((candidate) => candidate.joint)).toEqual(['S13'])
    expect(filterWeldRowsByColumns(rows, { search: 'lin-1', joint: 'F' }).map((candidate) => candidate.joint)).toEqual(['F21'])
  })

  it('filters percentage line rows by stamp in any official stamp field', () => {
    const rows = [
      row({ joint: 'S1', stamp1K: 'ABC1' }),
      row({ joint: 'S2', stamp1Z: 'ABC1' }),
      row({ joint: 'S3', stamp2O: 'ABC1' }),
      row({ joint: 'S4', stamp1K: 'ARCH' }),
      row({ joint: 'S5', line: '330-02', stamp1K: 'ABC1' }),
      row({ joint: 'S6', stamp1KFact: 'ABC1' }),
    ]

    const filteredRows = filterWeldRowsByColumns(
      rows,
      buildPercentageLineStampFilters({
        projectTitle: 'ТКМ5',
        subtitleCode: '1',
        line: '330-01',
        stamp: 'ABC1',
      }),
    )

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S1', 'S2', 'S3'])
  })

  it('filters by selected column values', () => {
    const rows = [
      row({ joint: 'S1', line: 'LIN-1' }),
      row({ joint: 'S2', line: 'LIN-2' }),
      row({ joint: 'S3', line: 'LIN-3' }),
    ]

    const filteredRows = filterWeldRowsByColumns(rows, {
      line: buildWeldColumnValueFilter(['LIN-1', 'LIN-3']),
    })

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S1', 'S3'])
  })

  it('treats legacy assignment spellings as canonical lowercase values', () => {
    const rows = [
      row({ joint: 'S1', pstoRequired: 'Да' }),
      row({ joint: 'S2', pstoRequired: 'да' }),
      row({ joint: 'S3', pstoRequired: '1' }),
      row({ joint: 'S4', pstoRequired: 'Нет' }),
      row({ joint: 'S5', pstoRequired: '0' }),
    ]

    expect(rows.map((candidate) => getWeldColumnFilterRowText(candidate, 'pstoRequired'))).toEqual([
      'да',
      'да',
      'да',
      'нет',
      'нет',
    ])
    expect(filterWeldRowsByColumns(rows, {
      pstoRequired: buildWeldColumnValueFilter(['да']),
    }).map((candidate) => candidate.joint)).toEqual(['S1', 'S2', 'S3'])
    expect(filterWeldRowsByColumns(rows, {
      pstoRequired: buildWeldColumnValueFilter(['нет']),
    }).map((candidate) => candidate.joint)).toEqual(['S4', 'S5'])
    expect(filterWeldRowsByColumns(rows, {
      pstoRequired: buildWeldColumnValueFilter(['Да']),
    }).map((candidate) => candidate.joint)).toEqual(['S1', 'S2', 'S3'])
    expect(filterWeldRowsByColumns(rows, {
      pstoRequired: buildWeldColumnValueFilter(['0']),
    }).map((candidate) => candidate.joint)).toEqual(['S4', 'S5'])
    expect(filterWeldRowsByColumns(rows, {
      pstoRequired: '=Да',
    }).map((candidate) => candidate.joint)).toEqual(['S1', 'S2', 'S3'])
    expect(filterWeldRowsByColumns(rows, {
      pstoRequired: '=0',
    }).map((candidate) => candidate.joint)).toEqual(['S4', 'S5'])
  })

  it('combines project, subtitle, line and welder stamp filters as one scope', () => {
    const rows = [
      row({ joint: 'S1', projectTitle: 'Проект А', subtitleCode: '400', line: 'LIN-1', stamp1K: 'ABC1' }),
      row({ joint: 'S2', projectTitle: 'Проект А', subtitleCode: '400', line: 'LIN-1', stamp1K: 'BBBB' }),
      row({ joint: 'S3', projectTitle: 'Проект А', subtitleCode: '500', line: 'LIN-1', stamp1K: 'ABC1' }),
      row({ joint: 'S4', projectTitle: 'Проект Б', subtitleCode: '400', line: 'LIN-1', stamp1K: 'ABC1' }),
      row({ joint: 'S5', projectTitle: 'Проект А', subtitleCode: '400', line: 'LIN-2', stamp1K: 'ABC1' }),
    ]

    const filteredRows = filterWeldRowsByColumns(rows, {
      projectTitle: buildWeldColumnValueFilter(['Проект А']),
      subtitleCode: buildWeldColumnValueFilter(['400']),
      line: buildWeldColumnValueFilter(['LIN-1']),
      stamp1K: buildWeldColumnValueFilter(['ABC1']),
    })

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S1'])
  })

  it('filters by a calculated RK exposure scheme supplied by the server', () => {
    const rows = [
      row({ id: 1, joint: 'S1', rkExposureScheme: 'по 2 экспозициям' }),
      row({ id: 2, joint: 'S2', rkExposureScheme: 'по 4 экспозициям' }),
    ]

    const filteredRows = filterWeldRowsByColumns(rows, {
      rkExposureScheme: buildWeldColumnValueFilter(['по 4 экспозициям']),
    })

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S2'])
  })

  it('filters rejected duplicate statuses by the same method-qualified text shown in the table', () => {
    const rows = [
      row({
        id: 1,
        joint: 'S1',
        finalStatus: 'не годен по дублю',
        duplicateControls: [
          { id: 11, weldJointId: 1, method: 'РК', result: 'ремонт', controlDate: '', conclusion: '', conclusionDate: '' },
        ],
      }),
      row({
        id: 2,
        joint: 'S2',
        finalStatus: 'не годен по дублю',
        duplicateControls: [
          { id: 12, weldJointId: 2, method: 'УЗК', result: 'вырез', controlDate: '', conclusion: '', conclusionDate: '' },
        ],
      }),
      row({ id: 3, joint: 'S3', finalStatus: 'не годен' }),
    ]

    const filteredRows = filterWeldRowsByColumns(rows, {
      finalStatus: buildWeldColumnValueFilter(['не годен по дублю (РК)']),
    })

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S1'])
  })

  it('combines selected row filter with ordinary column filters', () => {
    const rows = [
      row({ id: 1, joint: 'S1', line: 'LIN-1' }),
      row({ id: 2, joint: 'S2', line: 'LIN-1' }),
      row({ id: 3, joint: 'S3', line: 'LIN-2' }),
    ]

    const filteredRows = filterWeldRowsByColumns(rows, {
      line: 'LIN-1',
      ...buildRowIdListFilters([2, 3]),
    })

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S2'])
  })

  it('filters virtual dispatcher task codes without changing stored weld data', () => {
    const rows = [
      row({ id: 1, joint: 'S1', dispatcherTasks: 'ДЗ-18, ДЗ-24' }),
      row({ id: 2, joint: 'S2', dispatcherTasks: 'ДЗ-24' }),
      row({ id: 3, joint: 'S3', dispatcherTasks: '' }),
    ]

    expect(
      filterWeldRowsByColumns(rows, {
        [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITH_FILTER,
      }).map((candidate) => candidate.joint),
    ).toEqual(['S1', 'S2'])
    expect(
      filterWeldRowsByColumns(rows, {
        [DISPATCHER_TASKS_FIELD_KEY]: DISPATCHER_TASKS_WITHOUT_FILTER,
      }).map((candidate) => candidate.joint),
    ).toEqual(['S3'])
    expect(
      filterWeldRowsByColumns(rows, {
        [DISPATCHER_TASKS_FIELD_KEY]: buildWeldColumnValueFilter(['ДЗ-18']),
      }).map((candidate) => candidate.joint),
    ).toEqual(['S1'])
  })

  it('supports an excluded row-id list', () => {
    const rows = [
      row({ id: 1, joint: 'S1' }),
      row({ id: 2, joint: 'S2' }),
      row({ id: 3, joint: 'S3' }),
    ]

    const filteredRows = filterWeldRowsByColumns(rows, buildRowIdListFilters([1, 3], 'exclude'))

    expect(filteredRows.map((candidate) => candidate.joint)).toEqual(['S2'])
  })
})

describe('sortWeldDateTimeFilterOptions', () => {
  it('orders timestamps from newest to oldest and keeps empty last', () => {
    const options = [
      { value: '2026-07-10 19:12:11.247669+00', label: '2026-07-10 19:12:11.247669+00' },
      { value: '', label: '(пусто)' },
      { value: '2026-08-09 19:49:49.396316+00', label: '2026-08-09 19:49:49.396316+00' },
      { value: '2026-07-15 16:29:25.23301+00', label: '2026-07-15 16:29:25.23301+00' },
    ]

    expect(sortWeldDateTimeFilterOptions(options).map((option) => option.value)).toEqual([
      '2026-08-09 19:49:49.396316+00',
      '2026-07-15 16:29:25.23301+00',
      '2026-07-10 19:12:11.247669+00',
      '',
    ])
  })

  it('groups timestamps displayed within the same second', () => {
    const options = [
      { value: '2026-08-09 19:49:49.396316+00', label: 'first', count: 3 },
      { value: '2026-08-09 19:49:49.112345+00', label: 'second', count: 5 },
      { value: '2026-08-09 19:48:02.000000+00', label: 'third', count: 2 },
      { value: '', label: '(пусто)', count: 1 },
    ]

    expect(groupWeldDateTimeFilterOptions(options)).toEqual([
      {
        value: '2026-08-09 19:49:49.396316+00',
        label: '09.08.26 22:49:49',
        count: 8,
        values: [
          '2026-08-09 19:49:49.396316+00',
          '2026-08-09 19:49:49.112345+00',
        ],
      },
      {
        value: '2026-08-09 19:48:02.000000+00',
        label: '09.08.26 22:48:02',
        count: 2,
        values: ['2026-08-09 19:48:02.000000+00'],
      },
      { value: '', label: '(пусто)', count: 1, values: [''] },
    ])
  })
})
