import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import type { SpecialistCertificate, SpecialistRecord } from '../../src/lib/document-specialists'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { auditSqlDetails, auditSqlSnapshot } from '../audit-sql'
import { assertSafeE2eDatabaseUrl, E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, isAccountRefreshRpc, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { createSmoothnessProbe } from '../smoothness-probe'

const enabled = process.env.AUDIT_SPECIALIST_CERTIFICATES_LOAD === '1'
const localOrigin = process.env.E2E_DATABASE_PROFILE === 'precommit-performance'
  ? 'http://127.0.0.1:3177' : 'http://127.0.0.1:3100'
test.skip(!enabled, 'Opt-in specialist RPC/SQL profile on the runner-owned local database')
test.use({ trace: 'off', video: 'off' })
const count = 10_000
type ReadStats = { calls: number; rows: number; totalMilliseconds: number }
type Counters = NonNullable<Awaited<ReturnType<typeof auditSqlDetails>>> & {
  operations: Record<string, number>
  rpcStatements: Record<string, number>
  rpcReleaseReadinessStatements: Record<string, number>
}
type Measurement = {
  label: string; rpc: string; items: number; milliseconds: number; serializationMilliseconds: number
  requestBytes: number; responseBytes: number; status: number; rpcSql: number
  releaseReadinessSql: number; rpcSqlExcludingReadiness: number; processSql: number
  operationCounts: Record<string, number>; reads: Record<string, ReadStats>; error?: string
}

test('10k specialist assignments and certificate requirements stay batched through protected RPCs and real audit history', async ({ page, context, baseURL }, info) => {
  test.setTimeout(300_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  expect(process.env.DATABASE_URL).toBe(E2E_DATABASE_URL)
  expect(baseURL).toBe(localOrigin)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.AUDIT_MEMORY).toBe('1')
  const project = `E2E specialist load ${randomUUID()}`
  const samples: Measurement[] = []
  const evidence: Record<string, unknown> = { version: 1, project, documents: count, welds: count, specialists: 20,
    requirementsRawLimit: count, timing: 'One request per case; RPC timing excludes fixture SQL, serialization and telemetry flush. Not a p95/load-concurrency result.',
    sql: 'RPC-local statements include authorization, transaction SQL and audit. Exact release-readiness probes are also shown separately. Observer/fixture SQL is excluded.',
    samples }
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  const snapshot = async () => {
    await auditSqlSnapshot() // Existing 650ms flush wait, outside RPC timings.
    const value = await auditSqlDetails() as Counters | undefined
    expect(value?.rpcStatements).toBeDefined()
    expect(value?.resources?.reads).toBeDefined()
    return value!
  }
  const measure = async <T,>(label: string, name: string, items: number, data: unknown) => {
    evidence.activeCase = { label, name, items }
    const url = siblingRpcUrl(observed, name + '_createServerFn_handler')
    expect(rpcName(url)).toBe(name + '_createServerFn_handler')
    const key = new URL(url).pathname.split('/').at(-1)!
    const encodingStarted = performance.now(), body = await serializeRpcData(data)
    const serializationMilliseconds = performance.now() - encodingStarted
    const before = await snapshot(), started = performance.now()
    const response = await context.request.post(url, { data: body, timeout: 120_000, maxRetries: 0,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' } })
    const text = await response.text(), milliseconds = performance.now() - started
    const value = await deserializeRpcResponse(text) as { result?: T; error?: Error }
    const after = await snapshot()
    const reads = Object.fromEntries(Object.entries(after.resources!.reads).map(([table, stats]) => {
      const prior = before.resources!.reads[table]
      return [table, { calls: stats.calls - (prior?.calls ?? 0), rows: stats.rows - (prior?.rows ?? 0),
        totalMilliseconds: Math.round((stats.totalMilliseconds - (prior?.totalMilliseconds ?? 0)) * 100) / 100 }]
    }).filter(([, stats]) => (stats as ReadStats).calls > 0))
    const rpcSql = (after.rpcStatements[key] ?? 0) - (before.rpcStatements[key] ?? 0)
    const releaseReadinessSql = (after.rpcReleaseReadinessStatements[key] ?? 0) - (before.rpcReleaseReadinessStatements[key] ?? 0)
    const sample: Measurement = { label, rpc: name, items, milliseconds: Math.round(milliseconds), serializationMilliseconds: Math.round(serializationMilliseconds),
      requestBytes: Buffer.byteLength(body), responseBytes: Buffer.byteLength(text), status: response.status(), rpcSql,
      releaseReadinessSql, rpcSqlExcludingReadiness: rpcSql - releaseReadinessSql, processSql: after.statements - before.statements,
      operationCounts: Object.fromEntries(Object.entries(after.operations).map(([operation, total]) => [operation, total - (before.operations[operation] ?? 0)]).filter(([, total]) => Number(total) > 0)),
      reads, ...(value.error ? { error: value.error.message } : {}) }
    samples.push(sample)
    delete evidence.activeCase
    console.log('SPECIALIST_CERTIFICATE_SQL', JSON.stringify(sample))
    await response.dispose()
    return { value, sample }
  }
  const certificate = (number: string, validFrom: string | null = null, validTo: string | null = null): SpecialistCertificate => ({ number, validFrom, validTo, methods: ['ВИК'] })
  const periods = (code: string) => [certificate(`${code}-1990-2003`, '1990-01-01', '2003-12-31'), certificate(`${code}-2004-2030`, '2004-01-01', '2030-12-31')]
  try {
    // Resolve the real hashed production RPCs from an authenticated page, then
    // close it so polling/background browser requests cannot enter the profile.
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Пользователи и права', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(observed).toBeTruthy()
    await page.close()
    const cards = [
      { code: 'A', certificates: periods('A'), archived: false },
      { code: 'B', certificates: periods('B'), archived: false },
      { code: 'HISTORY', certificates: [certificate('CURRENT-HISTORY')], archived: true },
      ...Array.from({ length: 8 }, (_, n) => ({ code: `FULL-${n}`, certificates: [certificate(`FULL-${n}`)], archived: false })),
      ...Array.from({ length: 4 }, (_, n) => ({ code: `EXPIRED-${n}`, certificates: [certificate(`EXPIRED-${n}`, '1980-01-01', '1989-12-31')], archived: false })),
      ...Array.from({ length: 5 }, (_, n) => ({ code: `PARTIAL-${n}`, certificates: [certificate(`PARTIAL-${n}`, '1990-01-01', '2000-12-31')], archived: false })),
    ]
    const people = await withLineProgramFixture(async db => {
      expect((await db.query('select id from weld_joints where project_title=$1 limit 1', [project])).rows).toHaveLength(0)
      const people = (await db.query<{ id: number; name: string; stamp: string }>(`insert into specialists(name,kind,certificate,stamp,methods,certificates,archived)
        select name,'inspector',certificates->0->>'number',stamp,array['ВИК'],certificates,archived
        from jsonb_to_recordset($1::jsonb) as c(name text,stamp text,certificates jsonb,archived boolean) returning id,name,stamp`,
      [JSON.stringify(cards.map(card => ({ ...card, name: `${project} ${card.code}`, stamp: `STAMP-${card.code}` })))])).rows
      const keeper = people.find(person => person.name === `${project} HISTORY`)!
      const second = { id: keeper.id, name: 'Историческое ФИО', certificate: 'SAVED-HISTORY', stamp: 'SAVED-STAMP' }
      evidence.preservedSecondRole = second
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,revision_actuality,has_vik,psto_required,
        vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,vik_defect_description,final_status)
        select $1,'CERT-LOAD','CERT-LOAD-L'||((n-1)/100+1),'F'||n,date '1990-01-01'+(n-1)-2,'актуальная','да','нет',
          $1||' request '||n,date '1990-01-01'+(n-1)-1,'годен',$1||' conclusion '||n,date '1990-01-01'+(n-1),'ДНО','годен'
        from generate_series(1,$2::integer) n`, [project, count])
      // Exactly one stored conclusion per factual result; no unrelated large
      // joint/document fixture and no application bypass on the measured path.
      await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata,specialists)
        select 'system:lnkConclusionVik',w.vik_conclusion,'load.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          w.vik_conclusion_date,w.vik_conclusion_date,1,
          jsonb_build_object('methodCodes',jsonb_build_array('ВИК'),'positionCount',1,'projects',jsonb_build_array($1::text),'lines',jsonb_build_array(w.line))::text,
          $2::jsonb from weld_joints w where w.project_title=$1`, [project, JSON.stringify({ first: null, second })])
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select d.id,w.id from weld_joints w join generated_documents d on d.type='system:lnkConclusionVik' and d.title=w.vik_conclusion where w.project_title=$1`, [project])
      for (const table of ['specialists', 'weld_joints', 'generated_documents', 'generated_document_weld_joints']) await db.query(`analyze ${table}`)
      return people
    })
    expect(people).toHaveLength(20)
    const targets = () => withE2eDatabase(async db => (await db.query<{ id: number; revision: number; updatedAt: Date; documentVersion: string; date: string }>(`
      select d.id,d.specialists_revision as revision,d.updated_at as "updatedAt",d.xmin::text as "documentVersion",d.period_from::text as date
      from generated_documents d where exists(select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
        where a.document_id=d.id and w.project_title=$1) order by d.id`, [project])).rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })))
    const sourceDigest = () => withE2eDatabase(async db => (await db.query(`select
      (select md5(string_agg(md5(to_jsonb(w)::text),',' order by w.id)) from weld_joints w where w.project_title=$1) as welds,
      (select md5(string_agg(md5((to_jsonb(d)-'specialists'-'specialists_revision'-'updated_at')::text),',' order by d.id)) from generated_documents d
        where exists(select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id where a.document_id=d.id and w.project_title=$1)) as document_facts,
      (select md5(string_agg(a.document_id::text||':'||a.weld_joint_id::text,',' order by a.document_id,a.weld_joint_id))
        from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1) as membership`, [project])).rows[0])
    const history = () => withE2eDatabase(async db => (await db.query<{ id: string; changes: number; specialists_changes: number; preserves_second: boolean }>(`
      select o.id,count(*)::int as changes,count(*) filter(where c.changes ? 'specialists')::int as specialists_changes,
        bool_and(c.changes->'specialists'->'before'->'second'=c.changes->'specialists'->'after'->'second') as preserves_second
      from audit_operations o join audit_changes c on c.operation_id=o.id join generated_documents d on c.entity='generated_documents' and c.entity_id=d.id::text
      where o.action='assignDocumentSpecialists' and exists(select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
        where a.document_id=d.id and w.project_title=$1) group by o.id order by o.id`, [project])).rows)
    const beforeFacts = await sourceDigest(), initialTargets = await targets()
    expect(initialTargets).toHaveLength(count)
    expect(new Set(initialTargets.map(row => row.date)).size).toBe(count)
    expect(await history()).toEqual([])
    evidence.sourceDigest = beforeFacts

    // Hit the actual raw-array ceiling (before deduplication), not the internal
    // helper. The above-limit case must reject even 10,001 identical entries.
    const same = { date: '1990-01-01', methods: ['ВИК'] }
    const picker = { search: project, kind: 'inspector', methods: ['ВИК'], status: 'active', includeCounts: false }
    const tooMany = await measure('picker-10001-rejected', 'listSpecialists', count + 1, { ...picker, requirements: Array.from({ length: count + 1 }, () => same) })
    expect(tooMany.value.error?.message).toContain('Некорректные даты заключений')
    for (const [label, requirements, expectedCodes] of [
      ['picker-1', [same], cards.filter(card => !card.archived && !card.code.startsWith('EXPIRED')).map(card => card.code)],
      ['picker-10000-same', Array.from({ length: count }, () => same), cards.filter(card => !card.archived && !card.code.startsWith('EXPIRED')).map(card => card.code)],
      ['picker-10000-distinct', initialTargets.map(row => ({ date: row.date, methods: ['ВИК'] })), cards.filter(card => !card.archived && (['A', 'B'].includes(card.code) || card.code.startsWith('FULL-'))).map(card => card.code)],
    ] as const) {
      const result = await measure<{ records: SpecialistRecord[]; hasMore: boolean }>(label, 'listSpecialists', requirements.length, { ...picker, requirements })
      expect(result.value.error).toBeUndefined()
      expect(result.sample.status).toBeLessThan(400)
      expect(result.value.result!.records.map(person => person.name).sort()).toEqual(expectedCodes.map(code => `${project} ${code}`).sort())
      expect(result.value.result!.hasMore).toBe(false)
      expect(result.sample.rpcSqlExcludingReadiness).toBeGreaterThan(0)
      expect(result.sample.rpcSqlExcludingReadiness).toBeLessThanOrEqual(12)
      expect(result.sample.reads.specialists?.calls).toBe(1)
    }
    const onePicker = samples.find(sample => sample.label === 'picker-1')!
    for (const label of ['picker-10000-same', 'picker-10000-distinct']) {
      expect(samples.find(sample => sample.label === label)!.rpcSqlExcludingReadiness - onePicker.rpcSqlExcludingReadiness).toBeLessThanOrEqual(2)
    }

    const auditEvidence: unknown[] = []
    evidence.auditHistory = auditEvidence
    for (const [size, code] of [[1, 'A'], [count, 'B']] as const) {
      const person = people.find(value => value.name === `${project} ${code}`)!
      const selected = (await targets()).slice(0, size)
      const priorHistory = await history()
      const result = await measure<{ count: number }>(`assign-${size}`, 'assignDocumentSpecialists', size, {
        documents: selected.map(({ date: _date, ...target }) => target), selection: { first: person.id },
      })
      expect(result.value.error).toBeUndefined()
      expect(result.sample.status).toBeLessThan(400)
      expect(result.value.result).toEqual({ count: size })
      const persisted = await withE2eDatabase(async db => (await db.query(`select
        count(*) filter(where d.id=any($2::int[]) and d.specialists->'first'->>'id'=$3::text and d.specialists->'first'->>'name'=$4
          and d.specialists->'first'->>'stamp'=$5 and d.specialists->'first'->>'certificateDate'=d.period_from::text
          and d.specialists->'first'->>'certificate'=$6||case when d.period_from<date '2004-01-01' then '-1990-2003' else '-2004-2030' end)::int as valid_first,
        count(*) filter(where not(d.id=any($2::int[])) and d.specialists->'first'='null'::jsonb)::int as untouched_first,
        count(*) filter(where d.specialists->'second' is distinct from $7::jsonb)::int as changed_second
        from generated_documents d where exists(select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
          where a.document_id=d.id and w.project_title=$1)`,
      [project, selected.map(row => row.id), person.id, person.name, person.stamp, code, JSON.stringify(evidence.preservedSecondRole)])).rows[0])
      expect(persisted).toEqual({ valid_first: size, untouched_first: count - size, changed_second: 0 })
      const freshHistory = (await history()).filter(operation => !priorHistory.some(prior => prior.id === operation.id))
      expect(freshHistory).toHaveLength(1)
      expect(freshHistory[0]).toMatchObject({ changes: size, specialists_changes: size, preserves_second: true })
      auditEvidence.push({ size, ...freshHistory[0] })
      expect(await sourceDigest()).toEqual(beforeFacts)
      expect(result.sample.reads.specialists?.calls).toBe(1)
      expect(result.sample.reads.generated_documents?.calls).toBeLessThanOrEqual(6)
      expect(result.sample.reads.weld_joints?.calls ?? 0).toBe(0)
      expect(result.sample.rpcSqlExcludingReadiness).toBeLessThanOrEqual(48 + Math.ceil(size / 500))
    }
    const small = samples.find(sample => sample.label === 'assign-1')!, large = samples.find(sample => sample.label === `assign-${count}`)!
    // Real audit history adds one INSERT per 500 changed documents. Allow the
    // fixed auth/session cost; a per-document query would exceed this by orders.
    const additionalHistoryBatches = Math.ceil(count / 500) - 1
    expect(large.rpcSqlExcludingReadiness - small.rpcSqlExcludingReadiness).toBeLessThanOrEqual(additionalHistoryBatches + 6)
    expect((await history()).map(operation => operation.changes).sort((a, b) => a - b)).toEqual([1, count])
    evidence.completed = true
  } finally {
    try {
      evidence.finalCounters = await auditSqlDetails()
      await writeFile(info.outputPath('specialist-certificates-load.json'), JSON.stringify(evidence, null, 2))
    } finally {
      await page.close().catch(() => {})
      await cleanupLineProgramProjects([project])
      await withE2eDatabase(db => db.query('delete from specialists where name like $1', [project + '%']))
    }
  }
})

test('a shared 10k-position conclusion keeps name typing and composition pagination local without saving the draft', async ({ page, baseURL }, info) => {
  test.setTimeout(300_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  expect(process.env.DATABASE_URL).toBe(E2E_DATABASE_URL)
  expect(baseURL).toBe(localOrigin)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.AUDIT_MEMORY).toBe('1')
  const project = `E2E shared document typing ${randomUUID()}`
  const title = `${project} conclusion`
  const suffix = '1234567890abcdefghij'
  const typingDelay = 20
  const evidence: Record<string, unknown> = { version: 1, positions: count, typedCharacters: suffix.length,
    keyDelayMilliseconds: typingDelay, nominalKeyDelayMilliseconds: suffix.length * typingDelay,
    measurement: 'Real pressSequentially; full plan/chronology sees all 10k rows while composition renders 25. RAF, long tasks, script/layout time and RPC/SQL are in smoothness.json. No save is submitted.' }
  const probe = await createSmoothnessProbe(page, info)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) requests.push(rpcName(request.url())) })
  const contextResponses: Promise<{ status: number; urlBytes: number; bytes?: number; error?: string; errorBody?: string }>[] = []
  page.on('response', response => {
    if (response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('getSystemDocumentDateContext')) {
      const metadata = { status: response.status(), urlBytes: response.url().length }
      contextResponses.push(response.text().then(body => ({ ...metadata, bytes: body.length,
        errorBody: body.length < 5000 ? body : undefined }), error => ({ ...metadata, error: String(error) })))
    }
  })
  const savedState = () => withE2eDatabase(async db => ({
    rows: (await db.query(`select count(*)::int as count,
      md5(string_agg(md5(to_jsonb(w)::text||w.xmin::text),',' order by w.id)) as digest
      from weld_joints w where w.project_title=$1`, [project])).rows[0],
    documents: (await db.query(`select d.*,d.xmin::text as version,
      (select count(*)::int from generated_document_weld_joints a where a.document_id=d.id) as members
      from generated_documents d where exists(select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
        where a.document_id=d.id and w.project_title=$1) order by d.id`, [project])).rows,
    membership: (await db.query(`select md5(string_agg(a.document_id::text||':'||a.weld_joint_id::text,',' order by a.document_id,a.weld_joint_id)) as digest
      from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1`, [project])).rows[0],
  }))
  try {
    await withLineProgramFixture(async db => {
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,revision_actuality,has_vik,psto_required,
        vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,vik_defect_description,final_status)
        select $1,'SHARED-10K','SHARED-10K-L','F'||lpad(n::text,5,'0'),'2025-01-01','актуальная','да','нет',
          $1||' request','2025-01-02','годен',$2,'2025-01-03','ДНО','годен' from generate_series(1,$3::integer) n`, [project, title, count])
    })
    await requireDb().transaction(async tx => {
      const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    })
    await ensureDispatcherTaskIndexFresh()
    await page.goto('/lnk')
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
    const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Все результаты ЛНК', exact: true }) })
    const pane = manager.getByRole('tabpanel', { name: 'Документы', exact: true })
    const composition = pane.getByRole('region', { name: 'Полный состав документа', exact: true })
    await auditSqlSnapshot()
    await probe.measure('shared-document:open-10000-positions', async () => {
      await manager.getByRole('tab', { name: 'Документы', exact: true }).click()
      await pane.getByPlaceholder('Поиск документов').fill(title)
      await pane.getByRole('complementary').getByRole('button').filter({ hasText: title }).click()
      await expect(pane.getByText('Дата: 03.01.2025 · Стыков: 10000', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(composition.getByRole('button', { name: 'Показать стык в журнале', exact: true })).toHaveCount(25)
      await expect(composition.getByText('1 из 400', { exact: true })).toBeVisible()
    })
    await probe.measure('shared-document:composition-next-page', async () => {
      await composition.getByRole('button', { name: 'Следующая страница стыков', exact: true }).click()
      await expect(composition.getByText('26-50', { exact: true })).toBeVisible()
      await expect(composition.getByText('2 из 400', { exact: true })).toBeVisible()
      await expect(composition.getByRole('button', { name: 'Показать стык в журнале', exact: true })).toHaveCount(25)
    })
    const name = pane.getByLabel('Название документа', { exact: true })
    await probe.measure('shared-document:open-editor-10000-positions', async () => {
      await pane.getByRole('button', { name: 'Редактировать', exact: true }).click()
      await expect(name).toHaveValue(title)
    })
    await name.fill(title) // Unchanged value; place the caret after the existing name.
    await page.waitForLoadState('networkidle')
    await auditSqlSnapshot()
    const beforeSql = await auditSqlDetails() as Counters
    const beforeSaved = await savedState()
    expect(beforeSaved.rows.count).toBe(count)
    expect(beforeSaved.documents.find(document => document.title === title)).toMatchObject({ row_count: count, members: count })
    const firstRequest = requests.length
    let typingMilliseconds = 0
    await probe.measure('shared-document:type-20-characters', async () => {
      const started = performance.now()
      await name.pressSequentially(suffix, { delay: typingDelay })
      await expect(name).toHaveValue(title + suffix)
      await expect(pane.getByRole('button', { name: 'Сохранить изменения документа', exact: true })).toBeEnabled()
      typingMilliseconds = performance.now() - started
    })
    const afterSql = await auditSqlDetails() as Counters
    const typingRequests = requests.slice(firstRequest)
    evidence.typing = { milliseconds: Math.round(typingMilliseconds), rpc: typingRequests,
      processSql: afterSql.statements - beforeSql.statements,
      rpcSql: Object.fromEntries(Object.entries(afterSql.rpcStatements).map(([id, total]) => [
        rpcName(`${baseURL}/_serverFn/${id}`), total - (beforeSql.rpcStatements[id] ?? 0),
      ]).filter(([, total]) => Number(total) > 0)) }
    // Account liveness/dispatcher version polling is background work; typing
    // must not fetch document composition or issue any mutation per keystroke.
    expect(typingRequests.filter(name => !isAccountRefreshRpc(name) && !name.startsWith('getDispatcherTaskVersion_'))).toEqual([])
    await probe.measure('shared-document:hide-and-restore-draft', async () => {
      await manager.getByRole('tab', { name: 'Стыки', exact: true }).click()
      await expect(pane).toBeHidden()
      await manager.getByRole('tab', { name: 'Документы', exact: true }).click()
      await expect(name).toHaveValue(title + suffix)
      await expect(composition.getByText('2 из 400', { exact: true })).toBeVisible()
      await expect(composition.getByRole('button', { name: 'Показать стык в журнале', exact: true })).toHaveCount(25)
    })
    await manager.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(manager).toBeHidden()
    expect(await savedState()).toEqual(beforeSaved)
    expect(requests.slice(firstRequest).some(name => /^(changeSystemDocumentDate|assignDocumentSpecialists|updateWeld)/.test(name))).toBe(false)
    const contexts = await Promise.all(contextResponses)
    expect(contexts.length).toBeGreaterThan(0)
    for (const response of contexts) {
      expect(response.status).toBe(200)
      expect(response.urlBytes).toBeLessThan(2000)
    }
    evidence.savedStateUnchanged = true
    evidence.completed = true
  } finally {
    try {
      evidence.contextResponses = await Promise.all(contextResponses)
      if (!evidence.completed && !page.isClosed()) {
        await writeFile(info.outputPath('shared-document-page.txt'), await page.locator('body').innerText())
        await page.screenshot({ path: info.outputPath('shared-document-page.png') })
      }
      await probe.finish()
      await writeFile(info.outputPath('specialist-shared-document-load.json'), JSON.stringify(evidence, null, 2))
    } finally {
      await page.close().catch(() => {})
      await cleanupLineProgramProjects([project])
    }
  }
})
