import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/node-postgres'
import { invalidateDerivedCalculationCache } from '../../src/server/dispatcher-task-index-dirty'
import type { JournalGridRequest, JournalGridResult, JournalRevision } from '../../src/lib/journal-server-grid'
import type { JournalFilterPage } from '../../src/lib/journal-filter-options'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { splitReportQuickSearch } from '../../src/lib/report-quick-search'
import type { WeldReportKind, WeldReportSummaryResult } from '../../src/server/weld-contracts'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { runDeepFilterGroupSqlExperiment } from '../deep-filter-group-sql'

const groupRepro = process.env.DEEP_FILTER_HTTP_GROUP_REPRO === '1'
const groupSql = process.env.DEEP_FILTER_HTTP_GROUP_SQL === '1'
// Keep the old coalesce-index protocol reproducible against saved bundles.
// The current literal-PgText build must opt into its distinct raw-GIN protocol.
const indexProfile = process.env.DEEP_FILTER_HTTP_INDEX_PROFILE ?? 'coalesce-v1'
const enabled = process.env.DEEP_FILTER_HTTP === '1' || groupRepro || groupSql
test.skip(!enabled, 'Serial HTTP read experiment; temporary committed indexes only on the owned disposable database')
test.use({ trace: 'off', video: 'off' })
const sizes = groupRepro || groupSql ? [200000] : process.env.DEEP_FILTER_HTTP_ROWS ? [Number(process.env.DEEP_FILTER_HTTP_ROWS)] : [9000, 200000]
const projectCounts = groupRepro || groupSql ? [40] : process.env.DEEP_FILTER_HTTP_PROJECTS ? [Number(process.env.DEEP_FILTER_HTTP_PROJECTS)] : [4, 40]
const reports: WeldReportKind[] = ['weldingJournal', 'lnk', 'heatTreatment']
const marker = 'E2E-DEEP-HTTP'
const indexedFields = ['project_title', 'subtitle_code', 'line', 'joint'] as const
const indexNames = indexedFields.flatMap(field => [`e2e_deep_http_${field}_trgm`, `e2e_deep_http_${field}_raw_trgm`, `e2e_deep_http_${field}_choice`])
type Phase = 'baseline' | 'coalesce-gin' | 'raw-gin' | 'choice-btree'
type Fact = { id: number; projectTitle: string; subtitleCode: string; line: string; joint: string; weldDate: string; finalStatus: string }
type Field = Exclude<keyof Fact, 'id'>
type Case = { name: string; filters: Record<string, string>; matches: (row: Fact) => boolean }
const pad = (n: number, length: number) => String(n).padStart(length, '0')
const projectName = (n: number) => `${marker}-PROJECT-${pad(n, 3)}`
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function cases(): Case[] {
  const fragment = (name: string, field: Field, value: string): Case => ({ name, filters: { [field]: value },
    matches: row => row[field].toLowerCase().includes(value.toLowerCase()) })
  return [
    fragment('project-selective', 'projectTitle', 'PROJECT-000'),
    fragment('subtitle-selective', 'subtitleCode', 'CODE-017'),
    fragment('line-selective', 'line', 'LINE-0017'),
    fragment('joint-selective', 'joint', '0000123'),
    fragment('project-wide', 'projectTitle', marker),
    fragment('subtitle-wide', 'subtitleCode', 'CODE-0'),
    fragment('line-wide', 'line', 'LINE-0'),
    fragment('joint-wide', 'joint', 'F000'),
    ...['7', '37', '237'].map(value => fragment(`joint-${value.length}-characters`, 'joint', value)),
    fragment('date-control', 'weldDate', '2026-10-03'),
    fragment('status-control', 'finalStatus', 'годен'),
    { name: 'combined', filters: { subtitleCode: 'CODE-017', line: 'LINE-0' },
      matches: row => row.subtitleCode.includes('CODE-017') && row.line.includes('LINE-0') },
    { name: 'quick-control', filters: { search: 'F0000123' }, matches: row => row.joint === 'F0000123' },
  ]
}

// Plain, independently defined fixture order: every created/profile timestamp
// is identical, and padded line/joint names have the same lexical/natural order.
function ordered(rows: Fact[], report: WeldReportKind) {
  return rows.slice().sort((a, b) => (report === 'weldingJournal' ? b.weldDate.localeCompare(a.weldDate) : 0)
    || a.line.localeCompare(b.line) || a.joint.localeCompare(b.joint) || a.id - b.id)
}

for (const total of sizes) for (const projectCount of projectCounts) {
  test(`${total} welds / ${projectCount} projects: ${groupSql ? 'captured PSTO member SQL alternatives' : groupRepro ? 'isolated PSTO group member-query diagnostics' : 'expression indexes through real report HTTP paths'}`, async ({ page }, info) => {
    test.setTimeout(2_400_000)
    expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
    expect(groupRepro && groupSql, 'Choose SQL alternatives or the unchanged HTTP timeout repro, not both').toBe(false)
    expect(['coalesce-v1', 'raw-v2'], 'Explicit index protocol; never silently change historical GIN semantics').toContain(indexProfile)
    if (groupRepro) expect(process.env.DEEP_FILTER_HTTP, 'Enable the matching isolated audit-wrapper guard').toBe('1')
    expect([9000, 200000]).toContain(total)
    expect([4, 40]).toContain(projectCount)
    const projects = Array.from({ length: projectCount }, (_, n) => projectName(n))
    const samples: object[] = [], phases: object[] = [], equivalence = new Map<string, string>()
    let previousOther: string | undefined, seeded = false, ownedExtension = false, verifiedFixture = false
    let observed = '', environment: unknown, factSignature: unknown, fixtureDiagnostic: unknown, groupSqlDiagnostic: unknown
    const save = () => writeFile(info.outputPath(`deep-filter-http-${total}-${projectCount}.json`), JSON.stringify({
      total, projectCount, environment, factSignature, fixtureDiagnostic, groupRepro, groupSql, groupSqlDiagnostic,
      indexProtocol: groupRepro || groupSql ? null : { profile: indexProfile,
        bundleLabel: process.env.DEEP_FILTER_HTTP_LABEL ?? 'unlabelled',
        ginExpression: indexProfile === 'raw-v2' ? 'physical text column gin_trgm_ops' : "coalesce(physical text column, '') gin_trgm_ops",
        phaseCount: 3, rounds: 3 },
      limits: 'HTTP read paths only. Cold derived-cache revisions are fixture preparation, not a user save; original dispatcher freshness checks remain active. DDL/build/ANALYZE and correctness checks are outside timings. SQL details are per phase, not per request.',
      ...(groupRepro ? { diagnosticLimits: 'Fresh 200k/40 logical fixture; no preceding 9k test or 225 HTTP steps. The audit wrapper includes same-connection EXPLAIN without ANALYZE before the unchanged member SELECT, so these durations are diagnostics, not acceptance performance measurements. Observer samples only the captured backend PID in the disposable current_database every 5 seconds.' } : {}),
      phases, samples,
    }, null, 2))
    const querySignature = () => withE2eDatabase(async db => (await db.query(`select count(*)::int as rows,
      min(id)::int as min_id,max(id)::int as max_id,
      md5(string_agg(row(id,project_title,subtitle_code,line,joint,weld_date,final_status,wdi,has_vik,vik_result,psto_required,psto_result,tvmt_result)::text,',' order by id)) as facts
      from weld_joints where project_title=any($1::text[])`, [projects])).rows[0])
    try {
      await withE2eDatabase(async db => {
        const seed = (await db.query('select id,project_title,subtitle_code,line,joint from weld_joints')).rows
        expect(seed).toHaveLength(1)
        expect(seed[0]).toMatchObject({ project_title: 'E2E проект', subtitle_code: 'E2E-001', line: 'E2E-L1', joint: 'F1' })
        expect((await db.query('select indexname from pg_indexes where indexname=any($1::text[])', [indexNames])).rows).toEqual([])
        const extension = (await db.query("select name,default_version,installed_version from pg_available_extensions where name='pg_trgm'")).rows
        expect(extension).toHaveLength(1)
        environment = { ...(await db.query(`select current_database() as database,version(),current_setting('work_mem') as work_mem,
          current_setting('gin_pending_list_limit') as gin_pending_list_limit`)).rows[0], extension }
        verifiedFixture = true
        if (!extension[0].installed_version) {
          await db.query('create extension pg_trgm')
          ownedExtension = true
        }
      })
      await withLineProgramFixture(async db => {
        previousOther = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
        await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}')
          on conflict(key) do update set value=excluded.value`)
        await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi,officiality,revision_actuality,
          connection_type,d1,t1,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
          psto_required,psto_request,psto_request_date,psto_date,psto_result,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date,final_status,
          created_at,lnk_created_at,psto_created_at)
          select $1||'-PROJECT-'||lpad(((n-1)%$3)::text,3,'0'),
            'CODE-'||lpad((((n-1)/$3)%400)::text,3,'0'),
            'LINE-'||lpad((((n-1)/7)%2000)::text,4,'0'),'F'||lpad(n::text,7,'0'),
            date '2026-10-01'+((n-1)%20),1,'действующий','актуальная','С17',108,4,
            'да','VIK-DEEP-HTTP',date '2026-10-21','годен','VIK-CONCLUSION-DEEP-HTTP',date '2026-10-22',
            'да','PSTO-DEEP-HTTP',date '2026-10-21',date '2026-10-22','проведено',
            'TVMT-DEEP-HTTP',date '2026-10-23','годен','TVMT-CONCLUSION-DEEP-HTTP',date '2026-10-24','годен',
            timestamp with time zone '2026-10-20 12:00:00+00',timestamp with time zone '2026-10-20 12:00:00+00',timestamp with time zone '2026-10-20 12:00:00+00'
          from generate_series(1,$2::int) n`, [marker, total, projectCount])
        await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
          select id,'primary',id from weld_joints where project_title=any($1::text[])`, [projects])
        // The default process requires VIK before heat treatment as well as
        // the main VIK result. A completed PSTO/TVMT history alone does not
        // remove that debt. Supply the required stage; keep the rule enabled.
        await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
          select id,'ВИК','PRE-VIK-DEEP-HTTP',date '2026-10-20','годен','PRE-VIK-CONCLUSION-DEEP-HTTP',date '2026-10-20'
          from weld_joints where project_title=any($1::text[])`, [projects])
        for (const table of ['weld_joints', 'weld_joint_program_states', 'pre_heat_treatment_controls']) await db.query(`analyze ${table}`)
      })
      seeded = true
      page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
      await page.goto('/journal')
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(marker)
      await expect(page.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible({ timeout: 300000 })
      await page.waitForLoadState('networkidle')
      expect(observed).not.toBe('')
      // Stop page polling/background report reads while retaining authenticated
      // browser-context HTTP access to the actual production server functions.
      await page.goto('about:blank')
      const call = async <T,>(name: string, data: unknown): Promise<T> => {
        const response = await page.request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
          data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin',
            'content-type': 'application/json', 'x-tsr-serverFn': 'true' }, timeout: 240000,
        })
        expect(response.ok(), name).toBe(true)
        const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
        if (payload.error) throw payload.error
        return payload.result
      }
      const measured = async <T,>(phase: Phase, round: number, report: WeldReportKind, name: string, rpc: string, data: unknown) => {
        const start = performance.now(), result = await call<T>(rpc, data), milliseconds = performance.now() - start
        samples.push({ phase, round, report, name, rpc, milliseconds, request: data })
        return result
      }
      const compare = (key: string, value: unknown) => {
        const signature = digest(value), first = equivalence.get(key)
        if (first === undefined) equivalence.set(key, signature)
        else expect(signature, `same business response: ${key}`).toBe(first)
      }
      factSignature = await querySignature()
      const { min_id: minId, max_id: maxId, rows: rowCount } = factSignature as { min_id: number; max_id: number; rows: number }
      expect(rowCount).toBe(total)
      expect(maxId - minId + 1).toBe(total)
      await withE2eDatabase(async db => {
        fixtureDiagnostic = {
          statuses: (await db.query(`select final_status,count(*)::int as rows from weld_joints
            where project_title=any($1::text[]) group by final_status order by final_status`, [projects])).rows,
          firstBadJoints: (await db.query(`select id,joint,final_status from weld_joints where project_title=any($1::text[])
            and (joint<>'F'||lpad((id-$2+1)::text,7,'0') or final_status is distinct from 'годен') order by id limit 5`, [projects, minId])).rows,
        }
        expect((await db.query(`select count(*)::int as n from weld_joints where project_title=any($1::text[])
          and (joint<>'F'||lpad((id-$2+1)::text,7,'0') or final_status is distinct from 'годен')`, [projects, minId])).rows[0].n).toBe(0)
      })
      const facts: Fact[] = Array.from({ length: total }, (_, n) => ({ id: minId + n, projectTitle: projectName(n % projectCount),
        subtitleCode: `CODE-${pad(Math.floor(n / projectCount) % 400, 3)}`, line: `LINE-${pad(Math.floor(n / 7) % 2000, 4)}`,
        joint: `F${pad(n + 1, 7)}`, weldDate: `2026-10-${pad(n % 20 + 1, 2)}`, finalStatus: 'годен' }))
      if (groupSql) {
        await withE2eDatabase(async db => {
          await db.query('analyze weld_joints')
          await runDeepFilterGroupSqlExperiment(db, facts, async diagnostic => { groupSqlDiagnostic = diagnostic; await save() })
        })
        expect(await querySignature()).toEqual(factSignature)
        return
      }
      if (groupRepro) {
        const countsFile = process.env.AUDIT_SQL_COUNTS_FILE
        expect(countsFile, 'The isolated audit wrapper must capture member SQL before executing it').toMatch(/counts\.json$/)
        const memberFile = countsFile!.replace(/counts\.json$/, 'group-repro-member.json')
        // Same logical baseline fixture, invalidation and HTTP freshness guards.
        // No 9k predecessor, temporary indexes or 225 preceding report steps:
        // physical table layout/cache history can differ from the failed run.
        await withE2eDatabase(async db => {
          await db.query(`drop index if exists ${indexNames.join(',')}`)
          await db.query('analyze weld_joints')
          await invalidateDerivedCalculationCache(drizzle(db))
        })
        expect(await querySignature()).toEqual(factSignature)
        const prime = await call<JournalGridResult>('readJournalGrid', { report: 'weldingJournal',
          columnFilters: { joint: '=NO-SUCH-DEEP-HTTP-JOINT' }, groupBy: [], route: [], start: 0, end: 100 })
        expect(prime.rowCount).toBe(0)
        const inspectGroup = async (name: string, columnFilters: Record<string, string>, expected: Fact[]) => {
          const request: JournalGridRequest = { report: 'heatTreatment', columnFilters, groupBy: ['projectTitle'],
            route: [], start: 0, end: 100, revision: prime.revision }
          const diagnostic: {
            phase: string; name: string; request: JournalGridRequest; startedAt: string; finishedAt?: string;
            before?: unknown; after?: unknown; captures: unknown[]; activity: unknown[]; observerErrors: string[];
            response?: unknown; error?: { name: string; message: string }
          } = { phase: 'baseline-group-repro', name, request, startedAt: new Date().toISOString(),
            captures: [], activity: [], observerErrors: [] }
          phases.push(diagnostic)
          console.log('DEEP_FILTER_GROUP_REPRO', JSON.stringify({ name, state: 'start', expectedMembers: expected.length, request }))
          await auditSqlCount(); diagnostic.before = await auditSqlDetails(); await save()
          let previousMarker = await readFile(memberFile, 'utf8').catch(() => '')
          let capture: { backendPid: number; sql: string } | undefined
          let result: JournalGridResult | undefined, failure: unknown, finished = false
          try {
            await withE2eDatabase(async db => {
              expect((await db.query('select current_database() as database')).rows[0].database).toBe('welding_tracker_e2e')
              const pending = measured<JournalGridResult>('baseline', 0, 'heatTreatment', name, 'readJournalGrid', request)
                .then(value => { result = value }, error => { failure = error })
                .finally(() => { finished = true })
              const observe = async () => {
                try {
                  const raw = await readFile(memberFile, 'utf8').catch(error => {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
                    throw error
                  })
                  if (raw && raw !== previousMarker) {
                    const next = JSON.parse(raw) as { backendPid: number; sql: string }
                    if (!Number.isSafeInteger(next.backendPid) || next.backendPid <= 0 || typeof next.sql !== 'string') throw Error('Invalid member-query capture')
                    previousMarker = raw; capture = next; diagnostic.captures.push(next)
                    // Preserve the exact query/parameters/EXPLAIN even if the
                    // following HTTP request never completes.
                    await save()
                  }
                  if (!capture) return
                  const activity = await db.query(`select pid,datname,state,wait_event_type,wait_event,backend_type,
                    query_start,xact_start,clock_timestamp() as sampled_at,pg_blocking_pids(pid) as blocking_pids,
                    query=$2 as captured_member_query,
                    query=left($2,length(query)) as captured_member_query_prefix,
                    length(query) as observed_query_length,length($2) as captured_query_length
                    from pg_stat_activity where pid=$1 and datname=current_database()`, [capture.backendPid, capture.sql])
                  diagnostic.activity.push(...activity.rows)
                } catch (error) { diagnostic.observerErrors.push(error instanceof Error ? error.message : String(error)) }
              }
              while (!finished) {
                await observe()
                if (finished) break
                let timer: ReturnType<typeof setTimeout> | undefined
                await new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); void pending.then(() => resolve()) })
                if (timer) clearTimeout(timer)
              }
              await pending
              await observe()
            })
            if (failure) throw failure
            expect(diagnostic.captures.length, 'Audit wrapper captured the real member SELECT before execution').toBeGreaterThan(0)
            expect(diagnostic.observerErrors).toEqual([])
            expect(result).toBeDefined()
            const counts = new Map<string, number>()
            for (const row of expected) counts.set(row.projectTitle, (counts.get(row.projectTitle) ?? 0) + 1)
            expect(result!.rowCount).toBe(counts.size)
            for (const row of result!.rows) {
              const group = row.journalGroup!, count = counts.get(group.key)
              expect(group.recordCount).toBe(count)
              expect(group.summary).toMatchObject({ joints: count, wdi: count })
            }
            diagnostic.response = { revision: result!.revision, rowCount: result!.rowCount,
              groups: result!.rows.map(row => ({ key: row.journalGroup!.key, recordCount: row.journalGroup!.recordCount })) }
          } catch (error) {
            // Playwright may append HTTP headers to a timeout's call log.
            // Keep only the error headline; request/SQL are captured separately.
            diagnostic.error = { name: error instanceof Error ? error.name : 'UnknownError', message: (error instanceof Error ? error.message : String(error)).split('\n')[0] }
            throw error
          } finally {
            diagnostic.finishedAt = new Date().toISOString()
            await auditSqlCount(); diagnostic.after = await auditSqlDetails(); await save()
            console.log('DEEP_FILTER_GROUP_REPRO', JSON.stringify({ name, state: diagnostic.error ? 'failed' : 'complete', captures: diagnostic.captures.length,
              activitySamples: diagnostic.activity.length, error: diagnostic.error }))
          }
        }
        const warmProjects = projects.slice(0, 10), warmSet = new Set(warmProjects)
        await inspectGroup('warmup-50000/project-choice-group', { projectTitle: buildWeldColumnValueFilter(warmProjects) }, facts.filter(row => warmSet.has(row.projectTitle)))
        await inspectGroup('filtered/group-root', { projectTitle: marker, line: 'LINE-0' }, facts.filter(row => row.line.includes('LINE-0')))
        expect(await querySignature()).toEqual(factSignature)
        return
      }
      const readCases = cases()
      const expectedByReport = new Map(reports.map(report => [report, new Map(readCases.map(item => [item.name, ordered(facts.filter(item.matches), report)]))]))
      let lastRevision: JournalRevision | undefined
      const ginPhase: Phase = indexProfile === 'raw-v2' ? 'raw-gin' : 'coalesce-gin'
      const phaseOrders: Phase[][] = [['baseline', ginPhase, 'choice-btree'], [ginPhase, 'choice-btree', 'baseline'], ['choice-btree', 'baseline', ginPhase]]
      for (let round = 0; round < phaseOrders.length; round++) for (const phase of phaseOrders[round]) {
        const ddl = await withE2eDatabase(async db => {
          const start = performance.now()
          // These names were verified absent before this test claimed them.
          await db.query(`drop index if exists ${indexNames.join(',')}`)
          if (phase !== 'baseline') for (const field of indexedFields) {
            await db.query(phase === 'coalesce-gin'
              ? `create index e2e_deep_http_${field}_trgm on weld_joints using gin (coalesce(${field}, '') gin_trgm_ops)`
              : phase === 'raw-gin'
                ? `create index e2e_deep_http_${field}_raw_trgm on weld_joints using gin (${field} gin_trgm_ops)`
                : `create index e2e_deep_http_${field}_choice on weld_joints (lower(trim(coalesce(${field}::text, ''))))`)
          }
          const buildMs = performance.now() - start
          await db.query('analyze weld_joints')
          const indexes = (await db.query(`select indexrelname,pg_relation_size(indexrelid)::int as bytes,pg_get_indexdef(indexrelid) as definition
            from pg_stat_user_indexes where indexrelname=any($1::text[]) order by indexrelname`, [indexNames])).rows
          // Fixture-only cache reset: no fact/dispatcher writes and no fake
          // publication. Existing freshness checks still run in every HTTP read.
          await invalidateDerivedCalculationCache(drizzle(db))
          return { buildMs, indexes }
        })
        expect(await querySignature()).toEqual(factSignature)
        const prime = await call<JournalGridResult>('readJournalGrid', { report: 'weldingJournal', columnFilters: { joint: '=NO-SUCH-DEEP-HTTP-JOINT' }, groupBy: [], route: [], start: 0, end: 100 })
        expect(prime.rowCount).toBe(0)
        expect(prime.revision).not.toBe(lastRevision)
        lastRevision = prime.revision
        const before = await auditSqlCount(), detailsBefore = await auditSqlDetails()
        for (const report of reports) {
          const base: JournalGridRequest = { report, columnFilters: { projectTitle: marker }, groupBy: [], route: [], start: 0, end: 100, revision: prime.revision }
          for (const item of readCases) {
            const request = { ...base, columnFilters: { ...base.columnFilters, ...item.filters } }
            const expected = expectedByReport.get(report)!.get(item.name)!
            const result = await measured<JournalGridResult>(phase, round, report, item.name + '/rows', 'readJournalGrid', request)
            expect(result.rowCount, item.name).toBe(expected.length)
            expect(result.rows.map(row => row.id), item.name).toEqual(expected.slice(0, 100).map(row => row.id))
            compare(`${report}/${item.name}/rows`, { rowCount: result.rowCount, rows: result.rows })
            const summary = await measured<WeldReportSummaryResult>(phase, round, report, item.name + '/summary', 'getJournalReportSummary', {
              report, ...splitReportQuickSearch(request.columnFilters), revision: result.revision,
            })
            expect(summary.total).toBe(expected.length)
            if (report === 'weldingJournal') expect(summary.acceptedWdiTotal).toBe(expected.length)
            compare(`${report}/${item.name}/summary`, summary)
          }
          // One normal scroll batch includes the next block and the end of a
          // broad selection. Counts/order are checked independently of page 1.
          const selected = expectedByReport.get(report)!.get('project-selective')!
          const blocks = [{ route: [], start: 100, end: 200 }, { route: [], start: Math.max(0, selected.length - 100), end: selected.length }]
          const batch = await measured<JournalGridResult[]>(phase, round, report, 'project/scroll-blocks', 'readJournalGridBlocks', {
            ...base, columnFilters: { projectTitle: 'PROJECT-000' }, blocks,
          })
          expect(batch).toHaveLength(blocks.length)
          batch.forEach((result, index) => {
            expect(result.rowCount).toBe(selected.length)
            expect(result.rows.map(row => row.id)).toEqual(selected.slice(blocks[index].start, blocks[index].end).map(row => row.id))
            compare(`${report}/scroll-${index}`, { rowCount: result.rowCount, rows: result.rows })
          })
          for (const field of ['projectTitle', 'subtitleCode', 'line', 'joint', 'weldDate', 'finalStatus'] as Field[]) {
            // Start with the unfiltered project menu, then other menus after
            // checking one project, as in the real panel. An impossible own
            // filter must be ignored while the other exact choice survives.
            const context: Record<string, string> = field === 'projectTitle' ? {}
              : { projectTitle: buildWeldColumnValueFilter([projects[0]]) }
            const candidates = field === 'projectTitle' ? facts : facts.filter(row => row.projectTitle === projects[0])
            const counts = new Map<string, number>()
            for (const row of candidates) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1)
            // The runner's verified seed belongs to all three reports. It is
            // visible in the first menu, but never matches PROJECT-00 below.
            if (field === 'projectTitle') counts.set('E2E проект', 1)
            const input = { report, fieldKey: field, columnFilters: { ...context, [field]: '=NO-SUCH-OWN-VALUE' }, revision: prime.revision }
            const facet = await measured<JournalFilterPage>(phase, round, report, `${field}/facet`, 'readJournalFilterPage', input)
            expect(facet.total).toBe(counts.size)
            for (const option of facet.options) expect(option.count).toBe(counts.get(option.value))
            compare(`${report}/${field}/facet`, { total: facet.total, options: facet.options, next: facet.next })
            // ASCII date prefix and padded text fragments have unambiguous raw
            // and display matches. The complete independent expected total
            // catches accidental truncation to the initial 150 options.
            const match = field === 'finalStatus' ? 'годен' : field === 'weldDate' ? '2026' : field === 'projectTitle' ? 'PROJECT-00' : '017'
            const matching = [...counts].filter(([value]) => value.toLowerCase().includes(match.toLowerCase()))
            const localOptions = facet.options.filter(option => option.value.toLowerCase().includes(match.toLowerCase()))
            const search = facet.next === undefined
              ? { options: localOptions, total: localOptions.length, revision: facet.revision }
              : await measured<JournalFilterPage>(phase, round, report, `${field}/facet-search`, 'readJournalFilterPage', { ...input, match })
            if (facet.next === undefined) samples.push({ phase, round, report, name: `${field}/facet-search`,
              transport: 'already-loaded-options', matchingValues: search.total })
            expect(search.total).toBe(matching.length)
            for (const option of search.options) {
              expect(option.count).toBe(counts.get(option.value))
              expect(option.value.toLowerCase().includes(match.toLowerCase())).toBe(true)
            }
            compare(`${report}/${field}/facet-search`, { total: search.total, options: search.options, next: search.next })
            // This is the ordinary UI fragment workflow: searching the menu
            // selects exact choice values, rather than sending direct ILIKE.
            // Preserve its separate timings; trigram gains in direct contains
            // are not evidence of a gain for this everyday path.
            const choices = search.options.length === search.total
              ? { values: search.options.map(option => option.value), revision: search.revision }
              : await measured<{ values: string[]; revision: JournalRevision }>(phase, round, report,
                `${field}/select-found-values`, 'selectJournalFilterValues', { ...input, match })
            if (search.options.length === search.total) samples.push({ phase, round, report, name: `${field}/select-found-values`,
              transport: 'already-loaded-options', selectedValues: choices.values.length })
            expect(choices.values.slice().sort()).toEqual(matching.map(([value]) => value).sort())
            expect(choices.values.length, `meaningful UI choice fixture: ${field}`).toBeGreaterThan(0)
            const selections = choices.values.length > 1
              ? [{ name: 'single', values: choices.values.slice(0, 1) }, { name: 'all-found', values: choices.values }]
              : [{ name: 'all-found', values: choices.values }]
            for (const selection of selections) {
              const selectedValues = new Set(selection.values)
              const expectedChoice = ordered(candidates.filter(row => selectedValues.has(row[field])), report)
              const choiceRequest = { ...base, columnFilters: { ...context, [field]: buildWeldColumnValueFilter(selection.values) }, revision: choices.revision }
              const choiceRows = await measured<JournalGridResult>(phase, round, report,
                `${field}/choice-${selection.name}/rows`, 'readJournalGrid', choiceRequest)
              expect(choiceRows.rowCount).toBe(expectedChoice.length)
              expect(choiceRows.rows.map(row => row.id)).toEqual(expectedChoice.slice(0, 100).map(row => row.id))
              compare(`${report}/${field}/choice-${selection.name}/rows`, { rowCount: choiceRows.rowCount, rows: choiceRows.rows })
              const choiceSummary = await measured<WeldReportSummaryResult>(phase, round, report,
                `${field}/choice-${selection.name}/summary`, 'getJournalReportSummary', {
                  report, ...splitReportQuickSearch(choiceRequest.columnFilters), revision: choiceRows.revision,
                })
              expect(choiceSummary.total).toBe(expectedChoice.length)
              compare(`${report}/${field}/choice-${selection.name}/summary`, choiceSummary)
              if (selection.name === 'all-found') {
                const choiceGroups = await measured<JournalGridResult>(phase, round, report,
                  `${field}/choice-all-found/group`, 'readJournalGrid', { ...choiceRequest, groupBy: ['projectTitle'] })
                const groupedCounts = new Map<string, number>()
                for (const row of expectedChoice) groupedCounts.set(row.projectTitle, (groupedCounts.get(row.projectTitle) ?? 0) + 1)
                expect(choiceGroups.rowCount).toBe(groupedCounts.size)
                expect(new Map(choiceGroups.rows.map(row => [row.journalGroup!.key, row.journalGroup!.recordCount]))).toEqual(groupedCounts)
                compare(`${report}/${field}/choice-all-found/group`, { rowCount: choiceGroups.rowCount, rows: choiceGroups.rows })
              }
            }
          }
          const grouping: JournalGridRequest = { ...base, columnFilters: { projectTitle: marker, line: 'LINE-0' }, groupBy: ['projectTitle'] }
          const grouped = await measured<JournalGridResult>(phase, round, report, 'filtered/group-root', 'readJournalGrid', grouping)
          const expectedGroups = new Map(projects.map(project => [project, facts.filter(row => row.projectTitle === project && row.line.includes('LINE-0')).length]))
          expect(grouped.rowCount).toBe(projectCount)
          for (const row of grouped.rows) {
            const group = row.journalGroup!, count = expectedGroups.get(group.key)
            expect(group.recordCount).toBe(count)
            expect(group.summary).toMatchObject({ joints: count, wdi: count })
          }
          compare(`${report}/group-root`, { rowCount: grouped.rowCount, rows: grouped.rows })
          const route = [projects[0]], members = ordered(facts.filter(row => row.projectTitle === route[0] && row.line.includes('LINE-0')), report)
          for (const name of ['open', 'reopen']) {
            const opened = await measured<JournalGridResult>(phase, round, report, `filtered/group-${name}`, 'readJournalGrid', { ...grouping, route })
            expect(opened.rowCount).toBe(members.length)
            expect(opened.rows.map(row => row.id)).toEqual(members.slice(0, 100).map(row => row.id))
            compare(`${report}/group-${name}`, { rowCount: opened.rowCount, rows: opened.rows })
          }
        }
        const after = await auditSqlCount(), detailsAfter = await auditSqlDetails()
        // Isolate planner evidence for the exact existing choice/contains
        // expressions. These are explanatory SQL controls, never reported as
        // the HTTP latency or a complete hydrated application query.
        const plans = round === 0 ? await withE2eDatabase(async db => {
          const controls: Array<{ name: string; sql: string; parameters: unknown[] }> = [
            { name: 'single-project-choice', sql: "select count(*) from weld_joints where lower(trim(coalesce(project_title::text,'')))=any($1::text[])", parameters: [[projects[0].toLowerCase()]] },
            { name: 'multiple-project-choices', sql: "select count(*) from weld_joints where lower(trim(coalesce(project_title::text,'')))=any($1::text[])", parameters: [projects.slice(0, Math.min(10, projectCount)).map(project => project.toLowerCase())] },
            { name: 'single-subtitle-choice', sql: "select count(*) from weld_joints where lower(trim(coalesce(subtitle_code::text,'')))=any($1::text[])", parameters: [['code-017']] },
            { name: 'line-contains', sql: indexProfile === 'raw-v2'
              ? 'select count(*) from weld_joints where line is not null and line::text ilike $1'
              : "select count(*) from weld_joints where coalesce(line::text,'') ilike $1", parameters: ['%LINE-0017%'] },
          ]
          const result: object[] = []
          for (const control of controls) result.push({ ...control,
            plan: (await db.query('explain (analyze,buffers,format json) ' + control.sql, control.parameters)).rows[0]['QUERY PLAN'] })
          return result
        }) : undefined
        phases.push({ phase, round, revision: prime.revision, ...ddl, plans, statements: before === undefined || after === undefined ? undefined : after - before, detailsBefore, detailsAfter })
        expect(await querySignature()).toEqual(factSignature)
        await save()
      }
    } finally {
      try { await save() } finally {
        if (verifiedFixture) await withE2eDatabase(async db => {
          await db.query(`drop index if exists ${indexNames.join(',')}`)
          if (ownedExtension) await db.query('drop extension pg_trgm')
        })
        if (seeded) {
          await cleanupLineProgramProjects(projects)
          await withLineProgramFixture(db => previousOther === undefined ? db.query("delete from app_settings where key='other'")
            : db.query("update app_settings set value=$1 where key='other'", [previousOther]))
        }
      }
    }
  })
}
