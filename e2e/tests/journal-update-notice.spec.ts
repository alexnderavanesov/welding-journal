import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { editJournalJoint } from '../journal-grid'
import { rpcName } from '../rpc'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { prepareSafariMeasurementWindow } from '../safari-foreground'

const project = 'E2E stable journal'
const baseline = process.env.JOURNAL_UPDATE_BASELINE === '1'
const editor = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
const frame = (page: Page) => page.locator('[data-welding-journal-grid] .journal-grid-frame')
test.beforeAll(async () => {
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,officiality,isometry)
      select $1,'STABLE','STABLE-'||lpad(((n-1)/300+1)::text,2,'0'),'F98'||lpad(n::text,5,'0'),'СШ','действующий','BEFORE'
      from generate_series(1,9000) n`, [project])
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
    if (rpcName(route.request().url()).startsWith('readJournalGrid_')) { started(); await gate }
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

for (const nested of [false, true]) test(`own save retains ${nested ? 'nested' : 'single'} groups, checked joint and deep scroll position`, async ({ page }) => {
  await open(page)
  if (nested) {
    await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Сгруппировать.*Проект/ }).click()
  }
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  if (nested) await page.getByRole('button', { name: `Развернуть группу ${project}`, exact: true }).click()
  await page.getByRole('button', { name: 'Развернуть группу STABLE-01', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Выбрать стык F9800001', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(y => scrollTo(0, y), nested ? 7000 : 1800)
  await page.waitForLoadState('networkidle')
  const visibleJoint = () => page.locator('.ag-row [col-id="joint"] button').evaluateAll(buttons => {
    const button = buttons.find(button => { const rect = button.getBoundingClientRect(); return rect.top > 120 && rect.bottom < innerHeight - 100 })
    return button?.textContent?.trim()
  })
  await expect.poll(visibleJoint).toBeTruthy()
  const joint = await visibleJoint()
  const checkbox = page.getByRole('checkbox', { name: `Выбрать стык ${joint}`, exact: true })
  await checkbox.check()
  const before = await page.evaluate(() => scrollY)
  await editJournalJoint(page, joint!)
  await editor(page).getByLabel('Изометрия', { exact: true }).fill('PRESERVE-POSITION')
  await editor(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor(page)).toBeHidden()
  await page.waitForLoadState('networkidle')
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before)
  await expect(checkbox).toBeChecked()
  await expect(frame(page).getByText('PRESERVE-POSITION', { exact: true })).toBeVisible()
  await page.evaluate(() => scrollTo(0, 0))
  await expect(page.getByRole('button', { name: 'Свернуть группу STABLE-01', exact: true })).toBeVisible()
})

async function open(page: Page, count = 9000) {
  await page.addInitScript(hidden => {
    localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({ activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
  }, WELD_FIELDS.filter(field => !['projectTitle','line','joint','isometry','finalStatus'].includes(field.key)).map(field => field.key))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible()
  await expect(frame(page)).toHaveAttribute('aria-busy', 'false')
  await page.waitForLoadState('networkidle')
}

test('other writer, return to window and idle selection keep the displayed rows; fresh editor and conflict preserve the draft', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT || 3100}`, viewport: { width: 1600, height: 1000 } })
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
    expect(calls.slice(before).filter(name => /^(readJournalGrid|refreshDispatcherTaskSnapshot|getDispatcherTaskSnapshot)_/.test(name))).toEqual([])
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
