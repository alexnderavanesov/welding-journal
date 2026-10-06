import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { buildCurrentSystemDocumentName } from '../../src/lib/system-document-types'

// Opt-in isolated load audit: AUDIT_REBUILD_ROWS=200 or 200000. e2e/run.ts
// owns a fresh disposable localhost database and drops it after the run.
const count = Number(process.env.AUDIT_REBUILD_ROWS || 0)
// Resource comparison may exercise a fixed number of real, confirmed packets.
// Omit this setting for the full 800000-position preservation audit.
const packetSample = Number(process.env.AUDIT_REBUILD_PACKETS || 0)
const project = 'E2E four-kind rebuild scale'
const definitions = [
  { type: 'pstoRequest' as const, storage: 'pstoRequest', field: 'psto_request', date: '2026-09-04' },
  { type: 'pstoConclusion' as const, storage: 'pstoConclusion', field: 'heat_treatment_diagram', date: '2026-09-05' },
  { type: 'lnkRequest' as const, storage: 'tvmtRequest', methodCode: 'ТВМТ', field: 'tvmt_request', date: '2026-09-05' },
  { type: 'lnkConclusion' as const, storage: 'tvmtConclusion', methodCode: 'ТВМТ', field: 'tvmt_conclusion', date: '2026-09-06' },
]

async function seed() {
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int as n from weld_joints')).rows[0].n).toBe(1)
    expect((await db.query('select count(*)::int as n from generated_documents')).rows[0].n).toBe(0)
    await db.query(`insert into app_settings(key,value) values ('request-conclusion',$1)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        pstoRequest: 'line', pstoConclusion: 'line', tvmtRequest: 'line', tvmtConclusion: 'line' },
    })])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'LOAD','L'||n,'II','A',10,10 from generate_series(1,$2::int) n`, [project, count / 100])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,has_vik,connection_type,psto_required,psto_request,psto_request_date,psto_date,
      heat_treatment_diagram,psto_result,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion_date,tvmt_conclusion,psto_note)
      select p.id,$1,'LOAD',p.line,'S'||n,'2026-09-01','действующий','актуальная','да','С17','да',
        'Первичная заявка ПСТО','2026-09-01','2026-09-02','Первичная диаграмма','выполнено',
        'Первичная заявка ТВМТ','2026-09-02','не годен','2026-09-03','Первичное заключение ТВМТ','  Факт первого цикла  '
      from generate_series(1,$2::int) n join line_programs p on p.project_title=$1 and p.line='L'||((n-1)/100+1)`, [project, count])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [project])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request_date,psto_date,psto_result,
      tvmt_request_date,tvmt_result,tvmt_conclusion_date,psto_note)
      select id,2,'2026-09-04','2026-09-05','выполнено','2026-09-05','годен','2026-09-06','  Факт второго цикла  '
      from weld_joints where project_title=$1 and substring(joint from 2)::int%2=0`, [project])
    await db.query(`update weld_joints set psto_request_date='2026-09-04',psto_date='2026-09-05',
      tvmt_request_date='2026-09-05',tvmt_result='годен',tvmt_conclusion_date='2026-09-06'
      where project_title=$1 and substring(joint from 2)::int%2=1`, [project])
    for (const definition of definitions) {
      const names = Array.from({ length: count / 200 }, (_, i) => buildCurrentSystemDocumentName({
        ...definition, title: '',
      }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, i + 1))
      // SQL column names come exclusively from the fixed definitions above.
      await db.query(`update weld_joints set ${definition.field}=($2::text[])[(substring(joint from 2)::int-1)/200+1]
        where project_title=$1 and substring(joint from 2)::int%2=1`, [project, names])
      await db.query(`update psto_repeat_cycles c set ${definition.field}=($2::text[])[(substring(w.joint from 2)::int-1)/200+1]
        from weld_joints w where w.id=c.weld_joint_id and w.project_title=$1`, [project, names])
      await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
        select $3,($2::text[])[(substring(w.joint from 2)::int-1)/200+1],'load.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$4::date,$4::date,count(*)::int,
          jsonb_build_object('sourceKind','pstoCycle','cycleSequences',jsonb_build_array(1,2),'positionCount',count(*),
            'projects',jsonb_build_array($1::text),'subtitleCodes',jsonb_build_array('LOAD'),'lines',jsonb_agg(distinct w.line),
            'methodCode',$5::text,'methodCodes',case when $5::text is null then '[]'::jsonb else jsonb_build_array($5::text) end,
            'sourcePositions',jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind','pstoCycle','weldJointId',w.id,
              'relationId',coalesce(c.id,w.id),'sequence',case when c.id is null then 1 else 2 end,'methodCode',$5::text)) order by w.id))::text
        from weld_joints w left join psto_repeat_cycles c on c.weld_joint_id=w.id where w.project_title=$1
        group by (substring(w.joint from 2)::int-1)/200`, [project, names, `system:${definition.storage}`, definition.date, definition.methodCode ?? null])
    }
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,(p->>'weldJointId')::int from generated_documents d
      cross join lateral jsonb_array_elements(d.source_metadata::jsonb->'sourcePositions') p`)
  })
}

async function facts() {
  return withE2eDatabase(async db => {
    const excluded = ['psto_request', 'heat_treatment_diagram', 'tvmt_request', 'tvmt_conclusion', 'updated_at', 'lnk_updated_at', 'psto_updated_at']
    const rows = (await db.query(`select count(*)::int as n,md5(string_agg(md5((to_jsonb(w)-$2::text[])::text),'' order by id)) as hash
      from weld_joints w where project_title=$1`, [project, excluded])).rows[0]
    const cycles = (await db.query(`select count(*)::int as n,md5(string_agg(md5((to_jsonb(c)-$2::text[])::text),'' order by c.id)) as hash
      from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1`, [project, excluded])).rows[0]
    const positions = (await db.query(`select d.type,count(*)::int as n,
      md5(string_agg(p::text,'' order by (p->>'weldJointId')::int,(p->>'sequence')::int)) as hash
      from generated_documents d cross join lateral jsonb_array_elements(d.source_metadata::jsonb->'sourcePositions') p
      where d.source_metadata::jsonb->>'sourceKind'='pstoCycle' group by d.type order by d.type`)).rows
    const historicalFirstCycles = (await db.query(`select count(*)::int as n,
      md5(string_agg(jsonb_build_array(id,psto_request,heat_treatment_diagram,tvmt_request,tvmt_conclusion)::text,'' order by id)) as hash
      from weld_joints where project_title=$1 and substring(joint from 2)::int%2=0`, [project])).rows[0]
    return { rows, cycles, positions, historicalFirstCycles }
  })
}

async function sourcedDocumentCounts() {
  return withE2eDatabase(async db => (await db.query(`select type,count(*)::int as n
    from generated_documents where source_metadata::jsonb->>'sourceKind'='pstoCycle'
    group by type order by type`)).rows)
}

async function mutationFingerprint() {
  return withE2eDatabase(async db => {
    const names = (await db.query(`select md5(string_agg(jsonb_build_array(id,psto_request,heat_treatment_diagram,
      tvmt_request,tvmt_conclusion,updated_at,lnk_updated_at,psto_updated_at)::text,'' order by id)) as hash
      from weld_joints where project_title=$1`, [project])).rows[0]
    const cycles = (await db.query(`select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) as hash
      from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1`, [project])).rows[0]
    const documents = (await db.query(`select md5(string_agg(md5(to_jsonb(d)::text),'' order by id)) as hash from generated_documents d`)).rows[0]
    const links = (await db.query(`select md5(string_agg(to_jsonb(a)::text,'' order by document_id,weld_joint_id)) as hash from generated_document_weld_joints a`)).rows[0]
    const counters = (await db.query(`select key,value from app_settings where key like 'system-document-next-number:%' order by key`)).rows
    return { names, cycles, documents, links, counters }
  })
}

let initialFacts: Awaited<ReturnType<typeof facts>> | undefined
let initialMutation: Awaited<ReturnType<typeof mutationFingerprint>> | undefined
let applyAttempted = false
let completedPackets = 0
test.afterEach(async ({}, info) => {
  if (!initialFacts || info.status === info.expectedStatus) return
  // A resource/transport failure must not be called successful. Still inspect the
  // real DB before the runner drops it. Atomicity is now per confirmed packet;
  // a previous successful packet must not be rolled back by a later failure.
  expect(await facts()).toEqual(initialFacts)
  const counts = await sourcedDocumentCounts()
  const types = definitions.map(definition => `system:${definition.storage}`).sort()
  expect(counts.map(row => row.type)).toEqual(types)
  for (const row of counts) { expect(row.n).toBeGreaterThanOrEqual(count / 200); expect(row.n).toBeLessThanOrEqual(count / 100) }
  // The current packet either commits fully or leaves its checkpoint unchanged.
  // Dedicated injected-failure E2E verifies rollback of a later packet exactly.
  if (applyAttempted && completedPackets === 0 && counts.every(row => row.n === count / 200)) expect(await mutationFingerprint()).toEqual(initialMutation)
  console.log(JSON.stringify({ failedLoadFactsChecked: true, completedPackets, documentCounts: counts }))
})

test('load audit: all four document kinds over real HTTP preserve first and repeat cycles', async ({ page }, info) => {
  test.skip(!count, 'Opt-in load run; requires a fresh disposable database')
  test.setTimeout(1_200_000)
  expect([200, 200_000]).toContain(count)
  await seed()
  initialFacts = await facts()
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  const responsePromise = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('previewSystemDocumentRebuild_'), { timeout: 240_000 })
  const started = Date.now()
  await page.getByRole('button', { name: 'Пересобрать системные документы по текущим правилам', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  // Large responses can be evicted from Chromium's inspector body cache.
  // Network sizes do not retain/copy the payload and still measure real HTTP.
  const previewTransferBytes = (await response.request().sizes()).responseBodySize
  // Durable payload bound for the fixed 200k fixture; timing is diagnostic only.
  if (count === 200_000) expect(previewTransferBytes).toBeLessThan(20_000_000)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Пересборка системных документов', exact: true }) })
  await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeEnabled({ timeout: 240_000 })
  console.log(JSON.stringify({ phase: 'four-kind preview + browser', count, milliseconds: Date.now() - started, previewTransferBytes }))
  const before = initialFacts
  expect(before.rows.n).toBe(count)
  expect(before.cycles.n).toBe(count / 2)
  expect(before.historicalFirstCycles.n).toBe(count / 2)
  const types = definitions.map(definition => `system:${definition.storage}`).sort()
  expect(before.positions.map(({ type, n }) => ({ type, n }))).toEqual(types.map(type => ({ type, n: count })))
  expect(await sourcedDocumentCounts()).toEqual(types.map(type => ({ type, n: count / 200 })))
  // Cold document-index initialization may materialize separately retained first
  // cycles. Compare the apply transaction with its actual pre-apply checkpoint,
  // not the state before that distinct initialization workflow.
  initialMutation = await mutationFingerprint()
  applyAttempted = true
  const applying = Date.now()
  let previews = 1, applies = 0
  while (await dialog.isVisible()) {
    const apply = dialog.getByRole('button', { name: 'Применить пересборку', exact: true })
    await expect(dialog.getByText('Область пересборки', { exact: true })).toBeVisible({ timeout: 240_000 })
    if (await apply.isEnabled()) {
      const packetStarted = Date.now()
      await apply.click()
      applies += 1
      let outcome = 'pending'
      await expect.poll(async () => {
        if (!await dialog.isVisible() || await dialog.getByRole('status').isVisible()) outcome = 'saved'
        else if (await dialog.locator('.text-rose-700').isVisible()) outcome = await dialog.locator('.text-rose-700').innerText()
        return outcome
      }, { timeout: 240_000 }).not.toBe('pending')
      expect(outcome).toBe('saved')
      completedPackets += 1
      console.log(JSON.stringify({ phase: 'packet saved', packet: applies, milliseconds: Date.now() - packetStarted }))
      if (packetSample && completedPackets >= packetSample) break
    }
    if (!await dialog.isVisible()) break
    const next = dialog.getByRole('button', { name: 'Следующий пакет', exact: true })
    if (!await next.count()) break
    const nextPreview = page.waitForResponse(response => rpcName(response.url()).startsWith('previewSystemDocumentRebuild_'), { timeout: 240_000 })
    await next.click()
    previews += 1
    await nextPreview
  }
  console.log(JSON.stringify({ phase: 'four-kind apply + browser', count, milliseconds: Date.now() - applying }))
  expect(await facts()).toEqual(before)
  const documentCounts = await sourcedDocumentCounts()
  if (packetSample) {
    expect(completedPackets).toBe(packetSample)
    for (const row of documentCounts) { expect(row.n).toBeGreaterThanOrEqual(count / 200); expect(row.n).toBeLessThanOrEqual(count / 100) }
    expect(documentCounts.reduce((sum, row) => sum + row.n, 0)).toBeGreaterThan(4 * count / 200)
    console.log(JSON.stringify({ sampleOnly: true, completedPackets, documentCounts }))
  } else {
    expect(documentCounts).toEqual(types.map(type => ({ type, n: count / 100 })))
    // Each retained first-cycle document contains 100000 positions: refuse it
    // visibly and leave its facts intact, while completing all normal packets.
    if (count === 200_000) await expect(dialog.getByRole('alert')).toContainText('Не пересобраны из-за объёма: 4')
  }
  expect(calls.filter(name => name.startsWith('previewSystemDocumentRebuild_'))).toHaveLength(previews)
  expect(calls.filter(name => name.startsWith('applySystemDocumentRebuild_'))).toHaveLength(applies)
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('four-kind-rebuild-completed.png') })
})
