import { performance } from 'node:perf_hooks'

import { sql } from 'drizzle-orm'

import { db } from '../src/db/index.ts'
import { weldJoints } from '../src/db/schema.ts'
import {
  buildReportKindWhere,
  getReportContextSelect,
  getReportOrderBy,
} from '../src/server/weld-read.ts'
import { LNK_OFFICIALITY_CHAIN_SELECT } from '../src/server/lnk-officiality-workflow.ts'
import {
  buildLnkWorkflowRequestSummaryQuery,
  buildLnkWorkflowRowsWhere,
  LNK_WORKFLOW_ROW_SELECT,
} from '../src/server/lnk-workflow-context.ts'
import { WELD_TABLE_RETURNING } from '../src/server/weld-server-shared.ts'

const DEFAULT_ROW_COUNT = 50_000
const DEFAULT_BIG_LINE_SIZE = 5_000
const MAX_ROW_COUNT = 200_000
const MAX_BIG_LINE_SIZE = 50_000
const BENCHMARK_WELD_ID_BASE = -1_700_000_000

const rowCount = readPositiveInteger(process.argv[2], DEFAULT_ROW_COUNT, MAX_ROW_COUNT)
const bigLineSize = Math.min(
  rowCount,
  readPositiveInteger(process.argv[3], DEFAULT_BIG_LINE_SIZE, MAX_BIG_LINE_SIZE),
)
const connectionUrl = new URL(process.env.DATABASE_URL ?? '')
if (!new Set(['localhost', '127.0.0.1', '[::1]']).has(connectionUrl.hostname)) {
  throw new Error('LNK benchmark can run only against a local PostgreSQL database.')
}

const benchmarkProject = `__lnk_benchmark_${process.pid}_${Date.now()}`
const benchmarkSubtitle = 'BENCHMARK-LNK'
const bigLine = 'HOT-LINE-1'
const rollbackMarker = new Error('LNK benchmark rollback')
let output: unknown

try {
  await db.transaction(async (tx) => {
    const insert = await measure('seedRows', async () => {
      await tx.execute(sql`
        insert into ${weldJoints} (
          "id",
          "weld_date",
          "project_title",
          "subtitle_code",
          "line",
          "spool",
          "joint",
          "welding_method",
          "connection_type",
          "material_group",
          "d1",
          "d2",
          "t1",
          "t2",
          "wdi",
          "officiality",
          "psto_required",
          "psto_date",
          "psto_result",
          "has_vik",
          "has_rk",
          "has_uzk",
          "has_pvk",
          "vik_request",
          "vik_request_date",
          "vik_result",
          "vik_conclusion_date",
          "vik_conclusion",
          "rk_request",
          "rk_request_date",
          "rk_result",
          "rk_conclusion_date",
          "rk_conclusion",
          "uzk_request",
          "uzk_request_date",
          "uzk_result",
          "uzk_conclusion_date",
          "uzk_conclusion",
          "pvk_request",
          "pvk_request_date",
          "pvk_result",
          "pvk_conclusion_date",
          "pvk_conclusion",
          "final_status",
          "lnk_created_at",
          "lnk_updated_at"
        )
        select
          ${BENCHMARK_WELD_ID_BASE} + generated.value,
          date '2026-01-01' + ((generated.value % 240)::integer),
          ${benchmarkProject},
          ${benchmarkSubtitle},
          case
            when generated.value <= ${bigLineSize} then ${bigLine}
            when generated.value <= (${bigLineSize} * 2) then 'HOT-LINE-2'
            else 'LINE-' || lpad((((generated.value - (${bigLineSize} * 2) - 1) / 100) + 1)::text, 5, '0')
          end,
          'SP-' || lpad((generated.value % 500)::text, 3, '0'),
          'S' || generated.value::text,
          'РД',
          'СШ',
          'M01',
          108,
          case when generated.value % 20 = 0 then 57 else 108 end,
          4,
          4,
          0.42,
          case when generated.value % 37 = 0 then 'неофициальный' else null end,
          case when generated.value % 5 = 0 then 'да' else null end,
          case when generated.value % 5 = 0 then date '2026-09-01' else null end,
          case when generated.value % 5 = 0 then 'проведено' else null end,
          'да',
          case when generated.value % 2 = 0 then 'да' else null end,
          case when generated.value % 3 = 0 then 'да' else null end,
          case when generated.value % 7 = 0 then 'да' else null end,
          case when generated.value % 10 = 1 then null else 'VIK-' || ((generated.value - 1) / 25)::integer end,
          case when generated.value % 10 = 1 then null else date '2026-08-01' end,
          case
            when generated.value % 10 = 1 then null
            when generated.value % 11 = 0 then 'ремонт'
            when generated.value % 29 = 0 then 'вырез'
            when generated.value % 4 = 0 then 'годен'
            else null
          end,
          case when generated.value % 10 <> 1 and generated.value % 4 = 0 then date '2026-08-03' else null end,
          case when generated.value % 10 <> 1 and generated.value % 4 = 0 then 'VIK-C-' || generated.value::text else null end,
          case when generated.value % 2 = 0 then 'RK-' || ((generated.value - 1) / 50)::integer else null end,
          case when generated.value % 2 = 0 then date '2026-08-02' else null end,
          case when generated.value % 13 = 0 then 'ремонт' when generated.value % 31 = 0 then 'вырез' when generated.value % 6 = 0 then 'годен' else null end,
          case when generated.value % 6 = 0 then date '2026-08-04' else null end,
          case when generated.value % 6 = 0 then 'RK-C-' || generated.value::text else null end,
          case when generated.value % 3 = 0 then 'UZK-' || ((generated.value - 1) / 75)::integer else null end,
          case when generated.value % 3 = 0 then date '2026-08-02' else null end,
          case when generated.value % 17 = 0 then 'ремонт' when generated.value % 41 = 0 then 'вырез' when generated.value % 9 = 0 then 'годен' else null end,
          case when generated.value % 9 = 0 then date '2026-08-05' else null end,
          case when generated.value % 9 = 0 then 'UZK-C-' || generated.value::text else null end,
          case when generated.value % 7 = 0 then 'PVK-' || ((generated.value - 1) / 125)::integer else null end,
          case when generated.value % 7 = 0 then date '2026-08-02' else null end,
          case when generated.value % 19 = 0 then 'ремонт' when generated.value % 43 = 0 then 'вырез' when generated.value % 14 = 0 then 'годен' else null end,
          case when generated.value % 14 = 0 then date '2026-08-06' else null end,
          case when generated.value % 14 = 0 then 'PVK-C-' || generated.value::text else null end,
          case when generated.value % 11 = 0 or generated.value % 13 = 0 or generated.value % 17 = 0 or generated.value % 19 = 0 then 'не годен' else 'ожидает НК' end,
          now(),
          now()
        from generate_series(1, ${rowCount}::integer) as generated(value)
      `)
    })
    const analyze = await measure('analyze', async () => {
      await tx.execute(sql`analyze ${weldJoints}`)
    })

    const lnkContext = await measureRows('lnkFullContext', async () =>
      tx
        .select(getReportContextSelect('lnk'))
        .from(weldJoints)
        .where(sql`${buildReportKindWhere('lnk')} and ${weldJoints.projectTitle} = ${benchmarkProject}`)
        .orderBy(...getReportOrderBy('lnk')),
    )
    const requestCandidates = await measureRows('lnkRequestModalCandidates', async () =>
      tx
        .select(LNK_WORKFLOW_ROW_SELECT)
        .from(weldJoints)
        .where(sql`
          ${buildLnkWorkflowRowsWhere({ scope: 'requestCandidates' })}
          and ${weldJoints.projectTitle} = ${benchmarkProject}
        `)
        .orderBy(...getReportOrderBy('lnk')),
    )
    const resultCandidates = await measureRows('lnkResultModalCandidates', async () =>
      tx
        .select(LNK_WORKFLOW_ROW_SELECT)
        .from(weldJoints)
        .where(sql`
          ${buildLnkWorkflowRowsWhere({ scope: 'resultCandidates' })}
          and ${weldJoints.projectTitle} = ${benchmarkProject}
        `)
        .orderBy(...getReportOrderBy('lnk')),
    )
    const resultRegistry = await measureRows('lnkResultRegistryRows', async () =>
      tx
        .select(LNK_WORKFLOW_ROW_SELECT)
        .from(weldJoints)
        .where(sql`
          ${buildLnkWorkflowRowsWhere({ scope: 'resultRegistry' })}
          and ${weldJoints.projectTitle} = ${benchmarkProject}
        `)
        .orderBy(...getReportOrderBy('lnk')),
    )
    const workflowSummary = await measureRows('lnkWorkflowSummary', async () => {
      const result = await tx.execute(buildLnkWorkflowRequestSummaryQuery(
        sql`${weldJoints.projectTitle} = ${benchmarkProject}`,
      ))
      return result.rows
    })
    const officialityFullLine = await measureRows('officialityFullLine', async () =>
      tx
        .select(WELD_TABLE_RETURNING)
        .from(weldJoints)
        .where(sql`
          lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = lower(btrim(${benchmarkProject}))
          and lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = lower(btrim(${benchmarkSubtitle}))
          and lower(btrim(coalesce(${weldJoints.line}, ''))) = lower(btrim(${bigLine}))
        `),
    )
    const officialityChainLine = await measureRows('officialityChainLine', async () =>
      tx
        .select(LNK_OFFICIALITY_CHAIN_SELECT)
        .from(weldJoints)
        .where(sql`
          lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = lower(btrim(${benchmarkProject}))
          and lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = lower(btrim(${benchmarkSubtitle}))
          and lower(btrim(coalesce(${weldJoints.line}, ''))) = lower(btrim(${bigLine}))
        `),
    )
    const explain = await tx.execute(sql`
      explain (analyze, buffers, format json)
      select "id"
      from ${weldJoints}
      where lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = lower(btrim(${benchmarkProject}))
        and lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = lower(btrim(${benchmarkSubtitle}))
        and lower(btrim(coalesce(${weldJoints.line}, ''))) = lower(btrim(${bigLine}))
    `)

    output = {
      rowCount,
      bigLineSize,
      insert,
      analyze,
      lnkContext,
      requestCandidates,
      resultCandidates,
      resultRegistry,
      workflowSummary,
      requestModalBytesRatio: lnkContext.bytes > 0
        ? Number((requestCandidates.bytes / lnkContext.bytes).toFixed(3))
        : null,
      resultModalBytesRatio: lnkContext.bytes > 0
        ? Number((resultCandidates.bytes / lnkContext.bytes).toFixed(3))
        : null,
      resultRegistryBytesRatio: lnkContext.bytes > 0
        ? Number((resultRegistry.bytes / lnkContext.bytes).toFixed(3))
        : null,
      summaryBytesRatio: lnkContext.bytes > 0
        ? Number((workflowSummary.bytes / lnkContext.bytes).toFixed(3))
        : null,
      officialityFullLine,
      officialityChainLine,
      officialityBytesRatio: officialityFullLine.bytes > 0
        ? Number((officialityChainLine.bytes / officialityFullLine.bytes).toFixed(3))
        : null,
      normalizedLineExplain: explain.rows[0]?.['QUERY PLAN'] ?? explain.rows[0],
    }
    throw rollbackMarker
  })
} catch (error) {
  if (error !== rollbackMarker) throw error
} finally {
  await db.execute(sql`analyze ${weldJoints}`)
}

console.log(JSON.stringify(output, null, 2))

async function measure<T>(name: string, run: () => Promise<T>) {
  const startedAt = performance.now()
  await run()
  return { name, ms: Math.round(performance.now() - startedAt) }
}

async function measureRows<T>(name: string, run: () => Promise<T[]>) {
  const startedAt = performance.now()
  const rows = await run()
  const payload = JSON.stringify(rows)
  return {
    name,
    ms: Math.round(performance.now() - startedAt),
    rows: rows.length,
    bytes: Buffer.byteLength(payload),
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
