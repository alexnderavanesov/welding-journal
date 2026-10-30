import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { deserializeRpcPayload, rpcName } from '../rpc'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { prepareSafariMeasurementWindow } from '../safari-foreground'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { measureJournalSaveInSafari } from '../journal-save-safari'
import { withE2eDatabase } from '../database'

const project = 'E2E stable journal'
const jointCount = process.env.SMOOTH_JOINT_COUNT === '200000' ? 200_000 : 9000
const baseline = process.env.JOURNAL_UPDATE_BASELINE === '1'
if (jointCount === 200_000) test.setTimeout(180_000)
const editor = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
const frame = (page: Page) => page.locator('[data-welding-journal-grid] .journal-grid-frame')
test.beforeAll(async () => {
  await withLineProgramFixture(async db => {
    // Reproduce the pre-change database when comparing the saved stage-1
    // bundle. This fixture helper is restricted to the disposable E2E DB.
    if (process.env.JOURNAL_REFRESH_BEFORE_INDEX === '1') await db.query('drop index if exists weld_joints_compact_line_identity_idx')
    if (process.env.JOURNAL_QUERY_BEFORE_INDEX === '1') await db.query('drop index if exists weld_joints_natural_joint_asc_idx, weld_joints_natural_joint_desc_idx')
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,officiality,isometry)
      select $1,'STABLE','STABLE-'||lpad(((n-1)/300+1)::text,greatest(2,length(((n-1)/300+1)::text)),'0'),'F98'||lpad(n::text,greatest(5,length(n::text)),'0'),'СШ','действующий','BEFORE'
      from generate_series(1,$2::int) n`, [project, jointCount])
    // A fresh 200k load otherwise races PostgreSQL's automatic statistics
    // refresh, producing incomparable plans between before/after repetitions.
    await db.query('analyze weld_joints')
  })
})

test('a malformed server response stays a local error; the next explicit open recovers without replaying the action', async ({ page }) => {
  await open(page)
  let calls = 0, navigations = 0
  page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++ })
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('getWeldJointById_')) {
      calls++
      if (calls === 1) return route.fulfill({ status: 502, headers: { 'content-type': '' }, body: '' })
    }
    await route.continue()
  })
  await editJournalJoint(page, 'F9800001')
  await expect(page.getByText(/Сервер вернул некорректный ответ \(HTTP 502\)/)).toBeVisible()
  expect(calls).toBe(1)
  expect(navigations).toBe(0)
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
  await editJournalJoint(page, 'F9800001')
  await expect(editor(page)).toBeVisible()
  expect(calls).toBe(2)
})

test('a failed lazy editor does not reload the page; manual recovery reopens the editor', async ({ page }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Tests the real production module boundary')
  await open(page)
  let navigations = 0
  page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++ })
  const asset = '**/assets/report-weld-editor-*.js'
  await page.route(asset, route => route.abort('failed'))
  await editJournalJoint(page, 'F9800001')
  const failure = page.getByRole('dialog', { name: 'Не удалось открыть окно' })
  await expect(failure).toBeVisible()
  expect(navigations).toBe(0)
  await page.unroute(asset)
  await failure.getByRole('button', { name: 'Обновить страницу' }).click()
  await expect(failure).toBeHidden()
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
  await editJournalJoint(page, 'F9800001')
  await expect(editor(page)).toBeVisible()
  expect(navigations).toBe(1)
})
test.afterAll(() => cleanupLineProgramProjects([project]))

test('installed Safari measured own save retains rows, groups and position', async ({}, info) => {
  test.skip(process.env.JOURNAL_SAVE_SAFARI !== '1', 'Requires the foreground local SafariDriver window')
  test.setTimeout(300_000)
  await writeFile(info.outputPath('safari-save.json'), JSON.stringify(await measureJournalSaveInSafari(project, jointCount, info.outputPath('safari-diagnostic.json')), null, 2))
})

test('a lost save response never replays a committed mutation and leaves the draft open', async ({ page }) => {
  await open(page)
  let writes = 0
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('updateWeldJoint_')) {
      writes++
      await route.fetch()
      return route.fulfill({ status: 502, headers: { 'content-type': '' }, body: '' })
    }
    await route.continue()
  })
  await editJournalJoint(page, 'F9800001')
  await editor(page).getByLabel('Изометрия', { exact: true }).fill('COMMITTED-RESPONSE-LOST')
  await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText(/Сервер вернул некорректный ответ \(HTTP 502\)/)).toBeVisible()
  await expect(editor(page).getByLabel('Изометрия', { exact: true })).toHaveValue('COMMITTED-RESPONSE-LOST')
  await page.waitForTimeout(1000)
  expect(writes).toBe(1)
  await withLineProgramFixture(async db => {
    expect((await db.query('select isometry from weld_joints where project_title=$1 and joint=$2', [project, 'F9800001'])).rows[0].isometry).toBe('COMMITTED-RESPONSE-LOST')
  })
})

test('another client deleting a selected joint leaves the table intact and refuses the stale operation', async ({ page }) => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints(project_title,line,joint,connection_type,officiality)
    values($1,'STABLE-00','F9810000','СШ','действующий')`, [project]).then(() => {}))
  await open(page, 9001)
  const checkbox = page.getByRole('checkbox', { name: 'Выбрать стык F9810000', exact: true })
  await checkbox.check()
  await withLineProgramFixture(db => db.query('delete from weld_joints where project_title=$1 and joint=$2', [project, 'F9810000']).then(() => {}))
  await page.getByRole('button', { name: 'F9810000', exact: true }).click({ button: 'right' })
  await expect(page.getByText(/Не удалось загрузить все выбранные стыки/)).toBeVisible()
  await expect(checkbox).toBeChecked()
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('button', { name: 'Обновить таблицу', exact: true }).click()
  await expect(page.getByText('Найдено: 9000', { exact: true })).toBeVisible()
  await expect(checkbox).toHaveCount(0)
})

test('regrouping after another writer refreshes selected totals with the installed row revision', async ({ page }) => {
  const setWdi = (wdi: number) => withLineProgramFixture(db => db.query(
    'update weld_joints set wdi=$1 where project_title=$2 and joint=$3', [wdi, project, 'F9800001']).then(() => {}))
  await setWdi(13)
  try {
    await open(page)
    await page.getByRole('checkbox', { name: 'Выбрать стык F9800001', exact: true }).check()
    await expect(page.getByText('WDI: 13', { exact: true })).toBeVisible()
    await setWdi(20)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText('Есть обновления', { exact: true })).toBeVisible()
    // The old view remains coherent until the user changes its grouping.
    await expect(page.getByText('WDI: 13', { exact: true })).toBeVisible()
    await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
    // Expanding through the row button can also select a cell range. Assert
    // checkbox totals first, while their source remains unchanged.
    await expect(page.locator('[data-journal-footer]')).toContainText('По выбранным')
    await expect(page.getByText('WDI: 20', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Развернуть группу STABLE-01', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Выбрать стык F9800001', exact: true })).toBeChecked()
  } finally {
    await withLineProgramFixture(db => db.query('update weld_joints set wdi=null where project_title=$1 and joint=$2', [project, 'F9800001']).then(() => {}))
  }
})

test('installed Safari keeps idle rows after another writer, opens fresh data and preserves a conflicting draft', async ({ page }, info) => {
  test.skip(process.env.JOURNAL_UPDATE_SAFARI !== '1', 'Requires the separate local SafariDriver window')
  test.setTimeout(180_000)
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value))
    return result.value
  }
  const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  const session = '/session/' + created.sessionId
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const wait = (script: string) => expect.poll(() => execute(script), { timeout: 20_000 }).toBe(true)
  const fill = async (selector: string, value: string) => {
    const element = await command(session + '/element', { using: 'css selector', value: selector })
    const path = session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf']
    // SafariDriver clear() can be reverted by a controlled React input before
    // sendKeys. Select the current text, then type through real input events.
    await execute(`const el=document.querySelector(arguments[0]);el.focus();el.select()`, selector)
    await command(path + '/value', { text: value })
  }
  try {
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await command(session + '/window', { handle: await command(session + '/window') })
    await prepareSafariMeasurementWindow(command, session)
    await command(session + '/url', { url: 'http://127.0.0.1:3100/journal' })
    await wait(`return !!document.querySelector('input[aria-label="Быстрый поиск по отчету"]')`)
    await execute(`localStorage.setItem('welding-report-view:v1:weldingJournal',JSON.stringify({activePreset:'custom',hiddenFieldKeys:arguments[0],customHiddenFieldKeys:arguments[0],collapsedSections:[],savedViews:[]}))`,
      WELD_FIELDS.filter(field => !['projectTitle','line','joint','isometry','finalStatus'].includes(field.key)).map(field => field.key))
    await command(session + '/refresh', {})
    await wait(`return !!document.querySelector('input[aria-label="Быстрый поиск по отчету"]')`)
    await fill('input[aria-label="Быстрый поиск по отчету"]', project)
    await wait(`return document.querySelector('.journal-grid-frame')?.getAttribute('aria-busy')==='false'&&document.body.innerText.includes('Найдено: 9000')`)
    await execute(`window.stabilityDocument='same';window.stabilityMutations=0;
      new MutationObserver(()=>{if(document.querySelector('.journal-grid-frame')?.getAttribute('aria-busy')==='true')window.stabilityMutations++})
      .observe(document.querySelector('.journal-grid-frame'),{attributes:true,attributeFilter:['aria-busy']});performance.clearResourceTimings()`)
    await open(page)
    const save = async (value: string) => {
      await editJournalJoint(page, 'F9800001')
      await editor(page).getByLabel('Изометрия', { exact: true }).fill(value)
      await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(editor(page)).toBeHidden()
      await page.waitForLoadState('networkidle')
    }
    await save('SAFARI-FRESH')
    await execute(`window.dispatchEvent(new Event('focus'))`)
    await wait(`return document.body.innerText.includes('Есть обновления')`)
    expect(await execute(`return [window.stabilityDocument,window.stabilityMutations]`)).toEqual(['same', 0])
    await execute(`document.querySelector('.ag-row[row-index="0"] [col-id="isometry"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
    await wait(`return !!document.querySelector('[role="dialog"] input[value="SAFARI-FRESH"]')`)
    const input = await execute(`const el=document.querySelector('[role="dialog"] input[value="SAFARI-FRESH"]');el.dataset.safariIsometry='';return true`)
    expect(input).toBe(true)
    await fill('[data-safari-isometry]', 'SAFARI-UNSAVED-DRAFT')
    await save('SAFARI-CONCURRENT')
    await execute(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Сохранить').click()`)
    await wait(`return document.body.innerText.includes('уже изменен другим пользователем')`)
    expect(await execute(`return document.querySelector('[data-safari-isometry]')?.value`)).toBe('SAFARI-UNSAVED-DRAFT')
    expect(await execute(`return window.stabilityDocument`)).toBe('same')
    await writeFile(info.outputPath('installed-safari.json'), JSON.stringify({ browser: created.capabilities.browserVersion,
      sample: await execute(`return {document:window.stabilityDocument,backgroundReloads:window.stabilityMutations,
        paths:performance.getEntriesByType('resource').filter(e=>e.name.includes('/_serverFn/')).map(e=>new URL(e.name).pathname)}`) }, null, 2))
  } catch (error) {
    await writeFile(info.outputPath('safari-failure.json'), JSON.stringify(await execute(`return {url:location.href,hidden:document.hidden,text:document.body.innerText,html:document.querySelector('[role=\"dialog\"]')?.outerHTML}`), null, 2))
    await writeFile(info.outputPath('safari-failure.png'), Buffer.from(await command(session + '/screenshot'), 'base64'))
    throw error
  } finally { await command(session, undefined, 'DELETE') }
})

test('a late saved-row refresh does not steal focus from a newer header interaction', async ({ page }) => {
  await open(page)
  await editJournalJoint(page, 'F9800001')
  await editor(page).getByLabel('Изометрия', { exact: true }).fill('KEEP-NEW-FOCUS')
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const pending = new Promise<void>(resolve => { started = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (/^readJournalGrid(?:Blocks)?_/.test(rpcName(route.request().url()))) { started(); await gate }
    await route.continue()
  })
  try {
    await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor(page)).toBeHidden()
    await pending
    const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
    await search.focus()
    release()
    await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
    await expect(frame(page).getByText('KEEP-NEW-FOCUS', { exact: true })).toBeVisible()
    await expect(search).toBeFocused()
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }) }
})

for (const layout of ['flat', 'single', 'nested']) test(`own save retains ${layout} groups, checked joint and deep scroll position`, async ({ page }, info) => {
  const nested = layout === 'nested'
  const savedValue = `PRESERVE-${layout}-${info.repeatEachIndex}`
  await open(page)
  if (nested) {
    await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Сгруппировать.*Проект/ }).click()
  }
  if (layout !== 'flat') {
    await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  }
  if (nested) await page.getByRole('button', { name: `Развернуть группу ${project}`, exact: true }).click()
  if (layout !== 'flat') await page.getByRole('button', { name: 'Развернуть группу STABLE-01', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Выбрать стык F9800001', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(y => scrollTo(0, y), nested ? 7000 : 1800)
  await page.waitForLoadState('networkidle')
  const visibleJoint = () => page.locator('.ag-row [col-id="joint"] button').evaluateAll(buttons => {
    const button = buttons.find(button => {
      const rect = button.getBoundingClientRect()
      return rect.top > 120 && rect.bottom < innerHeight - 100 &&
        button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
    })
    return button?.textContent?.trim()
  })
  await expect.poll(visibleJoint).toBeTruthy()
  const joint = await visibleJoint()
  const checkbox = page.getByRole('checkbox', { name: `Выбрать стык ${joint}`, exact: true })
  await checkbox.check()
  const before = await page.evaluate(() => scrollY)
  await editJournalJoint(page, joint!)
  await editor(page).getByLabel('Изометрия', { exact: true }).fill(savedValue)
  const sqlBefore = await auditSqlCount()
  const sqlDetailsBefore = await auditSqlDetails()
  const calls: string[] = []
  const rpcTimings: { name: string; milliseconds: number }[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('requestfinished', request => {
    if (request.url().includes('/_serverFn/')) rpcTimings.push({ name: rpcName(request.url()), milliseconds: request.timing().responseEnd })
  })
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-welding-journal-grid] .ag-row')]
    if (!rows.length) throw new Error('Measurement requires mounted grid rows')
    const start = performance.now(), y = scrollY
    let maxScrollShift = 0, frames = 0, missingFrames = 0, active = true
    const sample = () => {
      frames++; maxScrollShift = Math.max(maxScrollShift, Math.abs(scrollY-y))
      if (!rows.some(row => row.isConnected)) missingFrames++
      if (active) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    ;(window as unknown as { finishSmoothMeasure: () => unknown }).finishSmoothMeasure = () => {
      active = false
      return { elapsedMs: performance.now()-start, originalRows: rows.length,
        retainedRows: rows.filter(row => row.isConnected).length, maxScrollShift, frames, missingFrames }
    }
  })
  const started = performance.now()
  await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor(page)).toBeHidden()
  const savedMs = performance.now()-started
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false', { timeout: jointCount === 200_000 ? 30_000 : 5000 })
  await expect(frame(page).getByText(savedValue, { exact: true })).toBeVisible()
  const measurement = await page.evaluate(() => (window as unknown as { finishSmoothMeasure: () => unknown }).finishSmoothMeasure())
  const measuredCalls = [...calls]
  const sqlAfter = await auditSqlCount()
  const sqlDetailsAfter = await auditSqlDetails()
  await writeFile(info.outputPath('smooth-refresh.json'), JSON.stringify({ layout, jointCount, savedMs, measurement,
    calls: measuredCalls, rpcTimings, sqlDetailsBefore, sqlDetailsAfter,
    sqlStatements: sqlBefore === undefined || sqlAfter === undefined ? undefined : sqlAfter - sqlBefore }, null, 2))
  const blockCalls = calls.filter(name => /^readJournalGrid(?:Blocks)?_/.test(name))
  if (baseline || process.env.JOURNAL_REFRESH_BEFORE_INDEX === '1') expect(blockCalls.length).toBeLessThanOrEqual(12)
  else expect(blockCalls).toHaveLength(1)
  expect((measurement as { originalRows: number }).originalRows).toBeLessThanOrEqual(80)
  expect((measurement as { retainedRows: number }).retainedRows).toBeGreaterThan(0)
  expect((measurement as { maxScrollShift: number }).maxScrollShift).toBe(0)
  await page.waitForLoadState('networkidle')
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before)
  await expect(checkbox).toBeChecked()
  await expect(frame(page).getByText(savedValue, { exact: true })).toBeVisible()
  await page.evaluate(() => scrollTo(0, 0))
  if (layout !== 'flat') await expect(page.getByRole('button', { name: 'Свернуть группу STABLE-01', exact: true })).toBeVisible()
})

test('rapid repeated cell edits keep server facts and displayed values aligned', async ({ page }, info) => {
  for (const layout of ['flat', 'single', 'nested']) {
    await open(page)
    await page.evaluate(() => Object.keys(localStorage).filter(key => key === 'welding-journal-ag-grid:v1' || key.startsWith('welding-user:') && key.endsWith(':welding-journal-ag-grid:v1')).forEach(key => localStorage.removeItem(key)))
    await open(page)
    for (const field of layout === 'nested' ? ['projectTitle', 'line'] : layout === 'single' ? ['line'] : []) {
      await page.locator(`.ag-header-cell[col-id="${field}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    for (const key of layout === 'nested' ? [project, 'STABLE-01'] : layout === 'single' ? ['STABLE-01'] : []) {
      await page.getByRole('button', { name: `Развернуть группу ${key}`, exact: true }).click()
    }
    await expect(page.getByRole('checkbox', { name: 'Выбрать стык F9800001', exact: true })).toBeVisible()
    await page.evaluate(() => scrollTo(0, 1800))
    const target = () => page.locator('.ag-row [col-id="isometry"]').evaluateAll(cells => {
      const cell = cells.find(cell => cell.closest('.ag-row')?.querySelector('[col-id="joint"] button') &&
        cell.getBoundingClientRect().top > 150 && cell.getBoundingClientRect().bottom < innerHeight - 50)
      return cell?.closest('.ag-row')?.getAttribute('row-id')
    })
    await expect.poll(target).toBeTruthy()
    const id = (await target())!, value = `RAPID-${layout}-${info.repeatEachIndex}`
    const cell = page.locator(`.ag-row[row-id="${id}"] [col-id="isometry"]`)
    await cell.dblclick()
    await editor(page).getByLabel('Изометрия', { exact: true }).fill(value)
    await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor(page)).toBeHidden()
    const stored = await withE2eDatabase(async db => (await db.query('select id,joint,isometry from weld_joints where id=$1', [Number(id)])).rows[0])
    await writeFile(info.outputPath(`rapid-${layout}.json`), JSON.stringify({ id, value, stored }))
    expect(stored.isometry).toBe(value)
    await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
    await expect(cell).toContainText(value)
  }
})

for (const outcome of ['success', 'failure', 'filter', 'conflict', 'regroup']) test(`smooth refresh keeps rows and guards incomplete groups: ${outcome}`, async ({ page }) => {
  await open(page)
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  await page.getByRole('button', { name: 'Развернуть группу STABLE-01', exact: true }).click()
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
  await page.waitForLoadState('networkidle')
  const row = page.locator('.ag-row').filter({ has: page.getByRole('button', { name: 'F9800001', exact: true }) })
  const original = await row.elementHandle()
  await editJournalJoint(page, 'F9800001')
  const value = `SMOOTH-${outcome}`
  await editor(page).getByLabel('Изометрия', { exact: true }).fill(value)
  let release!: () => void, started!: () => void, held = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const pending = new Promise<void>(resolve => { started = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (/^readJournalGrid(?:Blocks)?_/.test(rpcName(route.request().url()))) {
      const payload = deserializeRpcPayload(route.request().postData()!) as { data: { route?: string[]; blocks?: { route: string[] }[] } }
      if (!held && (payload.data.route?.includes('STABLE-01') || payload.data.blocks?.some(block => block.route.includes('STABLE-01')))) {
        held = true; started(); await gate
        if (outcome === 'failure') return route.fulfill({ status: 502, body: '' })
      }
    }
    await route.continue()
  })
  try {
    await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor(page)).toBeHidden()
    await pending
    await expect(frame(page)).toHaveAttribute('aria-busy', 'true')
    expect(await original!.evaluate(node => node.isConnected)).toBe(true)
    await expect(page.getByRole('checkbox', { name: 'Выбрать стык F9800001', exact: true })).toBeDisabled()
    if (outcome === 'filter') {
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F9800400')
    }
    if (outcome === 'regroup') {
      await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
      await page.getByRole('menuitem', { name: /Сгруппировать.*Проект/ }).click()
    }
    if (outcome === 'conflict') await withLineProgramFixture(db => db.query(
      'update weld_joints set isometry=$1 where project_title=$2 and joint=$3',
      [value + '-foreign', project, 'F9800001']).then(() => {}))
    release()
    if (outcome === 'failure') {
      await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
    }
    await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
    if (outcome === 'filter') await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
    else {
      if (outcome === 'regroup') for (const key of ['STABLE-01', project]) {
        const expand = page.getByRole('button', { name: `Развернуть группу ${key}`, exact: true })
        await expect(expand.or(page.getByRole('button', { name: `Свернуть группу ${key}`, exact: true }))).toBeVisible()
        if (await expand.count()) await expand.first().click()
      }
      await expect(row).toContainText(outcome === 'conflict' ? value + '-foreign' : value)
    }
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); await original?.dispose() }
})

async function open(page: Page, count = jointCount) {
  await page.addInitScript(hidden => {
    localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({ activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
  }, WELD_FIELDS.filter(field => !['projectTitle','line','joint','isometry','finalStatus'].includes(field.key)).map(field => field.key))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: jointCount === 200_000 ? 120_000 : 10_000 })
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
  await page.waitForLoadState('networkidle')
}

for (const action of ['sort', 'filter', 'group', 'nested-group'] as const) test(`measured selection change: ${action}`, async ({ page }, info) => {
  test.skip(process.env.JOURNAL_REFRESH_BENCHMARK !== '1', 'Opt-in comparison on the isolated benchmark fixture')
  await open(page)
  if (action === 'nested-group') {
    await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Сгруппировать.*Проект/ }).click()
    await expect(frame(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
  }
  if (action !== 'filter') await page.locator(`.ag-header-cell[col-id="${action === 'sort' ? 'joint' : 'line'}"]`).click({ button: 'right' })
  const statementsBefore = await auditSqlCount(), detailsBefore = await auditSqlDetails()
  const calls: { name: string; milliseconds: number }[] = []
  page.on('requestfinished', request => {
    if (request.url().includes('/_serverFn/')) calls.push({ name: rpcName(request.url()), milliseconds: request.timing().responseEnd })
  })
  const started = performance.now()
  if (action === 'filter') {
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F9800001')
    await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible({ timeout: 30_000 })
  } else if (action === 'sort') {
    await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
    await expect(page.locator('.ag-header-cell[col-id="joint"]')).toHaveAttribute('aria-sort', 'descending')
  } else {
    await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
    await expect(page.getByRole('button', { name: `Развернуть группу ${action === 'nested-group' ? project : 'STABLE-01'}`, exact: true })).toBeVisible({ timeout: 30_000 })
  }
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  const milliseconds = performance.now() - started
  await page.waitForLoadState('networkidle')
  const statementsAfter = await auditSqlCount(), detailsAfter = await auditSqlDetails()
  await writeFile(info.outputPath('selection-change.json'), JSON.stringify({ action, jointCount, milliseconds, calls,
    statements: statementsBefore === undefined || statementsAfter === undefined ? undefined : statementsAfter - statementsBefore,
    detailsBefore, detailsAfter }, null, 2))
  expect(calls.filter(call => /^readJournalGrid(?:Blocks)?_/.test(call.name)).length).toBeLessThanOrEqual(4)
})

test('other writer, return to window and idle selection keep the displayed rows; fresh editor and conflict preserve the draft', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: `http://127.0.0.1:${process.env.E2E_PORT || 3100}`, viewport: { width: 1600, height: 1000 } })
  const writer = await context.newPage()
  const calls: string[] = [], measures: Record<string, unknown>[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  try {
    await open(page); await open(writer)
    const first = page.getByRole('checkbox', { name: 'Выбрать стык F9800001', exact: true })
    await first.check()
    await page.waitForLoadState('networkidle')
    const save = async (value: string) => {
      const started = performance.now()
      await editJournalJoint(writer, 'F9800001')
      const opened = performance.now()
      await editor(writer).getByLabel('Изометрия', { exact: true }).fill(value)
      const saving = performance.now()
      await editor(writer).getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(editor(writer)).toBeHidden()
      const saved = performance.now()
      await expect(frame(writer)).toHaveAttribute('aria-busy', 'false')
      await writer.waitForLoadState('networkidle')
      measures.push({ value, openMs: opened-started, saveMs: saved-saving, readyMs: performance.now()-saving })
    }
    await save('AFTER-OTHER-WRITER')
    const before = calls.length
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(1800)
    await page.locator('.ag-row[row-index="0"] [col-id="isometry"]').click()
    await page.waitForTimeout(1000)
    const observation = { baseline, calls: calls.slice(before), body: await frame(page).innerText(), measures }
    await writeFile(info.outputPath('journal-update-measurements.json'), JSON.stringify(observation, null, 2))
    if (baseline) return
    await expect(page.getByText('Есть обновления', { exact: true })).toBeVisible()
    await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
    expect(calls.slice(before).filter(name => /^(readJournalGrid(?:Blocks)?|refreshDispatcherTaskSnapshot|getDispatcherTaskSnapshot)_/.test(name))).toEqual([])
    await expect(first).toBeChecked()
    await editJournalJoint(page, 'F9800001')
    await expect(editor(page).getByLabel('Изометрия', { exact: true })).toHaveValue('AFTER-OTHER-WRITER')
    await editor(page).getByLabel('Изометрия', { exact: true }).fill('MY-UNSAVED-DRAFT')
    await save('SECOND-WRITER-VALUE')
    await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.getByText(/уже изменен другим пользователем/)).toBeVisible()
    await expect(editor(page).getByLabel('Изометрия', { exact: true })).toHaveValue('MY-UNSAVED-DRAFT')
    await editor(page).getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.getByRole('button', { name: 'Обновить таблицу', exact: true }).click()
    await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByText('Есть обновления', { exact: true })).toBeHidden()
    await expect(frame(page).getByText('SECOND-WRITER-VALUE', { exact: true })).toBeVisible()
    await expect(first).toBeChecked()
  } finally { await context.close().catch(() => {}) }
})
