import { describe, expect, it } from 'vitest'
import {
  WELD_PAGE_ALL_SIZE,
  attachRkExposureSchemeFilterValues,
  buildDerivedReportCacheKey,
  buildWeldColumnFilterOptionsFromRows,
  buildWeldDataUsageSummaryFromRows,
  buildWeldReportPageFromRows,
  canPaginateReportSource,
  compactWeldRowsForTransport,
  getWeldImportSecurityScope,
  getProfileTimestampUpdates,
  mergeDuplicateControlsIntoRows,
  normalizeWeldPageRequest,
  normalizeWeldImportScopeRequest,
  normalizeWeldPageSize,
  normalizeWeldSnapshotPageRequest,
  normalizeDocumentGenerationDataRequest,
  shouldEnsureDispatcherTaskIndexForColumnFilter,
} from './welds'
import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  buildPercentageLineStampFilters,
  buildRowIdListFilters,
} from '@/lib/report-hidden-filters'
import {
  buildDispatcherTaskServerFilters,
  DISPATCHER_TASK_FILTER_KEY,
} from '@/lib/dispatcher-task-row-codes'
import { buildWeldColumnValueFilter } from '@/lib/weld-table-filtering'

describe('weld server pagination helpers', () => {
  it('uses the same dedicated password scope for every import mode', () => {
    expect(getWeldImportSecurityScope('newRecords')).toBe('importReplace')
    expect(getWeldImportSecurityScope('massFill')).toBe('importReplace')
    expect(getWeldImportSecurityScope('replaceData')).toBe('importReplace')
  })

  it('updates only the profiles whose business data changed', () => {
    const previous = row({
      hasRk: 'да',
      pstoRequired: 'да',
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      lnkCreatedAt: new Date('2026-08-01T09:00:00.000Z'),
      pstoCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
    })
    const now = new Date('2026-08-12T12:00:00.000Z')

    expect(getProfileTimestampUpdates({ ...previous, responsible: 'Иванов' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
    })
    expect(getProfileTimestampUpdates({ ...previous, rkResult: 'годен' }, previous, now)).toEqual({
      lnkUpdatedAt: now,
    })
    expect(getProfileTimestampUpdates({ ...previous, pstoNote: 'Исправлено' }, previous, now)).toEqual({
      pstoUpdatedAt: now,
    })
  })

  it('records profile entry separately from later updates', () => {
    const previous = row({ hasRk: null, pstoRequired: null, lnkCreatedAt: null, pstoCreatedAt: null })
    const now = new Date('2026-08-12T12:00:00.000Z')

    expect(getProfileTimestampUpdates({ ...previous, hasRk: 'да' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
      lnkCreatedAt: now,
      lnkUpdatedAt: now,
    })
    expect(getProfileTimestampUpdates({ ...previous, pstoRequired: 'да' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
      pstoCreatedAt: now,
      pstoUpdatedAt: now,
    })
  })

  it('records the PSTO entry only when the joint actually enters the report', () => {
    const previous = row({ weldDate: null, pstoRequired: null, pstoCreatedAt: null, pstoUpdatedAt: null })
    const now = new Date('2026-08-12T12:00:00.000Z')

    expect(getProfileTimestampUpdates({ ...previous, pstoRequired: 'да' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
      pstoUpdatedAt: now,
    })
    expect(getProfileTimestampUpdates({ ...previous, pstoRequired: 'да', weldDate: '2026-08-12' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
      pstoCreatedAt: now,
      pstoUpdatedAt: now,
    })
  })

  it('records the LNK entry only when the joint actually enters the report', () => {
    const previous = row({ weldDate: null, hasRk: null, lnkCreatedAt: null, lnkUpdatedAt: null })
    const now = new Date('2026-08-12T12:00:00.000Z')

    expect(getProfileTimestampUpdates({ ...previous, hasRk: 'да' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
      lnkUpdatedAt: now,
    })
    expect(getProfileTimestampUpdates({ ...previous, hasRk: 'да', weldDate: '2026-08-12' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
      lnkCreatedAt: now,
      lnkUpdatedAt: now,
    })
  })

  it('keeps supported page sizes and falls back to 100 for unknown values', () => {
    expect(normalizeWeldPageSize(100)).toBe(100)
    expect(normalizeWeldPageSize(300)).toBe(300)
    expect(normalizeWeldPageSize(500)).toBe(500)
    expect(normalizeWeldPageSize(1000)).toBe(1000)
    expect(normalizeWeldPageSize(WELD_PAGE_ALL_SIZE)).toBe(WELD_PAGE_ALL_SIZE)
    expect(normalizeWeldPageSize(25)).toBe(100)
    expect(normalizeWeldPageSize('5000')).toBe(100)
  })

  it('normalizes page number and removes empty column filters', () => {
    expect(
      normalizeWeldPageRequest({
        page: -3,
        pageSize: 300,
        search: 'S12',
        columnFilters: {
          line: 'LIN-000-11-31',
          joint: '   ',
        },
      }),
    ).toEqual({
      page: 1,
      pageSize: 300,
      search: 'S12',
      columnFilters: {
        line: 'LIN-000-11-31',
      },
    })

    expect(normalizeWeldPageRequest({ page: 2.9, pageSize: WELD_PAGE_ALL_SIZE }).page).toBe(2)
  })

  it('checks the dispatcher index only for dispatcher-backed column options', () => {
    expect(shouldEnsureDispatcherTaskIndexForColumnFilter('dispatcherTasks', {})).toBe(true)
    expect(shouldEnsureDispatcherTaskIndexForColumnFilter('line', {
      [DISPATCHER_TASK_FILTER_KEY]: JSON.stringify({ mode: 'codes', codes: ['DZ-1'] }),
    })).toBe(true)
    expect(shouldEnsureDispatcherTaskIndexForColumnFilter('line', {})).toBe(false)
  })

  it('normalizes full-snapshot batches without allowing oversized responses', () => {
    expect(normalizeWeldSnapshotPageRequest(undefined)).toEqual({ afterId: 0, batchSize: 1000 })
    expect(normalizeWeldSnapshotPageRequest({ afterId: 12.9, batchSize: 300 })).toEqual({
      afterId: 12,
      batchSize: 300,
    })
    expect(normalizeWeldSnapshotPageRequest({ afterId: -2, batchSize: 5000 })).toEqual({
      afterId: 0,
      batchSize: 1000,
    })
  })

  it('normalizes document generation scope without duplicate or empty values', () => {
    expect(
      normalizeDocumentGenerationDataRequest({
        periodFrom: ' 2026-07-01 ',
        periodTo: '2026-07-31',
        projects: [' Проект ', 'Проект', ''],
        subtitles: ['400', ' 400 ', '500'],
        lines: ['LIN-1', ' ', 'LIN-2'],
      }),
    ).toEqual({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      projects: ['Проект'],
      subtitles: ['400', '500'],
      lines: ['LIN-1', 'LIN-2'],
    })
  })

  it('counts settings values from lightweight rows without counting duplicates inside one joint', () => {
    expect(
      buildWeldDataUsageSummaryFromRows(
        [
          {
            joint: 'FB01',
            weldingMethod: 'РАД+РД+РАД',
            connectionType: 'С17',
            materialGroup: 'М01',
            testTypes: 'ГИ, ПИ, ГИ',
          },
          {
            joint: 'F01',
            weldingMethod: 'РД',
            connectionType: 'С17',
            materialGroup: 'М05',
            testTypes: 'ПИ',
          },
        ],
        25,
      ),
    ).toEqual({
      rowsCount: 25,
      leadingLetterIndexedRowsCount: 1,
      weldingTypes: [
        ['РАД', 1],
        ['РД', 2],
      ],
      connectionTypes: [['С17', 2]],
      materialGroups: [
        ['М01', 1],
        ['М05', 1],
      ],
      testTypes: [
        ['ГИ', 1],
        ['ПИ', 2],
      ],
    })
  })

  it('removes only empty transport fields while preserving meaningful false and zero values', () => {
    expect(
      compactWeldRowsForTransport([
        {
          id: 7,
          joint: 'F7',
          line: '',
          d1: 0,
          hasVik: false,
          materialGroup: null,
          duplicateControls: [],
        } as unknown as WeldRow,
      ]),
    ).toEqual([
      {
        id: 7,
        joint: 'F7',
        d1: 0,
        hasVik: false,
      },
    ])
  })

  it('keeps hidden report filters used by selected rows and percentage line navigation', () => {
    const rowIdFilters = buildRowIdListFilters([3, 2, 2])
    const stampFilters = buildPercentageLineStampFilters({
      projectTitle: 'Риформинг',
      subtitleCode: '400',
      line: 'LIN-000-11-31',
      stamp: 'ABC1',
    })

    const normalized = normalizeWeldPageRequest({
      columnFilters: {
        ...rowIdFilters,
        ...stampFilters,
        joint: '',
      },
    })

    expect(normalized.columnFilters[ROW_ID_LIST_FILTER_KEY]).toBe(rowIdFilters[ROW_ID_LIST_FILTER_KEY])
    expect(normalized.columnFilters[PERCENTAGE_LINE_STAMP_FILTER_KEY]).toBe(stampFilters[PERCENTAGE_LINE_STAMP_FILTER_KEY])
    expect(normalized.columnFilters.joint).toBeUndefined()
  })

  it('keeps the virtual dispatcher filter in the server import scope', () => {
    const filters = buildDispatcherTaskServerFilters({
      dispatcherTasks: buildWeldColumnValueFilter(['ДЗ-31']),
      projectTitle: ' Риформинг ',
      joint: '   ',
    })

    expect(normalizeWeldImportScopeRequest({ columnFilters: filters })).toEqual({
      columnFilters: {
        [DISPATCHER_TASK_FILTER_KEY]: filters[DISPATCHER_TASK_FILTER_KEY],
        projectTitle: 'Риформинг',
      },
    })
  })

  it('uses source pagination only for filters that can be applied before building LNK/PSTO rows', () => {
    expect(canPaginateReportSource({ line: 'LIN-1', joint: 'F1' })).toBe(true)
    expect(canPaginateReportSource(buildRowIdListFilters([1, 2]))).toBe(true)
    expect(canPaginateReportSource({ finalStatus: 'годен' })).toBe(false)
    expect(canPaginateReportSource({ unknownDerivedField: 'value' })).toBe(false)
  })

  it('separates derived report caches by every server filter but not by page', () => {
    const firstPage = buildDerivedReportCacheKey('report:v2', 'lnk', {
      projectTitle: 'Проект 1',
      line: 'LIN-1',
      search: 'F1',
      columnFilters: { finalStatus: '=годен' },
    })
    const secondPage = buildDerivedReportCacheKey('report:v2', 'lnk', {
      projectTitle: 'Проект 1',
      line: 'LIN-1',
      search: 'F1',
      columnFilters: { finalStatus: '=годен' },
    })
    const anotherProject = buildDerivedReportCacheKey('report:v2', 'lnk', {
      projectTitle: 'Проект 2',
      line: 'LIN-1',
      search: 'F1',
      columnFilters: { finalStatus: '=годен' },
    })

    expect(firstPage).toBe(secondPage)
    expect(firstPage).not.toBe(anotherProject)
  })

  it('builds LNK report pages after applying filters to all report rows', () => {
    const page = buildWeldReportPageFromRows(
      [
        row({ id: 1, joint: 'S1', hasVik: 'да' }),
        row({ id: 2, joint: 'S2', hasRk: 'да' }),
        row({ id: 3, joint: 'S3', hasVik: 'да', line: 'LIN-2' }),
      ],
      normalizeWeldPageRequest({
        page: 1,
        pageSize: 100,
        columnFilters: { line: 'LIN-1' },
      }),
      'lnk',
    )

    expect(page.total).toBe(2)
    expect(page.rows.map((candidate) => candidate.joint)).toEqual(['S1', 'S2'])
  })

  it('builds PSTO report pages from all matching PSTO rows', () => {
    const page = buildWeldReportPageFromRows(
      [
        row({ id: 1, joint: 'S1', pstoRequired: 'да' }),
        row({ id: 2, joint: 'S2', pstoRequired: '' }),
        row({ id: 3, joint: 'S3', pstoRequired: 'да' }),
      ],
      normalizeWeldPageRequest({
        page: 1,
        pageSize: 100,
        columnFilters: {},
      }),
      'heatTreatment',
    )

    expect(page.total).toBe(2)
    expect(page.rows.map((candidate) => candidate.joint)).toEqual(['S1', 'S3'])
  })

  it('builds column filter options with counts from all passed rows', () => {
    const options = buildWeldColumnFilterOptionsFromRows(
      [
        row({ id: 1, line: 'LIN-2' }),
        row({ id: 2, line: 'LIN-1' }),
        row({ id: 3, line: 'LIN-1' }),
        row({ id: 4, line: '' }),
      ],
      'line',
    )

    expect(options).toEqual([
      { value: '', label: '(пусто)', count: 1 },
      { value: 'LIN-1', label: 'LIN-1', count: 2 },
      { value: 'LIN-2', label: 'LIN-2', count: 1 },
    ])
  })

  it('builds filters from saved RK descriptions and calculated exposure schemes', () => {
    const rows = attachRkExposureSchemeFilterValues(
      [
        row({
          id: 1,
          connectionType: 'С17',
          d1: 57,
          d2: 57,
          rkExposureConfirmedDiameter: 57,
          lnkDefectDescription: '1: ДНО\n2: ДНО',
        }) as WeldRow,
      ],
      {
        fileName: 'Экспозиции.xlsx',
        uploadedAt: '2026-08-08',
        entries: [
          {
            diameter: 50,
            options: [
              { label: 'по 2 экспозициям', values: ['1', '2'], isDefault: true, note: '' },
            ],
          },
        ],
      },
    )

    expect(buildWeldColumnFilterOptionsFromRows(rows, 'rkExposureScheme')).toEqual([
      { value: 'по 2 экспозициям', label: 'по 2 экспозициям', count: 1 },
    ])
    expect(buildWeldColumnFilterOptionsFromRows(rows, 'lnkDefectDescription')).toEqual([
      { value: '1: ДНО\n2: ДНО', label: '1: ДНО\n2: ДНО', count: 1 },
    ])
  })

  it('builds final-status filter options from the same duplicate-control labels shown in rows', () => {
    const options = buildWeldColumnFilterOptionsFromRows(
      [
        {
          ...row({ id: 1, finalStatus: 'не годен по дублю' }),
          duplicateControls: [
            { id: 11, weldJointId: 1, method: 'РК', result: 'ремонт', controlDate: '', conclusion: '', conclusionDate: '' },
          ],
        } as WeldRow,
        {
          ...row({ id: 2, finalStatus: 'не годен по дублю' }),
          duplicateControls: [
            { id: 12, weldJointId: 2, method: 'УЗК', result: 'вырез', controlDate: '', conclusion: '', conclusionDate: '' },
          ],
        } as WeldRow,
      ],
      'finalStatus',
    )

    expect(options).toEqual([
      { value: 'не годен по дублю (РК)', label: 'не годен по дублю (РК)', count: 1 },
      { value: 'не годен по дублю (УЗК)', label: 'не годен по дублю (УЗК)', count: 1 },
    ])
  })

  it('attaches only duplicate controls that belong to returned page rows', () => {
    const rows = mergeDuplicateControlsIntoRows(
      [row({ id: 1, joint: 'S1' }), row({ id: 2, joint: 'S2' })] as WeldRow[],
      [
        {
          id: 10,
          weldJointId: 2,
          method: 'РК',
          result: 'ремонт',
          controlDate: '2026-07-02',
          conclusion: 'Заключение',
          conclusionDate: '2026-07-02',
        },
        {
          id: 11,
          weldJointId: 99,
          method: 'УЗК',
          result: 'годен',
          controlDate: '',
          conclusion: '',
          conclusionDate: '',
        },
      ],
    )

    expect(rows[0].duplicateControls).toEqual([])
    expect(rows[1].duplicateControls?.map((control) => control.id)).toEqual([10])
  })
})

function row(values: Partial<WeldJoint>): WeldJoint {
  return {
    id: values.id ?? 1,
    weldDate: '2026-07-01',
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'LIN-1',
    joint: 'S1',
    ...values,
  } as WeldJoint
}
