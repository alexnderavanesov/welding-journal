import 'dotenv/config'

import { performance } from 'node:perf_hooks'

import { Client } from 'pg'
import { sql, TransactionRollbackError } from 'drizzle-orm'

const LOAD_DATABASE_NAME = 'welding_tracker_load_200k'
const DEFAULT_ROW_COUNT = 200_000
const MAX_ROW_COUNT = 200_000

const command = process.argv[2] ?? 'measure'
const rowCount = readPositiveInteger(process.argv[3], DEFAULT_ROW_COUNT, MAX_ROW_COUNT)
const databaseUrl = process.env.DATABASE_URL ?? ''
const parsedUrl = new URL(databaseUrl)

if (!new Set(['localhost', '127.0.0.1', '[::1]']).has(parsedUrl.hostname)) {
  throw new Error('System scale benchmark can run only against local PostgreSQL.')
}
if (parsedUrl.pathname.slice(1) !== LOAD_DATABASE_NAME) {
  throw new Error(`System scale benchmark requires the isolated ${LOAD_DATABASE_NAME} database.`)
}

if (command === 'seed') {
  await seedDatabase(rowCount)
} else if (command === 'measure') {
  await measureApplicationWorkflows({ includeColdDispatcher: true })
} else if (command === 'measure-pages') {
  await measureApplicationWorkflows({ includeColdDispatcher: false })
} else {
  throw new Error(`Unknown command: ${command}. Use seed, measure, or measure-pages.`)
}

async function seedDatabase(totalRows: number) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const measurements: Record<string, number> = {}
    measurements.truncateMs = await measureMs(async () => {
      await client.query(`
        do $$
        declare table_record record;
        begin
          for table_record in
            select tablename from pg_tables where schemaname = 'public'
          loop
            execute format('truncate table %I restart identity cascade', table_record.tablename);
          end loop;
        end $$;
      `)
    })

    measurements.weldJointsMs = await measureMs(async () => {
      await client.query(buildWeldJointSeedSql(), [totalRows])
    })

    measurements.preHeatTreatmentControlsMs = await measureMs(async () => {
      await client.query(`
        insert into pre_heat_treatment_controls (
          weld_joint_id, method, request_name, request_date, result,
          conclusion_date, conclusion_name, defect_description
        )
        select
          id,
          method,
          'PRE-' || method || '-' || ((id - 1) / 40 + 1)::text,
          weld_date + 1,
          'годен',
          weld_date + 2,
          'PRE-C-' || method || '-' || ((id - 1) / 40 + 1)::text,
          'ДНО'
        from weld_joints
        cross join lateral (
          values ('ВИК'), ('РК')
        ) as methods(method)
        where lower(coalesce(psto_required, '')) = 'да'
          and (methods.method = 'ВИК' or lower(coalesce(has_rk, '')) = 'да')
      `)
    })

    measurements.relatedRecordsMs = await measureMs(async () => {
      await client.query(`
        insert into psto_repeat_cycles (
          weld_joint_id, sequence, psto_request, psto_request_date, psto_date,
          heat_treatment_diagram, psto_result, tvmt_request, tvmt_request_date,
          tvmt_result, tvmt_conclusion_date, tvmt_conclusion
        )
        select
          id, 2, 'PSTO-R-' || id::text, weld_date + 8, weld_date + 9,
          'D-R-' || id::text, 'проведено', 'TVMT-R-' || id::text, weld_date + 9,
          'годен', weld_date + 10, 'TVMT-C-R-' || id::text
        from weld_joints
        where id % 500 = 0
      `)
      await client.query(`
        insert into duplicate_controls (
          weld_joint_id, method, result, control_date, conclusion, conclusion_date
        )
        select
          id,
          case when id % 2 = 0 then 'РК' else 'ВИК' end,
          'годен',
          weld_date + 7,
          'DUP-C-' || id::text,
          weld_date + 7
        from weld_joints
        where id % 100 = 0
      `)
      await client.query(`
        insert into welder_stamps (
          naks_stamp, welder_name, internal_stamp, weld_type, material_groups,
          diameter_from, diameter_to, thickness_from, thickness_to,
          valid_from, valid_to, naks_permits, dls_permits
        )
        select
          'ST-' || lpad(value::text, 4, '0'),
          'Welder ' || value::text,
          'IN-' || lpad(value::text, 4, '0'),
          'РД', 'M01', '20', '1420', '2', '40',
          date '2024-01-01', date '2028-12-31', 'НГДО п.1', 'Разрешено'
        from generate_series(1, 2000) as generated(value)
      `)
      await client.query(`
        insert into welder_stamp_suspensions (naks_stamp, suspended_from, suspended_to)
        select
          'ST-' || lpad((value * 100)::text, 4, '0'),
          date '2026-01-01',
          date '2026-01-10'
        from generate_series(1, 20) as generated(value)
      `)
    })

    measurements.documentsMs = await measureMs(async () => {
      await client.query(`
        insert into document_templates (
          id, blob_key, file_name, file_type, file_size, metadata, options, constructor_config
        )
        select
          template_id,
          template_id || '/load-test-template.xlsx',
          template_id || '.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          1024,
          '{"sheetNames":["Sheet1"],"fields":[],"markerCount":0,"locations":[],"warnings":[]}',
          '{}',
          null
        from unnest(array[
          'weldingJournal', 'checklist', 'zni',
          'layeredVikEdges', 'layeredVikLayers', 'layeredPvkEdges', 'layeredPvkLayers',
          'lnkRequest', 'lnkConclusionVik', 'lnkConclusionRk', 'lnkConclusionUzk',
          'lnkConclusionPvk', 'lnkConclusionOther', 'pstoRequest', 'pstoConclusion',
          'tvmtRequest', 'tvmtConclusion'
        ]::text[]) as templates(template_id)
      `)
      await client.query(`
        with generated as (
          select
            value,
            case value % 13
              when 0 then 'weldingJournal'
              when 1 then 'checklist'
              when 2 then 'zni'
              when 3 then 'system:lnkRequest'
              when 4 then 'system:lnkConclusionVik'
              when 5 then 'system:lnkConclusionRk'
              when 6 then 'system:lnkConclusionUzk'
              when 7 then 'system:lnkConclusionPvk'
              when 8 then 'system:lnkConclusionOther'
              when 9 then 'system:pstoRequest'
              when 10 then 'system:pstoConclusion'
              when 11 then 'system:tvmtRequest'
              else 'system:tvmtConclusion'
            end as document_type,
            date '2025-01-01' + ((value - 1) % 600) as document_date
          from generate_series(1, $1::integer) as source(value)
        )
        insert into generated_documents (
          type, title, file_name, mime_type, period_from, period_to,
          row_count, wdi_total, document_number, source_metadata
        )
        select
          document_type,
          'Load document ' || value::text,
          'load-document-' || value::text || '.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          document_date,
          document_date,
          8,
          10,
          value,
          case
            when document_type like 'system:%' then jsonb_build_object(
              'label', 'Load document ' || value::text,
              'methodCode', case document_type
                when 'system:lnkConclusionVik' then 'ВИК'
                when 'system:lnkConclusionRk' then 'РК'
                when 'system:lnkConclusionUzk' then 'УЗК'
                when 'system:lnkConclusionPvk' then 'ПВК'
                when 'system:lnkConclusionOther' then 'МПК'
                when 'system:tvmtRequest' then 'ТВМТ'
                when 'system:tvmtConclusion' then 'ТВМТ'
                else ''
              end,
              'methodCodes', case document_type
                when 'system:lnkRequest' then '["ВИК","РК","УЗК","ПВК"]'::jsonb
                when 'system:lnkConclusionVik' then '["ВИК"]'::jsonb
                when 'system:lnkConclusionRk' then '["РК"]'::jsonb
                when 'system:lnkConclusionUzk' then '["УЗК"]'::jsonb
                when 'system:lnkConclusionPvk' then '["ПВК"]'::jsonb
                when 'system:lnkConclusionOther' then '["МПК"]'::jsonb
                when 'system:tvmtRequest' then '["ТВМТ"]'::jsonb
                when 'system:tvmtConclusion' then '["ТВМТ"]'::jsonb
                else '[]'::jsonb
              end,
              'positionCount', 8,
              'projects', jsonb_build_array('Project ' || lpad((((value - 1) % 20) + 1)::text, 2, '0')),
              'subtitleCodes', jsonb_build_array('LOAD-' || lpad((((value - 1) % 20) + 1)::text, 2, '0')),
              'lines', jsonb_build_array('LINE-' || lpad((((value - 1) % 10000) + 1)::text, 5, '0')),
              'periodFrom', document_date::text,
              'periodTo', document_date::text,
              'sourcePositions', '[]'::jsonb
            )::text
            else '{}'
          end
        from generated
      `, [totalRows])
      await client.query(`
        insert into generated_document_weld_joints (document_id, weld_joint_id)
        select
          ((weld.id - 1 + link_offset.value * greatest(($1::integer / 8), 1)) % $1::integer) + 1,
          weld.id
        from weld_joints
        as weld
        cross join generate_series(0, 7) as link_offset(value)
        on conflict do nothing
      `, [totalRows])
    })

    measurements.analyzeMs = await measureMs(async () => {
      await client.query('analyze')
    })

    const counts = await client.query<{
      documents: string
      document_templates: string
      duplicate_controls: string
      document_links: string
      pre_controls: string
      repeat_cycles: string
      weld_joints: string
      welder_stamps: string
    }>(`
      select
        (select count(*) from weld_joints) as weld_joints,
        (select count(*) from pre_heat_treatment_controls) as pre_controls,
        (select count(*) from psto_repeat_cycles) as repeat_cycles,
        (select count(*) from duplicate_controls) as duplicate_controls,
        (select count(*) from welder_stamps) as welder_stamps,
        (select count(*) from document_templates) as document_templates,
        (select count(*) from generated_documents) as documents,
        (select count(*) from generated_document_weld_joints) as document_links
    `)
    const size = await client.query<{ bytes: string; display: string }>(`
      select pg_database_size(current_database())::text as bytes,
             pg_size_pretty(pg_database_size(current_database())) as display
    `)
    console.log(JSON.stringify({
      database: LOAD_DATABASE_NAME,
      rowCount: totalRows,
      measurements,
      counts: counts.rows[0],
      databaseSize: size.rows[0],
    }, null, 2))
  } finally {
    await client.end()
  }
}

async function measureApplicationWorkflows({
  includeColdDispatcher,
}: {
  includeColdDispatcher: boolean
}) {
  const selectedScenarios = new Set(
    String(process.env.BENCHMARK_SCENARIO ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const databaseRequestCounter = await installDatabaseRequestCounter()
  const [
    { db },
    dispatcher,
    dispatcherStaging,
    weldRead,
    lnkWorkflow,
    pstoWorkflow,
    pstoSummary,
    systemDocumentSequences,
    systemDocumentIndex,
    systemDocumentTemplateTypes,
    generatedDocuments,
  ] = await Promise.all([
    import('../src/db/index.ts'),
    import('../src/server/dispatcher-task-index.ts'),
    import('../src/server/dispatcher-task-index-staging.ts'),
    import('../src/server/weld-read.ts'),
    import('../src/server/lnk-workflow-context.ts'),
    import('../src/server/psto-workflow-context.ts'),
    import('../src/server/psto-line-assignment-summary.ts'),
    import('../src/server/system-document-sequences.ts'),
    import('../src/server/system-document-index.ts'),
    import('../src/lib/system-document-template-types.ts'),
    import('../src/server/generated-documents.ts'),
  ])

  const results: Record<string, unknown> = {}
  const record = async <T>(name: string, work: () => Promise<T>) => {
    if (selectedScenarios.size > 0 && !selectedScenarios.has(name)) return
    const requestCountBefore = databaseRequestCounter.read()
    results[name] = {
      ...await measureResult(work),
      databaseRequests: databaseRequestCounter.read() - requestCountBefore,
    }
    console.log(JSON.stringify({ [name]: results[name] }, null, 2))
  }
  if (includeColdDispatcher) {
    await record('dispatcherCold', async () => {
      const snapshot = await dispatcher.getDispatcherTaskIndexSnapshot()
      return {
        repeatedTasks: snapshot.repeatedJointTasks.length,
        taskCodes: snapshot.taskFilterOptions.length,
        duplicateKeys: snapshot.duplicateKeys.length,
        welderTasks: snapshot.welderStampExpiryTasks.length,
      }
    })
  }
  await record('dispatcherCalculationCold', async () => {
    const calculation = await db.transaction((tx) => dispatcher.calculateFullDispatcherTasks(tx, {
      onProgress: (stage) => console.log(JSON.stringify({
        dispatcherStage: stage,
        heapMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
        rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      })),
    }))
    return {
      rows: calculation.preparedRows.length,
      repeatedTasks: calculation.tasks.repeatedJointTasks.length,
      repeatedTaskCount: calculation.repeatedJointTaskCount,
      repeatedTasksTruncated: calculation.repeatedJointTasksTruncated,
      welderTasks: calculation.tasks.welderStampExpiryTasks.length,
      chainContinuations: calculation.chainContinuations.length,
    }
  })
  await record('dispatcherTaskPageStageCold', async () => db.transaction(async (tx) => {
    await dispatcherStaging.createDispatcherTaskPageStage(tx)
    const writer = dispatcherStaging.createDispatcherTaskPageStageWriter(tx)
    const calculation = await dispatcher.calculateFullDispatcherTasks(tx, {
      onTaskPageRows: writer.append,
      onProgress: (stage) => console.log(JSON.stringify({
        dispatcherPageStage: stage,
        heapMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
        rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      })),
    })
    await writer.flush()
    const metrics = writer.getMetrics()
    if (metrics.taskCount !== calculation.repeatedJointTaskCount) {
      throw new Error('The staged dispatcher card count does not match the calculated task count.')
    }
    const size = await tx.execute<{ storedBytes: string | number }>(sql`
      select pg_total_relation_size('pg_temp.dispatcher_task_page_stage'::regclass) as "storedBytes"
    `)
    return {
      tasks: calculation.repeatedJointTaskCount,
      pages: metrics.pageCount,
      pageWriteRequests: metrics.insertRequestCount,
      stageStoredMb: Number((Number(size.rows[0]?.storedBytes) / 1024 / 1024).toFixed(1)),
    }
  }))
  await record('dispatcherIndexRefreshCold', async () => {
    await dispatcher.markDispatcherTaskIndexDirty()
    const state = await dispatcher.ensureDispatcherTaskIndexFresh()
    const payload = (await import('../src/lib/dispatcher-task-index-payload.ts'))
      .parseDispatcherTaskIndexPayload(state.repeatedTasks)
    return {
      sourceRevision: state.sourceRevision,
      computedRevision: state.computedRevision,
      snapshotTasks: payload.tasks.length,
      repeatedTaskCount: payload.totalTaskCount,
      tasksTruncated: payload.tasksTruncated,
    }
  })
  await record('dispatcherWarm', async () => {
    const snapshot = await dispatcher.getDispatcherTaskIndexSnapshot()
    return { repeatedTasks: snapshot.repeatedJointTasks.length }
  })
  await record('finalStatusContext', async () => {
    const keys = await weldRead.listWeldFinalStatusContextKeys()
    return { keys: keys.length }
  })
  await record('systemDocumentSequencesCold', async () => {
    const sequenceIds = systemDocumentTemplateTypes.SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map(
      (profile) => profile.id,
    )
    const sequences = await systemDocumentSequences.readSystemDocumentNextNumbers(db, sequenceIds)
    return { sequences: Object.keys(sequences).length }
  })
  await record('systemDocumentSequenceScanCold', async () => {
    const sequenceIds = systemDocumentTemplateTypes.SYSTEM_DOCUMENT_TEMPLATE_PROFILES.map(
      (profile) => profile.id,
    )
    const sequences = await systemDocumentSequences.readInitialSequenceNumbers(db, sequenceIds)
    return { sequences: Object.keys(sequences).length }
  })
  await record('systemDocumentIndexRebuildCold', async () => {
    const indexType = String(process.env.BENCHMARK_SYSTEM_DOCUMENT_TYPE ?? 'lnkRequest') as
      import('../src/lib/system-document-types.ts').SystemDocumentType
    let rebuilt = false
    try {
      await db.transaction(async (tx) => {
        await systemDocumentIndex.rebuildSystemDocumentIndexInTransaction(tx, indexType)
        rebuilt = true
        tx.rollback()
      })
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error
    }
    return { rebuilt, type: indexType }
  })
  await record('systemDocumentHistoryLnkRequest', async () => {
    const history = await systemDocumentIndex.loadIndexedSystemDocumentHistory({
      type: 'lnkRequest',
      limit: 100,
      columnFilters: {},
    })
    const serialized = JSON.stringify(history)
    return {
      documents: history.documents.length,
      total: history.total,
      filterOptions: Object.values(history.filterOptions).reduce(
        (sum, options) => sum + options.length,
        0,
      ),
      responseMb: Number((Buffer.byteLength(serialized) / 1024 / 1024).toFixed(1)),
    }
  })
  await record('systemDocumentHistoryLnkConclusion', async () => {
    const history = await systemDocumentIndex.loadIndexedSystemDocumentHistory({
      type: 'lnkConclusion',
      limit: 100,
      columnFilters: {},
    })
    return {
      documents: history.documents.length,
      total: history.total,
      filterOptions: Object.values(history.filterOptions).reduce(
        (sum, options) => sum + options.length,
        0,
      ),
    }
  })
  await record('systemDocumentHistoryLnkRequestLineOptions', async () => {
    const result = await systemDocumentIndex.loadIndexedSystemDocumentHistoryFilterOptions({
      type: 'lnkRequest',
      fieldKey: 'line',
      search: '',
      columnFilters: {},
    })
    return {
      options: result.options.length,
      hasMore: result.hasMore,
      responseKb: Number((Buffer.byteLength(JSON.stringify(result)) / 1024).toFixed(1)),
    }
  })
  await record('generatedDocumentHistoryWeldingJournal', async () => {
    const history = await generatedDocuments.loadRemoteGeneratedDocumentHistory({
      type: 'weldingJournal',
      types: ['weldingJournal'],
      limit: 100,
      columnFilters: {},
    })
    return {
      documents: history.documents.length,
      total: history.total,
      filterOptions: Object.values(history.filterOptions).reduce(
        (sum, options) => sum + options.length,
        0,
      ),
    }
  })
  await record('generatedDocumentHistoryWeldingJournalLineOptions', async () => {
    const result = await generatedDocuments.loadRemoteGeneratedDocumentHistoryFilterOptions({
      type: 'weldingJournal',
      types: ['weldingJournal'],
      fieldKey: 'line',
      search: '',
      columnFilters: {},
    })
    return {
      options: result.options.length,
      hasMore: result.hasMore,
      responseKb: Number((Buffer.byteLength(JSON.stringify(result)) / 1024).toFixed(1)),
    }
  })
  await record('journalFirstPage', async () => summarizePage(
    await weldRead.listWeldingJournalPage({ data: { page: 1, pageSize: 100 } }),
  ))
  await record('journalWarmPage', async () => summarizePage(
    await weldRead.listWeldingJournalPage({ data: { page: 1, pageSize: 100 } }),
  ))
  await record('journalLastPage', async () => summarizePage(
    await weldRead.listWeldingJournalPage({ data: { page: 5000, pageSize: 100 } }),
  ))
  await record('journalSearch', async () => summarizePage(
    await weldRead.listWeldingJournalPage({
      data: { page: 1, pageSize: 100, search: 'LINE-09999' },
    }),
  ))
  await record('lnkFirstPage', async () => summarizePage(
    await weldRead.listLnkReportPage({ data: { page: 1, pageSize: 100 } }),
  ))
  await record('pstoFirstPage', async () => summarizePage(
    await weldRead.listHeatTreatmentReportPage({ data: { page: 1, pageSize: 100 } }),
  ))
  await record('lineFilterOptions', async () => {
    const options = await weldRead.listWeldColumnFilterOptions({
      data: { report: 'weldingJournal', page: 1, pageSize: 100, fieldKey: 'line' },
    })
    return { options: options.length }
  })
  await record('finalStatusFilterOptions', async () => {
    const options = await weldRead.listWeldColumnFilterOptions({
      data: { report: 'weldingJournal', page: 1, pageSize: 100, fieldKey: 'finalStatus' },
    })
    return { options: options.length }
  })
  await record('formSuggestions', async () => {
    const suggestions = await weldRead.listWeldFormSuggestions({
      data: { fieldKey: 'line', draft: { projectTitle: 'Project 01', subtitleCode: 'LOAD-01' } },
    })
    return { suggestions: suggestions.length }
  })
  await record('lnkWorkflowSummary', async () => {
    const summary = await lnkWorkflow.getLnkWorkflowSummary()
    return {
      pendingResults: summary.pendingPrimaryResultRowCount,
      primaryResults: summary.primaryResultRowCount,
      preRequests: summary.preHeatTreatmentRequestRowCount,
      preResults: summary.preHeatTreatmentResultRowCount,
    }
  })
  await record('lnkWorkflowRequestSummary', async () => {
    const summary = await lnkWorkflow.getLnkWorkflowRequestSummary()
    return {
      requestNames: summary.requestNames.length,
      requestOptions: summary.requestOptions.length,
      hasMore: summary.hasMore,
    }
  })
  await record('lnkRequestRegistrySelected', async () => {
    const summary = await lnkWorkflow.getLnkWorkflowRequestSummary()
    const selected = summary.requestOptions[0]
    if (!selected) return { rows: 0, selected: null }
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'requestRegistry',
      rowIds: null,
      requestName: selected.name,
      requestDate: selected.date,
    })
    return { rows: rows.length, selected: selected.label }
  })
  await record('lnkRequestCandidates', async () => {
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'requestCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('lnkRequestCandidatesWithSelectedTail', async () => {
    const selectedRowId = rowCount
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'requestCandidates',
      rowIds: null,
      includeRowIds: [selectedRowId],
    })
    if (!rows.some((row) => row.id === selectedRowId)) {
      throw new Error(`LNK candidate page omitted selected row #${selectedRowId}.`)
    }
    return { rows: rows.length, selectedRowId }
  })
  await record('lnkResultCandidates', async () => {
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'resultCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('lnkOfficialityCandidates', async () => {
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'officialityCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('lnkPreHeatRequestCandidates', async () => {
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'preHeatTreatmentRequestCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('lnkPreHeatResultCandidates', async () => {
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'preHeatTreatmentResultCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('lnkResultRegistry', async () => {
    const rows = await lnkWorkflow.listLnkWorkflowRows({
      scope: 'resultRegistry',
      rowIds: null,
      limit: 500,
    })
    return { rows: rows.length }
  })
  await record('pstoWorkflowSummary', async () => {
    return pstoWorkflow.getPstoWorkflowSummary()
  })
  await record('pstoWorkflowRequestOptions', async () => {
    const result = await pstoWorkflow.getPstoWorkflowRequestOptions()
    return {
      options: result.options.length,
      hasMore: result.hasMore,
    }
  })
  await record('pstoRequestRegistrySelected', async () => {
    const options = await pstoWorkflow.getPstoWorkflowRequestOptions()
    const selected = options.options[0]
    if (!selected) return { rows: 0, selected: null }
    const rows = await pstoWorkflow.listPstoWorkflowRows({
      scope: 'requestRegistry',
      rowIds: null,
      requestName: selected.name,
      requestDate: selected.date,
    })
    return { rows: rows.length, selected: selected.label }
  })
  await record('pstoRequestCandidates', async () => {
    const rows = await pstoWorkflow.listPstoWorkflowRows({
      scope: 'requestCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('pstoRequestCandidatesWithSelectedTail', async () => {
    const selectedRowId = rowCount
    const rows = await pstoWorkflow.listPstoWorkflowRows({
      scope: 'requestCandidates',
      rowIds: null,
      includeRowIds: [selectedRowId],
    })
    if (!rows.some((row) => row.id === selectedRowId)) {
      throw new Error(`PSTO candidate page omitted selected row #${selectedRowId}.`)
    }
    return { rows: rows.length, selectedRowId }
  })
  await record('pstoResultCandidates', async () => {
    const rows = await pstoWorkflow.listPstoWorkflowRows({
      scope: 'resultCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('pstoTvmtRequestCandidates', async () => {
    const rows = await pstoWorkflow.listPstoWorkflowRows({
      scope: 'tvmtRequestCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('pstoTvmtResultCandidates', async () => {
    const rows = await pstoWorkflow.listPstoWorkflowRows({
      scope: 'tvmtResultCandidates',
      rowIds: null,
    })
    return { rows: rows.length }
  })
  await record('pstoResultRegistry', async () => {
    const rows = await pstoWorkflow.listPstoWorkflowRows({
      scope: 'resultRegistry',
      rowIds: null,
      limit: 500,
    })
    return { rows: rows.length }
  })
  await record('pstoLineSummaryPage', async () => {
    const page = await pstoSummary.loadPstoLineAssignmentSummaryPage(db, {
      page: 1,
      pageSize: 25,
    })
    return { lines: page.rows.length, total: page.totalCount }
  })
  await record('dataUsage', async () => {
    const usage = await weldRead.getWeldDataUsageSummary()
    return { rows: usage.rowsCount, weldingTypes: usage.weldingTypes.length }
  })
  await record('documentGenerationOneProject', async () => {
    const data = await weldRead.getDocumentGenerationData({
      data: { projects: ['Project 01'] },
    })
    return { rows: data.rows.length, lines: data.scopeOptions.lines.length }
  })
  await record('lnkContext', async () => {
    const rows = await weldRead.listWeldReportContextRows({ data: { report: 'lnk' } })
    return { rows: rows.length }
  })
  await record('pstoContext', async () => {
    const rows = await weldRead.listWeldReportContextRows({ data: { report: 'heatTreatment' } })
    return { rows: rows.length }
  })
  if (selectedScenarios.has('reportOutputGuardLnk200k')) await record('reportOutputGuardLnk200k', async () => {
    try {
      await weldRead.listWeldReportContextRows({ data: { report: 'lnk' } })
    } catch (error) {
      if (error instanceof Error && error.message.includes('более 10 000 строк')) return { blocked: true }
      throw error
    }
    throw new Error('The LNK output unexpectedly bypassed the large-report safety limit.')
  })
  if (selectedScenarios.has('reportOutputGuardPsto200k')) await record('reportOutputGuardPsto200k', async () => {
    try {
      await weldRead.listWeldReportContextRows({ data: { report: 'heatTreatment' } })
    } catch (error) {
      if (error instanceof Error && error.message.includes('более 10 000 строк')) return { blocked: true }
      throw error
    }
    throw new Error('The PSTO output unexpectedly bypassed the large-report safety limit.')
  })

  if (selectedScenarios.size === 0) console.log(JSON.stringify({ complete: results }, null, 2))
}

async function installDatabaseRequestCounter() {
  const pgModule = await import('pg')
  const clientPrototype = pgModule.Client.prototype as unknown as {
    query: (...args: unknown[]) => unknown
  }
  const originalQuery = clientPrototype.query
  let count = 0
  clientPrototype.query = function countedQuery(this: unknown, ...args: unknown[]) {
    count += 1
    return originalQuery.apply(this, args)
  }
  return { read: () => count }
}

function buildWeldJointSeedSql() {
  return `
    insert into weld_joints (
      weld_date, project_title, subtitle_code, line, group_name, category,
      psto_required, psto_control_basis, psto_cancellation_date,
      weld_control_percent, isometry, sheet, revision_number, joint, spool, spool_id,
      officiality, revision_actuality, material_unique_number_1, material_unique_number_2,
      element_1, element_2, material_id_1, material_id_2, material_1, material_2,
      welding_method, connection_type, material_group, d1, d2, t1, t2, wdi,
      responsible, technology_card_number, welding_electrodes,
      welding_electrodes_certificate_number, stamp_1_k, stamp_1_k_fact,
      has_vik, has_rk, has_uzk, has_pvk, has_tvmt,
      vik_control_basis, rk_control_basis, uzk_control_basis, pvk_control_basis, tvmt_control_basis,
      vik_request, vik_request_date, vik_result, vik_conclusion_date, vik_conclusion, vik_defect_description,
      rk_request, rk_request_date, rk_result, rk_conclusion_date, rk_conclusion,
      uzk_request, uzk_request_date, uzk_result, uzk_conclusion_date, uzk_conclusion, uzk_defect_description,
      pvk_request, pvk_request_date, pvk_result, pvk_conclusion_date, pvk_conclusion, pvk_defect_description,
      psto_request, psto_request_date, psto_date, heat_treatment_diagram, psto_result,
      tvmt_request, tvmt_request_date, tvmt_result, tvmt_conclusion_date, tvmt_conclusion,
      final_status, test_types, test_contour, test_date, lnk_defect_description,
      created_at, welding_updated_at, psto_created_at, psto_updated_at, lnk_created_at, lnk_updated_at
    )
    select
      base.weld_date,
      'Project ' || lpad(base.project_no::text, 2, '0'),
      'LOAD-' || lpad(base.project_no::text, 2, '0'),
      'LINE-' || lpad(base.line_no::text, 5, '0'),
      'GROUP-' || ((base.line_no - 1) % 20 + 1)::text,
      case when base.line_no % 3 = 0 then 'I' when base.line_no % 3 = 1 then 'II' else 'III' end,
      case when base.sequence % 10 < 3 then 'да' when base.sequence % 40 = 3 then 'отменен' else null end,
      case when base.sequence % 10 < 3 then 'Требование проекта' else null end,
      case when base.sequence % 40 = 3 then base.weld_date + 1 else null end,
      case when base.line_no % 4 = 0 then 100 when base.line_no % 4 = 1 then 50 else 25 end,
      'ISO-' || lpad(base.line_no::text, 5, '0'),
      ((base.line_no - 1) % 10) + 1,
      0,
      'J' || lpad(base.joint_no::text, 3, '0'),
      'SP-' || lpad((((base.joint_no - 1) / 10) + 1)::text, 2, '0'),
      'SPID-' || base.line_no::text || '-' || (((base.joint_no - 1) / 10) + 1)::text,
      case when base.sequence % 25 = 0 then 'неофициальный' else null end,
      'актуален',
      'MAT-' || base.sequence::text || '-1',
      'MAT-' || base.sequence::text || '-2',
      'Труба', 'Фитинг', 'STEEL-20', 'STEEL-20', 'Сталь 20', 'Сталь 20',
      case when base.sequence % 5 = 0 then 'РАД+РД' else 'РД' end,
      case when base.sequence % 7 = 0 then 'УШ' else 'СШ' end,
      'M01', 159, 159, 8, 8, 1.25,
      'Responsible ' || base.project_no::text,
      'TC-' || ((base.line_no - 1) % 50 + 1)::text,
      'E50A', 'CERT-' || ((base.sequence - 1) % 500 + 1)::text,
      'ST-' || lpad(((base.sequence - 1) % 2000 + 1)::text, 4, '0'),
      case when base.sequence % 211 = 0 then null else 'ST-' || lpad(((base.sequence - 1) % 2000 + 1)::text, 4, '0') end,
      'да',
      case when base.has_rk then 'да' else null end,
      case when base.has_uzk then 'да' else null end,
      case when base.has_pvk then 'да' else null end,
      case when base.sequence % 10 < 3 then 'да' else null end,
      '100%',
      case when base.has_rk then '50%' else null end,
      case when base.has_uzk then '20%' else null end,
      case when base.has_pvk then '10%' else null end,
      case when base.sequence % 10 < 3 then 'ПСТО' else null end,
      case when base.workflow_ready and base.sequence % 113 <> 0 then 'VIK-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.sequence % 113 <> 0 then base.weld_date + 5 else null end,
      case when base.workflow_ready and base.sequence % 113 <> 0 then case when base.sequence % 200 = 0 then 'ремонт' else 'годен' end else null end,
      case when base.workflow_ready and base.sequence % 113 <> 0 then base.weld_date + 6 else null end,
      case when base.workflow_ready and base.sequence % 113 <> 0 then 'VIK-C-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.sequence % 113 <> 0 then case when base.sequence % 200 = 0 then 'Непровар' else 'ДНО' end else null end,
      case when base.workflow_ready and base.has_rk and base.sequence % 127 <> 0 then 'RK-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.has_rk and base.sequence % 127 <> 0 then base.weld_date + 5 else null end,
      case when base.workflow_ready and base.has_rk and base.sequence % 127 <> 0 then 'годен' else null end,
      case when base.workflow_ready and base.has_rk and base.sequence % 127 <> 0 then base.weld_date + 6 else null end,
      case when base.workflow_ready and base.has_rk and base.sequence % 127 <> 0 then 'RK-C-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.has_uzk and base.sequence % 131 <> 0 then 'UZK-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.has_uzk and base.sequence % 131 <> 0 then base.weld_date + 5 else null end,
      case when base.workflow_ready and base.has_uzk and base.sequence % 131 <> 0 then 'годен' else null end,
      case when base.workflow_ready and base.has_uzk and base.sequence % 131 <> 0 then base.weld_date + 6 else null end,
      case when base.workflow_ready and base.has_uzk and base.sequence % 131 <> 0 then 'UZK-C-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.has_uzk and base.sequence % 131 <> 0 then 'ДНО' else null end,
      case when base.workflow_ready and base.has_pvk and base.sequence % 137 <> 0 then 'PVK-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.has_pvk and base.sequence % 137 <> 0 then base.weld_date + 5 else null end,
      case when base.workflow_ready and base.has_pvk and base.sequence % 137 <> 0 then 'годен' else null end,
      case when base.workflow_ready and base.has_pvk and base.sequence % 137 <> 0 then base.weld_date + 6 else null end,
      case when base.workflow_ready and base.has_pvk and base.sequence % 137 <> 0 then 'PVK-C-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.has_pvk and base.sequence % 137 <> 0 then 'ДНО' else null end,
      case when base.sequence % 10 < 2 then 'PSTO-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.sequence % 10 < 2 then base.weld_date + 3 else null end,
      case when base.sequence % 10 < 2 then base.weld_date + 4 else null end,
      case when base.sequence % 10 < 2 then 'D-' || base.sequence::text else null end,
      case when base.sequence % 10 < 2 then 'проведено' else null end,
      case when base.sequence % 10 < 2 then 'TVMT-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.sequence % 10 < 2 then base.weld_date + 4 else null end,
      case when base.sequence % 10 < 2 then 'годен' else null end,
      case when base.sequence % 10 < 2 then base.weld_date + 4 else null end,
      case when base.sequence % 10 < 2 then 'TVMT-C-' || ((base.sequence - 1) / 50 + 1)::text else null end,
      case when base.workflow_ready and base.sequence % 113 <> 0 and base.sequence % 200 <> 0 then 'годен' else 'ожидает НК' end,
      case when base.sequence % 3 = 0 then 'ГИ, ПИ' else 'ГИ' end,
      'Контур ' || ((base.line_no - 1) % 30 + 1)::text,
      base.weld_date + 10,
      case when base.sequence % 200 = 0 then 'Непровар' else null end,
      timestamp '2025-01-01 08:00:00+03' + (base.sequence * interval '1 second'),
      now(),
      case when base.sequence % 10 < 3 then now() else null end,
      case when base.sequence % 10 < 3 then now() else null end,
      now(), now()
    from (
      select
        generated.value as sequence,
        ((generated.value - 1) / 50) + 1 as line_no,
        ((generated.value - 1) % 50) + 1 as joint_no,
        ((((generated.value - 1) / 50) % 20) + 1) as project_no,
        date '2025-01-01' + ((generated.value - 1) % 600)::integer as weld_date,
        (generated.value % 10 >= 3 or generated.value % 10 < 2) as workflow_ready,
        (generated.value % 4 in (0, 1, 3)) as has_rk,
        (generated.value % 4 in (1, 2, 3)) as has_uzk,
        (generated.value % 4 in (2, 3)) as has_pvk
      from generate_series(1, $1::integer) as generated(value)
    ) as base
  `
}

async function measureResult<T>(work: () => Promise<T>) {
  const beforeMemory = process.memoryUsage().heapUsed
  const startedAt = performance.now()
  const value = await work()
  const elapsedMs = performance.now() - startedAt
  const afterMemory = process.memoryUsage().heapUsed
  return {
    ms: Math.round(elapsedMs),
    heapDeltaMb: Number(((afterMemory - beforeMemory) / 1024 / 1024).toFixed(1)),
    value,
  }
}

async function measureMs(work: () => Promise<void>) {
  const startedAt = performance.now()
  await work()
  return Math.round(performance.now() - startedAt)
}

function summarizePage(page: {
  acceptedWdiTotal?: number
  hasMore: boolean
  rows: unknown[]
  total?: number
}) {
  return {
    rows: page.rows.length,
    total: page.total ?? null,
    hasMore: page.hasMore,
    ...(page.acceptedWdiTotal === undefined ? {} : { acceptedWdiTotal: page.acceptedWdiTotal }),
  }
}

function readPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`Expected an integer from 1 to ${maximum}, received: ${value}`)
  }
  return parsed
}
