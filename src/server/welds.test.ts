import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
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
  getControlMethodFilterColumnKey,
  getCurrentRepeatedJointTargets,
  getProfileTimestampUpdates,
  getDerivedReportFilterSelectedFieldKeys,
  getReportContextSelect,
  getWeldColumnFilterOptionSourceFilters,
  mergeDuplicateControlsIntoRows,
  mergeEarlyCoilDecisionMetadataIntoRows,
  mergeJointChainContinuationMetadataIntoRows,
  normalizeWeldPageRequest,
  normalizeWeldImportScopeRequest,
  normalizeWeldPageSize,
  normalizeWeldSnapshotPageRequest,
  normalizeDocumentGenerationDataRequest,
  normalizeWeldColumnFilterOptions,
  prepareWeldInputForPersistence,
  restrictWeldMutationRecord,
  sameNormalizedTextSet,
  shouldEnsureDispatcherTaskIndexForColumnFilter,
} from './welds'
import { getReportOrderBy, REPORT_DERIVED_FILTER_SELECT } from './weld-read'
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
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import { WELD_EFFECTIVE_OFFICIALITY } from '@/server/weld-server-shared'

describe('weld server pagination helpers', () => {
  it('keeps staged-control relations in the final-status persistence calculation', () => {
    const normalized = prepareWeldInputForPersistence({
      joint: 'F50',
      weldDate: '2026-08-01',
      pstoRequired: 'да',
      hasVik: 'да',
      vikRequest: 'ВИК после ТО',
      vikResult: 'годен',
      pstoRequest: 'ПСТО-1',
      pstoResult: 'проведено',
      tvmtRequest: 'ТВМТ-1',
      tvmtResult: null,
      finalStatus: 'ожидает заявку',
      preHeatTreatmentControls: [{
        id: 100,
        weldJointId: 50,
        method: 'ВИК',
        requestName: 'ВИК до ТО',
        result: 'годен',
      }],
      pstoRepeatCycles: [{
        id: 200,
        weldJointId: 50,
        sequence: 2,
        pstoRequest: 'ПСТО-2',
        pstoResult: 'проведено',
        tvmtRequest: 'ТВМТ-2',
        tvmtResult: 'годен',
      }],
    } as unknown as WeldRow)

    expect(normalized.finalStatus).toBe('годен')
  })

  it('filters TVMT demand by the PSTO line assignment', () => {
    expect(getControlMethodFilterColumnKey('ТВМТ')).toBe('pstoRequired')
    expect(getControlMethodFilterColumnKey('РК')).toBe('hasRk')
    expect(getControlMethodFilterColumnKey('ПСТО')).toBeNull()
  })

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
    expect(getProfileTimestampUpdates({ ...previous, rkControlBasis: 'ТР №1' }, previous, now)).toEqual({
      weldingUpdatedAt: now,
      lnkUpdatedAt: now,
    })
    expect(getProfileTimestampUpdates({ ...previous, pstoControlBasis: 'Письмо №2' }, previous, now)).toEqual({
      pstoUpdatedAt: now,
    })
  })

  it('keeps stale fields from another workflow out of a scoped save', () => {
    const staleClientRow = {
      ...row({
      responsible: 'Петров',
      hasRk: 'да',
      rkRequest: 'Заявка РК-2',
      rkResult: 'годен',
      vikDefectDescription: 'ВИК из отчета ЛНК',
      uzkDefectDescription: 'УЗК из отчета ЛНК',
      pvkDefectDescription: 'ПВК из отчета ЛНК',
      pstoRequired: 'да',
      pstoRequest: 'Заявка ПСТО-1',
      tvmtResult: null,
      }),
      preHeatTreatmentLnkExempt: false,
    }

    const lnkRecord = restrictWeldMutationRecord(staleClientRow, 'lnk')
    expect(lnkRecord).toMatchObject({
      id: staleClientRow.id,
      rkRequest: 'Заявка РК-2',
      rkResult: 'годен',
      vikDefectDescription: 'ВИК из отчета ЛНК',
      uzkDefectDescription: 'УЗК из отчета ЛНК',
      pvkDefectDescription: 'ПВК из отчета ЛНК',
    })
    expect(lnkRecord).not.toHaveProperty('responsible')
    expect(lnkRecord).not.toHaveProperty('hasRk')
    expect(lnkRecord).not.toHaveProperty('pstoRequest')
    expect(lnkRecord).not.toHaveProperty('tvmtResult')
    expect(lnkRecord).not.toHaveProperty('preHeatTreatmentLnkExempt')

    const pstoRecord = restrictWeldMutationRecord(staleClientRow, 'psto')
    expect(pstoRecord).toMatchObject({
      id: staleClientRow.id,
      pstoRequest: 'Заявка ПСТО-1',
      tvmtResult: null,
    })
    expect(pstoRecord).not.toHaveProperty('pstoRequired')
    expect(pstoRecord).not.toHaveProperty('rkRequest')
    expect(pstoRecord).not.toHaveProperty('vikDefectDescription')
    expect(pstoRecord).not.toHaveProperty('uzkDefectDescription')
    expect(pstoRecord).not.toHaveProperty('pvkDefectDescription')
    expect(pstoRecord).not.toHaveProperty('preHeatTreatmentLnkExempt')

    const weldingRecord = restrictWeldMutationRecord(staleClientRow, 'welding')
    expect(weldingRecord).toMatchObject({
      id: staleClientRow.id,
      responsible: 'Петров',
      hasRk: 'да',
    })
    expect(weldingRecord).not.toHaveProperty('rkRequest')
    expect(weldingRecord).not.toHaveProperty('pstoRequest')
    expect(weldingRecord).not.toHaveProperty('vikDefectDescription')
    expect(weldingRecord).not.toHaveProperty('uzkDefectDescription')
    expect(weldingRecord).not.toHaveProperty('pvkDefectDescription')
    expect(weldingRecord).not.toHaveProperty('preHeatTreatmentLnkExempt')

    expect(prepareWeldInputForPersistence({
      ...staleClientRow,
      tvmtResult: 'не годен',
    }).tvmtResult).toBe('не годен')
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
      pstoCreatedAt: now,
      pstoUpdatedAt: now,
    })
  })

  it('derives a repeated-joint target from the current locked chain', () => {
    const source = row({
      id: 51,
      projectTitle: 'Проект',
      subtitleCode: 'Титул',
      line: 'Линия 1',
      joint: 'F1',
      rkResult: 'ремонт',
    }) as WeldRow
    expect(getCurrentRepeatedJointTargets(
      [source],
      source,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toEqual(['F1R1'])

    const existingTarget = row({
      id: 52,
      projectTitle: 'Проект',
      subtitleCode: 'Титул',
      line: 'Линия 1',
      joint: 'F1R1',
      rkResult: null,
    }) as WeldRow
    expect(getCurrentRepeatedJointTargets(
      [source, existingTarget],
      source,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toEqual([])

    const firstCoilJoint = row({
      id: 53,
      projectTitle: 'Проект',
      subtitleCode: 'Титул',
      line: 'Линия 1',
      joint: 'F1Y1',
    }) as WeldRow
    expect(getCurrentRepeatedJointTargets(
      [source, firstCoilJoint],
      source,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
      true,
    )).toEqual(['F1Y2'])

    expect(getCurrentRepeatedJointTargets(
      [{ ...source, d1: 57, d2: 57 }],
      { ...source, d1: 57, d2: 57 },
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toEqual([])

    const repairLimitSource = { ...source, joint: 'F1R2', d1: 159, d2: 159 }
    expect(getCurrentRepeatedJointTargets(
      [repairLimitSource],
      repairLimitSource,
      DEFAULT_SYSTEM_INDEX_SETTINGS,
    )).toEqual([])
  })

  it('rejects repeated-joint targets duplicated only by letter case', () => {
    expect(sameNormalizedTextSet(['F1R1'], ['F1R1'])).toBe(true)
    expect(sameNormalizedTextSet(['F1R1', 'f1r1'], ['F1R1'])).toBe(false)
    expect(sameNormalizedTextSet(['F1R1'], ['F1R1', 'f1r1'])).toBe(false)
  })

  it('records the PSTO entry only when the joint actually enters the report', () => {
    const previous = row({ weldDate: null, pstoRequired: null, pstoCreatedAt: null, pstoUpdatedAt: null })
    const now = new Date('2026-08-12T12:00:00.000Z')

    expect(getProfileTimestampUpdates({ ...previous, pstoRequired: 'да' }, previous, now)).toEqual({
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

  it('migrates the legacy status filter and sort key at the server boundary', () => {
    const normalized = normalizeWeldPageRequest({
      status: 'неофициальный',
      columnFilters: { status: 'неофициальный' },
      sort: { fieldKey: 'status', direction: 'asc' },
    } as unknown as Parameters<typeof normalizeWeldPageRequest>[0])

    expect(normalized.officiality).toBe('неофициальный')
    expect(normalized).not.toHaveProperty('status')
    expect(normalized.columnFilters).toEqual({ officiality: 'неофициальный' })
    expect(normalized.sort).toEqual({ fieldKey: 'officiality', direction: 'asc' })
  })

  it('reads officiality from its final database column', () => {
    const compiled = new PgDialect().sqlToQuery(sql`select ${WELD_EFFECTIVE_OFFICIALITY}`)

    expect(compiled.sql).toContain('"officiality"')
    expect(compiled.sql).not.toContain('"status"')
    expect(compiled.sql).not.toContain('coalesce')
  })

  it('checks the dispatcher index for dispatcher-backed and persisted final-status options', () => {
    expect(shouldEnsureDispatcherTaskIndexForColumnFilter('dispatcherTasks', {})).toBe(true)
    expect(shouldEnsureDispatcherTaskIndexForColumnFilter('finalStatus', {})).toBe(true)
    expect(shouldEnsureDispatcherTaskIndexForColumnFilter('line', {
      finalStatus: buildWeldColumnValueFilter(['годен']),
    })).toBe(true)
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

  it('keeps report-context dependencies while excluding unrelated wide fields', () => {
    expect(Object.keys(getReportContextSelect('lnk'))).toEqual(expect.arrayContaining([
      'pstoResult',
      'rkExposureConfirmedDiameter',
      'rkBoq',
    ]))
    expect(getReportContextSelect('lnk')).not.toHaveProperty('materialCertificateNumber1')
    expect(getReportContextSelect('lnk')).not.toHaveProperty('testTypes')

    expect(Object.keys(getReportContextSelect('heatTreatment'))).toEqual(expect.arrayContaining([
      'pstoBoq',
      'rkResult',
      'rkConclusion',
    ]))
    expect(getReportContextSelect('heatTreatment')).not.toHaveProperty('rkBoq')
    expect(getReportContextSelect('heatTreatment')).not.toHaveProperty('weldingElectrodesCertificateNumber')
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

  it('removes empty and negative assignments while canonicalizing enabled values', () => {
    expect(
      compactWeldRowsForTransport([
        {
          id: 7,
          joint: 'F7',
          line: '',
          d1: 0,
          hasVik: false,
          pstoRequired: 'Да',
          materialGroup: null,
          duplicateControls: [],
        } as unknown as WeldRow,
      ]),
    ).toEqual([
      {
        id: 7,
        joint: 'F7',
        d1: 0,
        pstoRequired: 'да',
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

  it('migrates the legacy status column in the server import scope', () => {
    expect(normalizeWeldImportScopeRequest({
      columnFilters: { status: 'неофициальный' },
    })).toEqual({
      columnFilters: { officiality: 'неофициальный' },
    })
  })

  it('uses source pagination for stored fields, including the refreshed final-status index', () => {
    expect(canPaginateReportSource({ line: 'LIN-1', joint: 'F1' })).toBe(true)
    expect(canPaginateReportSource(buildRowIdListFilters([1, 2]))).toBe(true)
    expect(canPaginateReportSource({ finalStatus: 'годен' })).toBe(true)
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

  it('sorts the full filtered report before pagination', () => {
    const page = buildWeldReportPageFromRows(
      [
        row({ id: 1, joint: 'F2', line: 'LIN-1', hasVik: 'да' }),
        row({ id: 2, joint: 'F10', line: 'LIN-1', hasVik: 'да' }),
        row({ id: 3, joint: 'F1', line: 'LIN-1', hasVik: 'да' }),
      ],
      normalizeWeldPageRequest({
        page: 1,
        pageSize: 100,
        columnFilters: {},
        sort: { fieldKey: 'joint', direction: 'desc' },
      }),
      'lnk',
    )

    expect(page.rows.map((candidate) => candidate.joint)).toEqual(['F10', 'F2', 'F1'])
  })

  it('uses numeric parts when PostgreSQL sorts joint names', () => {
    const orderBy = getReportOrderBy('weldingJournal', { fieldKey: 'joint', direction: 'desc' })
    const compiled = new PgDialect().sqlToQuery(sql`
      select 1 from ${sql.identifier('weld_joints')}
      order by ${sql.join(orderBy, sql`, `)}
    `)

    expect(compiled.sql).toContain('substring')
    expect(compiled.sql).toContain('regexp_replace')
    expect(compiled.sql).toContain('::numeric')
  })

  it('builds contextual control basis summaries for each report', () => {
    const sourceRows = [
      row({
        id: 1,
        joint: 'S1',
        hasRk: 'да',
        pstoRequired: 'да',
        rkControlBasis: 'ТР №1',
        pstoControlBasis: 'Письмо №2',
      }),
    ]

    const journal = buildWeldReportPageFromRows(sourceRows, normalizeWeldPageRequest({ columnFilters: {} }), 'weldingJournal')
    const lnk = buildWeldReportPageFromRows(sourceRows, normalizeWeldPageRequest({ columnFilters: {} }), 'lnk')
    const psto = buildWeldReportPageFromRows(sourceRows, normalizeWeldPageRequest({ columnFilters: {} }), 'heatTreatment')

    expect(journal.rows[0].controlBasisSummary).toBe('РК: ТР №1')
    expect(lnk.rows[0].controlBasisSummary).toBe('РК: ТР №1')
    expect(psto.rows[0].controlBasisSummary).toBe('')
    expect(psto.rows[0].pstoControlBasis).toBeNull()
  })

  it('filters the combined basis summary from LNK assignments only', () => {
    const sourceRows = [
      row({ id: 1, joint: 'S1', weldDate: '2026-08-19', hasRk: 'да', rkControlBasis: 'ТР №1' }),
      row({ id: 2, joint: 'S2', weldDate: '2026-08-19', hasRk: 'да', pstoRequired: 'отменен', pstoCancellationDate: '2026-08-20', pstoControlBasis: 'Письмо №2' }),
    ]
    const request = normalizeWeldPageRequest({
      page: 1,
      pageSize: 100,
      columnFilters: { controlBasisSummary: 'ТР №1' },
    })

    const journal = buildWeldReportPageFromRows(sourceRows, request, 'weldingJournal')
    const lnk = buildWeldReportPageFromRows(sourceRows, request, 'lnk')
    const psto = buildWeldReportPageFromRows(sourceRows, request, 'heatTreatment')

    expect(journal.rows.map((candidate) => candidate.joint)).toEqual(['S1'])
    expect(lnk.rows.map((candidate) => candidate.joint)).toEqual(['S1'])
    expect(psto.rows).toEqual([])
  })

  it('filters the cancellation basis in its dedicated PSTO column', () => {
    const sourceRows = [
      row({ id: 1, joint: 'S1', weldDate: '2026-08-19', pstoRequired: 'да', pstoControlBasis: 'Старое основание' }),
      row({ id: 2, joint: 'S2', weldDate: '2026-08-19', pstoRequired: 'отменен', pstoCancellationDate: '2026-08-20', pstoControlBasis: 'Письмо №2' }),
    ]
    const request = normalizeWeldPageRequest({
      page: 1,
      pageSize: 100,
      columnFilters: { pstoControlBasis: 'Письмо №2' },
    })

    const psto = buildWeldReportPageFromRows(sourceRows, request, 'heatTreatment')

    expect(psto.rows.map((candidate) => candidate.joint)).toEqual(['S2'])
    expect(psto.rows[0].pstoControlBasis).toBe('Письмо №2')
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

  it('combines legacy negative assignment spellings into the empty filter option', () => {
    expect(normalizeWeldColumnFilterOptions('pstoRequired', [
      { value: '', label: '(пусто)', count: 1_982 },
      { value: '0', label: '0', count: 11 },
      { value: 'Да', label: 'Да', count: 425 },
      { value: 'да', label: 'да', count: 397 },
      { value: 'Нет', label: 'Нет', count: 2_611 },
      { value: 'нет', label: 'нет', count: 758 },
    ])).toEqual([
      { value: '', label: '(пусто)', count: 5_362 },
      { value: 'да', label: 'да', count: 822 },
    ])
  })

  it('does not apply a stored WDI value before recalculating filter option counts', () => {
    const filters = {
      connectionType: buildWeldColumnValueFilter(['C17']),
      wdi: buildWeldColumnValueFilter(['1.2', '2.3']),
      controlBasisSummary: buildWeldColumnValueFilter(['РК: ТР №1']),
      finalStatus: buildWeldColumnValueFilter(['годен']),
      rkExposureScheme: buildWeldColumnValueFilter(['по 2 экспозициям']),
      preRkResult: buildWeldColumnValueFilter(['годен']),
    }

    expect(getWeldColumnFilterOptionSourceFilters(filters, true)).toEqual({
      connectionType: filters.connectionType,
      finalStatus: filters.finalStatus,
    })
    expect(getWeldColumnFilterOptionSourceFilters(filters, false)).toEqual({
      connectionType: filters.connectionType,
      finalStatus: filters.finalStatus,
      wdi: filters.wdi,
    })
    const ordinaryFilters = { connectionType: filters.connectionType }
    expect(getWeldColumnFilterOptionSourceFilters(ordinaryFilters, true)).toBe(ordinaryFilters)
  })

  it('loads every report date needed to build LNK and PSTO date-filter options', () => {
    const selectedFieldKeys = getDerivedReportFilterSelectedFieldKeys()

    for (const method of LNK_METHODS) {
      expect(selectedFieldKeys.has(method.requestDateKey)).toBe(true)
      expect(selectedFieldKeys.has(method.conclusionDateKey)).toBe(true)
    }
    expect(selectedFieldKeys.has('pstoRequestDate')).toBe(true)
    expect(selectedFieldKeys.has('pstoDate')).toBe(true)
    expect(REPORT_DERIVED_FILTER_SELECT).toHaveProperty('preHeatTreatmentLnkExempt')
    expect(selectedFieldKeys.has('heatTreatmentDiagram')).toBe(true)
    expect(selectedFieldKeys.has('finalStatus')).toBe(true)
    expect(selectedFieldKeys.has('rkControlBasis')).toBe(true)
    expect(selectedFieldKeys.has('pstoControlBasis')).toBe(true)
  })

  it('also loads an ordinary option field when another report filter requires derived rows', () => {
    const selectedFieldKeys = getDerivedReportFilterSelectedFieldKeys('groupName')

    expect(selectedFieldKeys.has('groupName')).toBe(true)
    expect(selectedFieldKeys.has('wdi')).toBe(true)
    expect(selectedFieldKeys.has('rkControlBasis')).toBe(true)
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

  it('marks only report rows that own an accepted early-coil decision', () => {
    const rows = mergeEarlyCoilDecisionMetadataIntoRows(
      [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })],
      new Set([2]),
    )

    expect(rows[0]).not.toHaveProperty('earlyCoilDecisionAccepted')
    expect(rows[1]).toMatchObject({ id: 2, earlyCoilDecisionAccepted: true })
    expect(rows[2]).not.toHaveProperty('earlyCoilDecisionAccepted')
  })

  it('attaches a resolved chain continuation only to its exact source row', () => {
    const continuation = {
      kind: 'repeated-joint' as const,
      sourceRowId: 2,
      sourceJoint: 'S2',
      targetJoints: ['S2R1'],
      targetRowIds: [4],
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'LIN-1',
    }
    const rows = mergeJointChainContinuationMetadataIntoRows(
      [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })],
      [continuation],
    )

    expect(rows[0]).not.toHaveProperty('chainContinuation')
    expect(rows[1]).toMatchObject({ id: 2, chainContinuation: continuation })
    expect(rows[2]).not.toHaveProperty('chainContinuation')
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
