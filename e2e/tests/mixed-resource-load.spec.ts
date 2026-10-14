import { setTimeout as pause } from 'node:timers/promises'
import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { observeMixedClient, sampleMixedResources } from '../mixed-resource-telemetry'
import { auditSqlCount } from '../audit-sql'
import { rpcName } from '../rpc'
import { getReportImportTemplateFields } from '../../src/lib/report-import-template'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { buildCurrentSystemDocumentName } from '../../src/lib/system-document-types'
import { confirmDocumentOperation, openDocumentOperation } from '../document-operation-ui'

const project = 'E2E mixed resources 200k'
const writerJoint = 'F001001'
const getWriter = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where project_title=$1 and joint=$2', [project, writerJoint])).rows[0])
const fresh = () => withE2eDatabase(async db => (await db.query('select source_revision=computed_revision and not full_rebuild as fresh from dispatcher_task_index_state where id=1')).rows[0]?.fresh)

async function createWelder(page: Page) {
  await page.goto('/welder-stamps')
  await page.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Клеймо НАКС', { exact: true }).fill('MIX1')
  await dialog.getByLabel('ФИО сварщика', { exact: true }).fill('Смешанная нагрузка')
  await dialog.getByRole('button', { name: 'Добавить ДЛС', exact: true }).click()
  for (const editor of await dialog.locator('[data-permit-editor-id]').all()) {
    for (const value of ['РАД', 'М01', 'М05']) {
      const button = editor.getByRole('button', { name: value, exact: true })
      if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
    }
    for (const [label, value] of [['Диаметр от', '1'], ['Диаметр до', '500'], ['Толщина от', '1'], ['Толщина до', '20'],
      ['Срок от', '2026-01-01'], ['Срок до', '2026-12-31']]) await editor.getByLabel(label, { exact: true }).fill(value)
  }
  await dialog.locator('[data-permit-editor-id]').last().getByLabel('Номер ДЛС', { exact: true }).fill('ДЛС-MIX1')
  await dialog.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function seed() {
  const names = Array.from({ length: 200 }, (_, i) => buildCurrentSystemDocumentName({ type: 'lnkRequest', title: '', date: '2026-09-02' }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, i + 1))
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int n from weld_joints')).rows[0].n).toBe(1)
    await db.query(`insert into app_settings(key,value) values ('request-conclusion',$1) on conflict(key) do update set value=excluded.value`,
      [JSON.stringify({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkRequest: 'line' } })])
    for (const groups of [['М01'], ['М01', 'М05']]) {
      const card = (await db.query(`insert into technology_cards(name,welding_methods,connection_type,material_groups,
        diameter_from,diameter_to,thickness_from,thickness_to,psto,first_used_at)
        values ($1,array['РАД'],'С17',$2,1,500,1,20,'any',now()) returning id,name`, [`MIX ТК ${groups.length}`, groups])).rows[0]
      await db.query('insert into technology_card_names(name,technology_card_id) values($1,$2)', [card.name, card.id])
    }
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'MIX','MIX-L'||lpad(n::text,4,'0'),'II','Б(а)',0,0 from generate_series(1,1000) n`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,isometry,weld_date,
      officiality,revision_actuality,connection_type,material_group,welding_method,d1,t1,d2,t2,category,group_name,
      weld_control_percent,pvk_control_percent,stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,psto_required,vik_request,vik_request_date,technology_card_number)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,6,'0'),'MIX-ISO','2026-09-01',
        'действующий','актуальная','С17',case when n between 10001 and 10003 then 'М01 + М05' else 'М01' end,
        'РАД',108,6,108,8,'II','Б(а)',0,0,'MIX1','MIX1','MIX1','MIX1','MIX1','MIX1','да','нет',
        case when n<=400 then ($2::text[])[(n-1)%200+1] end,case when n<=400 then date '2026-09-02' end,
        case when n between 10001 and 10003 then 'MIX ТК 2' when n%40=0 then null else 'MIX ТК 1' end
      from generate_series(1,200000) n join line_programs p on p.project_title=$1 and p.line='MIX-L'||lpad(((n-1)/200+1)::text,4,'0')`, [project, names])
    await db.query('analyze weld_joints')
  })
  // SQL fixture insertion bypasses the save workflow. Index only the 400
  // document-bearing rows; dispatcher cold rebuild must run in the container.
  const [{ requireDb }, { weldJoints }, { and, eq, isNotNull }, { syncSystemDocumentsForWeldChangesInTransaction }] = await Promise.all([
    import('../../src/db'), import('../../src/db/schema'), import('drizzle-orm'), import('../../src/server/system-document-index'),
  ])
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(and(eq(weldJoints.projectTitle, project), isNotNull(weldJoints.vikRequest)))
    expect(rows).toHaveLength(400)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  await withE2eDatabase(db => db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'"))
}

const preservedFacts = () => withE2eDatabase(async db => (await db.query(`select count(*)::int n,
  md5(string_agg(md5((to_jsonb(w)-'final_status')::text),'' order by id)) hash from weld_joints w
  where project_title=$1 and joint>'F000400' and joint<='F200000' and joint<>$2`, [project, writerJoint])).rows[0])
const coldFacts = () => withE2eDatabase(async db => ({
  welds: (await db.query(`select count(*)::int n,md5(string_agg(md5((to_jsonb(w)-'final_status')::text),'' order by id)) hash
    from weld_joints w where project_title=$1`, [project])).rows[0],
  documents: (await db.query(`select count(*)::int n,md5(string_agg(md5(to_jsonb(d)::text),'' order by id)) hash from generated_documents d`)).rows[0],
  links: (await db.query(`select count(*)::int n,md5(string_agg(md5(to_jsonb(a)::text),'' order by document_id,weld_joint_id)) hash from generated_document_weld_joints a`)).rows[0],
}))

async function openEditor(page: Page) {
  await page.getByRole('button', { name: writerJoint, exact: true }).locator('xpath=ancestor::tr').getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await editor.getByRole('button', { name: 'Стык', exact: true }).first().click()
  return editor
}

test('200k, five browser clients, mixed reads/writes/import/documents under hard 2 CPU / 2 GiB', async ({ browser }, info) => {
  test.skip(process.env.AUDIT_MIXED_LOAD !== '1', 'Separate opt-in, freshly built container and disposable database')
  const roles = ['reports', 'program-dispatcher', 'writer', 'import', 'documents-permits']
  const contexts = await Promise.all(roles.map(() => browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport: { width: 1600, height: 1000 } })))
  for (const context of contexts) { context.setDefaultTimeout(45_000); context.setDefaultNavigationTimeout(90_000) }
  const telemetry = contexts.map((context, i) => observeMixedClient(context, roles[i]))
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  let stopSampling: Awaited<ReturnType<typeof sampleMixedResources>> | undefined
  const timings: Array<{ role: string; round: number; milliseconds: number }> = []
  let imports = 0, saves = 0, failureInjected = false
  let coldBaseline: Awaited<ReturnType<typeof coldFacts>> | undefined, steadyStarted = false
  let untouchedBaseline: Awaited<ReturnType<typeof preservedFacts>> | undefined
  const waitForDispatcher = async () => {
    const started = performance.now()
    while (!await fresh()) {
      expect(telemetry.flatMap(client => client.errors)).toEqual([])
      expect(performance.now() - started, 'Dispatcher must finish within three minutes').toBeLessThan(180_000)
      await pause(1000)
    }
  }
  try {
    await createWelder(pages[4])
    await seed()
    const before = await preservedFacts(), writerBefore = await getWriter()
    untouchedBaseline = before
    expect(before.n).toBe(199599)
    const documentFacts = await withE2eDatabase(async db => (await db.query(`select id,joint,weld_date,material_group,d1,d2,t1,t2,stamp_1_k_fact,vik_request_date from weld_joints where project_title=$1 and joint<='F000400' order by id`, [project])).rows)
    coldBaseline = await coldFacts()
    stopSampling = await sampleMixedResources(browser)
    const coldSql = await auditSqlCount(), coldStart = performance.now()
    const diagnostic = process.env.AUDIT_MIXED_DIAGNOSTIC
    if (diagnostic && diagnostic !== 'reports-only') throw new Error('Unknown local diagnostic profile')
    await Promise.all(pages.map((page, i) => page.goto(diagnostic ? '/journal' : ['/journal', '/line-program', '/journal', '/journal', '/settings'][i])))
    await waitForDispatcher()
    console.log(JSON.stringify({ phase: 'mixed cold 200k', milliseconds: Math.round(performance.now() - coldStart), sql: (await auditSqlCount())! - coldSql! }))
    if (diagnostic) {
      await expect.poll(() => telemetry.every(client => client.pending.size === 0)).toBe(true)
      console.log(JSON.stringify({ phase: 'ISOLATION ONLY — NOT MIXED ACCEPTANCE', diagnostic }))
      return
    }
    await pages[2].getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(writerJoint)
    await expect(pages[2].getByRole('button', { name: writerJoint, exact: true })).toBeVisible()
    const sqlStart = await auditSqlCount(), start = performance.now(), duration = 180_000
    steadyStarted = true
    let stopped = false
    const run = async (role: number, action: (round: number) => Promise<void>) => {
      let round = 0
      do {
        const began = performance.now()
        await action(round)
        timings.push({ role: roles[role], round, milliseconds: Math.round(performance.now() - began) })
        console.log(JSON.stringify({ phase: 'mixed operation', ...timings.at(-1) }))
        round++
        await pause(1500)
      } while (!stopped && performance.now() - start < duration)
    }
    const tasks = [
      run(0, async round => {
        const page = pages[0]
        await page.goto(round % 2 ? '/lnk' : '/journal')
        await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F001')
        await expect(page.getByRole('button', { name: writerJoint, exact: true })).toBeVisible()
        await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
        await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
        const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
        await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(100)
        await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
      }),
      run(1, async round => {
        const page = pages[1]
        await page.goto('/line-program')
        await page.getByLabel('Поиск программы линий', { exact: true }).fill(`MIX-L${round % 2 ? '0002' : '0001'}`)
        const card = page.getByTestId('line-program-card')
        await expect(card).toHaveCount(1)
        await card.getByRole('button', { name: 'Учитываемых соединений 200', exact: true }).click()
        await expect(card.getByTestId('line-program-readonly-joint')).toHaveCount(50)
        await page.goto('/journal')
        await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер' }).click()
        const dialog = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Закрыть диспетчер', exact: true }).click()
      }),
      run(2, async round => {
        const page = pages[2]
        if (round === 0) {
          const cancelled = await openEditor(page)
          await cancelled.getByLabel('Изометрия', { exact: true }).fill('DO-NOT-SAVE')
          await cancelled.getByRole('button', { name: 'Отмена', exact: true }).click()
          expect((await getWriter()).isometry).toBe(writerBefore.isometry)
        }
        const editor = await openEditor(page), value = `MIX-UI-${round}`
        await editor.getByLabel('Изометрия', { exact: true }).fill(value)
        if (round === 0) {
          await page.route('**/_serverFn/**', async route => {
            if (!failureInjected && rpcName(route.request().url()).startsWith('updateWeldJoint')) {
              failureInjected = true
              telemetry[2].expectInjectedNetworkFailure(route.request())
              await route.abort('failed')
            } else await route.continue()
          })
          await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
          await expect.poll(() => failureInjected).toBe(true)
          await expect(editor.getByLabel('Изометрия', { exact: true })).toHaveValue(value)
          expect((await getWriter()).isometry).toBe(writerBefore.isometry)
          await page.unroute('**/_serverFn/**')
        }
        await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
        await expect(editor).toBeHidden()
        expect((await getWriter()).isometry).toBe(value)
        saves++
      }),
      run(3, async round => {
        const page = pages[3]
        await page.getByRole('button', { name: 'Импорт', exact: true }).click()
        const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Импорт данных', exact: true }) })
        const download = page.waitForEvent('download')
        await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
        expect(await (await download).failure()).toBeNull()
        const fields = getReportImportTemplateFields('weldingJournal')
        const rows = Array.from({ length: 20 }, (_, i) => {
          const values: Record<string, string | number> = { projectTitle: project, subtitleCode: 'MIX', line: 'MIX-L1000',
            joint: `F${300001 + round * 20 + i}`, category: 'II', groupName: 'Б(а)', weldControlPercent: 0,
            weldDate: '2026-09-01', weldingMethod: 'РАД', connectionType: 'С17', materialGroup: 'М01',
            d1: 108, d2: 108, t1: 6, t2: 8, stamp1KFact: 'MIX1', stamp1ZFact: 'MIX1', stamp1OFact: 'MIX1' }
          return fields.map(field => values[field.key] ?? '')
        })
        const csv = '\uFEFF' + [fields.map(field => field.label), ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
        await dialog.locator('input[type=file]').setInputFiles({ name: `mixed-${round}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) })
        const apply = dialog.getByRole('button', { name: 'Импортировать 20 строк', exact: true })
        await expect(apply).toBeEnabled()
        await apply.click()
        await expect(dialog).toBeHidden()
        imports += 20
        expect(await withE2eDatabase(async db => (await db.query("select count(*)::int n from weld_joints where project_title=$1 and joint>='F300000'", [project])).rows[0].n)).toBe(imports)
      }),
      run(4, async round => {
        const page = pages[4]
        if (round === 0) {
          const names = await withE2eDatabase(async db => (await db.query('select distinct vik_request as name from weld_joints where project_title=$1 and vik_request is not null order by name', [project])).rows.map(row => row.name as string))
          const dialog = await openDocumentOperation(page, names, 'Заявка ЛНК')
          await expect(dialog.getByRole('button', { name: 'Подтвердить и применить', exact: true })).toBeEnabled()
          await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
          expect(await withE2eDatabase(async db => (await db.query('select count(distinct vik_request)::int n from weld_joints where project_title=$1', [project])).rows[0].n)).toBe(200)
          await openDocumentOperation(page, names, 'Заявка ЛНК')
          await confirmDocumentOperation(dialog, 1, 90_000)
          await dialog.getByRole('button', { name: 'Остановиться / закрыть', exact: true }).click()
          expect(await withE2eDatabase(async db => (await db.query('select count(distinct vik_request)::int n from weld_joints where project_title=$1', [project])).rows[0].n)).toBe(400)
        }
        await page.goto('/welder-stamps')
        await page.getByText('MIX1', { exact: true }).first().click()
        // One real remove/restore pair triggers two global recalculations while
        // the other four clients keep working. Later rounds are read-only.
        if (round < 2) {
          await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
          const dialog = page.getByRole('dialog')
          for (const editor of await dialog.locator('[data-permit-editor-id]').all()) await editor.getByRole('button', { name: 'М05', exact: true }).click()
          await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
          await expect(dialog).toBeHidden()
          await waitForDispatcher()
          expect(await withE2eDatabase(async db => (await db.query(`select count(*)::int n from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id where w.project_title=$1 and t.code='СП-02'`, [project])).rows[0].n)).toBe(round === 0 ? 3 : 0)
        }
      }),
    ].map((task, role) => task.catch(async error => {
      console.error(JSON.stringify({ phase: 'mixed operation failed', role: roles[role], error: String(error) }))
      if (!stopped) {
        stopped = true
        await Promise.all(pages.map(async (page, i) => {
          await info.attach(`mixed-failure-${roles[i]}`, { body: await page.locator('body').innerText({ timeout: 3000 }).catch(() => ''), contentType: 'text/plain' })
          await page.close()
        }))
      }
      throw error
    }))
    const results = await Promise.allSettled(tasks)
    console.log(JSON.stringify({ phase: 'mixed steady', milliseconds: Math.round(performance.now() - start), sql: (await auditSqlCount())! - sqlStart!, saves, imports, failureInjected, operations: timings }))
    for (const result of results) if (result.status === 'rejected') throw result.reason
    expect(saves).toBeGreaterThanOrEqual(2); expect(imports).toBeGreaterThanOrEqual(40)
    expect(timings.filter(value => value.role === roles[4]).length).toBeGreaterThanOrEqual(2)
    expect(await preservedFacts()).toEqual(before)
    expect(await withE2eDatabase(async db => (await db.query(`select id,joint,weld_date,material_group,d1,d2,t1,t2,stamp_1_k_fact,vik_request_date from weld_joints where project_title=$1 and joint<='F000400' order by id`, [project])).rows)).toEqual(documentFacts)
    expect(await withE2eDatabase(async db => (await db.query('select count(*)::int n,count(distinct joint)::int unique_n from weld_joints where project_title=$1', [project])).rows[0])).toEqual({ n: 200000 + imports, unique_n: 200000 + imports })
    expect(await withE2eDatabase(async db => (await db.query("select count(*)::int n from weld_joints where project_title=$1 and joint>='F300000' and technology_card_number='MIX ТК 1'", [project])).rows[0].n)).toBe(imports)
    await waitForDispatcher()
    // Settle all stale clients once, then prove focus/reconnect does not cause
    // polling or reload the reports on an unchanged version.
    const focus = () => Promise.all(pages.map(page => page.evaluate(() => {
      for (let n = 0; n < 10; n++) { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) }
    })))
    await focus(); await pause(6000)
    await expect.poll(() => telemetry.every(client => client.pending.size === 0)).toBe(true)
    const beforeQuiet = telemetry.map(client => client.calls.length), quietSql = await auditSqlCount()
    await pause(6500)
    expect(telemetry.map(client => client.calls.length)).toEqual(beforeQuiet)
    expect(await auditSqlCount()).toBe(quietSql)
    await focus(); await pause(2000)
    await expect.poll(() => telemetry.every(client => client.pending.size === 0)).toBe(true)
    for (const [index, client] of telemetry.entries()) {
      const extra = client.calls.slice(beforeQuiet[index])
      expect(extra.length).toBeLessThanOrEqual(1)
      expect(extra.every(call => call.name.startsWith('getDispatcherTaskVersion'))).toBe(true)
    }
    console.log(JSON.stringify({ phase: 'mixed quiet/focus', quietMilliseconds: 6500, focusSql: (await auditSqlCount())! - quietSql!, focusCalls: telemetry.map((client, i) => client.calls.slice(beforeQuiet[i])) }))
    await pages[1].screenshot({ path: info.outputPath('mixed-final-program.png') })
  } finally {
    for (const client of telemetry) {
      console.log(JSON.stringify({ phase: 'mixed client', ...await client.summary() }))
    }
    const resources = await stopSampling?.()
    console.log(JSON.stringify({ phase: 'mixed resources', ...resources }))
    await Promise.all(contexts.map(context => context.close()))
    // Assert after releasing observers and browsers, including on failure.
    // Same 200k/five-client fixture previously sent snapshots up to 5.24 MB.
    for (const client of telemetry) {
      for (const call of client.calls.filter(call => /^(get|refresh)DispatcherTaskSnapshot/.test(call.name))) {
        expect(call.bytes).toBeLessThan(1_000_000)
      }
    }
    if (untouchedBaseline) {
      expect(await preservedFacts()).toEqual(untouchedBaseline)
      console.log(JSON.stringify({ phase: 'untouched facts preserved', ...untouchedBaseline }))
    }
    if (coldBaseline && !steadyStarted) {
      const after = await coldFacts()
      expect(after).toEqual(coldBaseline)
      console.log(JSON.stringify({ phase: 'cold facts preserved', afterCrash: resources?.postmortem ?? false, ...after }))
    }
    expect(telemetry.flatMap(client => client.errors)).toEqual([])
    if (resources) {
      expect(resources.errors).toEqual([])
      expect(resources.lastCgroup['memory.events']).toMatch(/oom_kill 0/)
      expect(Number(resources.lastCgroup['memory.peak'])).toBeLessThan(2 * 1024 ** 3)
      // Original fixture has whole 200-row lines. Summaries must not hydrate
      // the 200k-row journal at once, even during overlapping invalidations.
      expect(resources.server.resources.reads.weld_joints_join_line_programs.maxRows).toBeLessThanOrEqual(10_000)
      expect(resources.server.resources.reads.weld_joints.maxWideRows).toBeLessThanOrEqual(5_000)
    }
  }
})
