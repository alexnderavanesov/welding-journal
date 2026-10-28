import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { prepareSafariMeasurementWindow } from '../safari-foreground'

const fixtureProject = 'E2E header keyboard'
test.beforeAll(async () => withLineProgramFixture(async db => {
  const { rows: [joint] } = await db.query(
    `insert into weld_joints(project_title,line,joint,weld_date,officiality,revision_actuality,has_vik,psto_required)
     values($1,'HEADER-L1','HEADER-F1','2026-10-01','действующий','актуальная','да','да') returning id`, [fixtureProject])
  if (process.env.INSTALLED_SAFARI_KEYBOARD === '1') {
    const { rows: documents } = await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','SAFARI-CLIP-'||lpad(n::text,3,'0'),'keyboard.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1
      from generate_series(1,110) n returning id`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select unnest($1::int[]),$2`, [documents.map(document => document.id), joint.id])
  }
}))
test.afterAll(async () => { await cleanupLineProgramProjects([fixtureProject]) })

for (const route of ['/', '/lnk', '/psto']) test(`header focus stays visible after click and arrow traversal: ${route}`, async ({ page }) => {
  await page.goto(route)
  await page.getByRole('searchbox').fill(fixtureProject)
  const grid = page.locator('[data-weld-report-grid]')
  const project = grid.locator('.ag-header-cell[col-id="projectTitle"]')
  await expect(grid.locator('.ag-cell[col-id="joint"]').first()).toHaveText('HEADER-F1')
  await project.locator('.ag-header-cell-text').click()
  await expect(project).toBeFocused()
  await expect(project).not.toHaveCSS('box-shadow', 'none')
  await page.keyboard.press('ArrowUp')
  await expect(grid.locator('.ag-header-group-cell:focus')).toContainText('Проект')
  await expect(grid.locator('.ag-header-group-cell:focus')).not.toHaveCSS('box-shadow', 'none')
  await page.keyboard.press('ArrowDown')
  await expect(project).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const subtitle = grid.locator('.ag-header-cell[col-id="subtitleCode"]')
  await expect(subtitle).toBeFocused()
  await expect(subtitle).not.toHaveCSS('box-shadow', 'none')
  await page.keyboard.press('ArrowLeft')
  await expect(project).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.locator('.ag-filter').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(project).toBeFocused()
  await expect(project).not.toHaveCSS('box-shadow', 'none')
  await page.keyboard.press('ArrowDown')
  await expect(grid.locator('.ag-cell[col-id="projectTitle"]').first()).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(project).toBeFocused()
})

test('installed Safari: visible header navigation and asynchronous document clipboard', async ({ baseURL }, info) => {
  test.skip(process.env.INSTALLED_SAFARI_KEYBOARD !== '1', 'Opt-in installed SafariDriver on port 4445')
  test.setTimeout(600000)
  if (baseURL !== 'http://127.0.0.1:3100') throw Error('Requires the isolated local E2E server')
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw Error(JSON.stringify(result.value))
    return result.value
  }
  const { sessionId, capabilities } = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  console.info('SAFARI_NATIVE_BROWSER', JSON.stringify({ name: capabilities.browserName, version: capabilities.browserVersion }))
  const prefix = '/session/' + sessionId
  const execute = (script: string, ...args: unknown[]) => command(prefix + '/execute/sync', { script, args })
  const key = (value: string) => command(prefix + '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] })
  const focused = async (column: string) => {
    await expect.poll(() => execute(`const e=document.activeElement;return {column:e?.closest('.ag-header-cell')?.getAttribute('col-id'), visible:e?getComputedStyle(e).boxShadow!=='none':false, active:document.hasFocus()&&!document.hidden}`)).toEqual({ column, visible: true, active: true })
  }
  try {
    await command(prefix + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await prepareSafariMeasurementWindow(command, prefix, 300000)
    for (const route of ['/', '/lnk', '/psto']) {
      await command(prefix + '/url', { url: baseURL + route })
      await expect.poll(() => execute("return !!document.querySelector('input[type=search]')")).toBe(true)
      await execute("const e=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,arguments[0]);e.dispatchEvent(new Event('input',{bubbles:true}))", fixtureProject)
      await expect.poll(() => execute("return document.querySelector('.ag-cell[col-id=joint]')?.textContent?.trim() === 'HEADER-F1'")).toBe(true)
      await command(prefix + '/window', { handle: await command(prefix + '/window') })
      await expect.poll(() => execute('return document.hasFocus() && !document.hidden'), { timeout: 30000 }).toBe(true)
      const header = await command(prefix + '/element', { using: 'css selector', value: '.ag-header-cell[col-id=projectTitle] .ag-header-cell-text' })
      await command(prefix + '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', duration: 100, origin: header, x: 0, y: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      ] }] })
      await focused('projectTitle')
      await key('\uE013')
      const groupFocus=()=>execute("const e=document.activeElement;return {group:e?.matches('.ag-header-group-cell'),shadow:e?getComputedStyle(e).boxShadow:null,text:e?.textContent}")
      console.info('SAFARI_SECTION_FOCUS',route,await groupFocus())
      await expect.poll(async()=>{const value=await groupFocus();return value.group && value.shadow!=='none'}).toBe(true)
      await key('\uE015'); await focused('projectTitle')
      await key('\uE014'); await focused('subtitleCode')
      await key('\uE012'); await focused('projectTitle')
      await key(' ')
      await expect.poll(() => execute("return !!document.querySelector('.ag-filter')")).toBe(true)
      await key('\uE00C'); await focused('projectTitle')
      await key('\uE015')
      await expect.poll(() => execute("return document.activeElement?.closest('.ag-cell')?.getAttribute('col-id')")).toBe('projectTitle')
      await key('\uE013'); await focused('projectTitle')
    }
    await writeFile(info.outputPath('safari-header-focus.png'), Buffer.from(await command(prefix + '/screenshot'), 'base64'))
    await command(prefix + '/url', { url: baseURL + '/documents' })
    await expect.poll(() => execute("return document.body.innerText.includes('Найдено: 110')")).toBe(true)
    await expect.poll(() => execute("return document.body.innerText.includes('Загружено: 100')")).toBe(true)
    await expect.poll(() => execute('return document.hasFocus() && !document.hidden')).toBe(true)
    const cell = await command(prefix + '/element', { using: 'css selector', value: '.ag-row[row-index="0"] .ag-cell[col-id=title]' })
    const point = await execute('const r=arguments[0].getBoundingClientRect();return {x:r.left+4,y:r.top+4}', cell)
    await command(prefix + '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 100, origin: 'viewport', ...point }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
    ] }] })
    const shortcut = (value: string) => command(prefix + '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [
      { type: 'keyDown', value: '\uE03D' }, { type: 'keyDown', value }, { type: 'keyUp', value }, { type: 'keyUp', value: '\uE03D' },
    ] }] })
    await execute(`
      const audit = window.__safariClipboardAudit = { writes: [], keys: [], copies: 0, pastes: 0 };
      for (const method of ['write', 'writeText']) {
        if (!navigator.clipboard?.[method]) continue;
        const original = navigator.clipboard[method].bind(navigator.clipboard);
        navigator.clipboard[method] = function(...args) {
          const entry = { method, state: 'pending', active: document.hasFocus() && !document.hidden };
          audit.writes.push(entry);
          return original(...args).then(value => { entry.state = 'fulfilled'; return value }, error => {
            entry.state = 'rejected'; entry.error = { name: error.name, message: error.message }; throw error;
          });
        };
      }
      document.addEventListener('keydown', event => {
        if (['a','c','v'].includes(event.key)) audit.keys.push({ key: event.key, meta: event.metaKey, trusted: event.isTrusted,
          target: event.target.tagName, column: event.target.closest('.ag-cell')?.getAttribute('col-id') });
      }, true);
      document.addEventListener('copy', () => audit.copies++);
      document.addEventListener('paste', () => audit.pastes++);
    `)
    await expect.poll(() => execute("return document.activeElement?.closest('.ag-cell')?.getAttribute('col-id')")).toBe('title')
    await shortcut('a'); await shortcut('c')
    // Keep focus in the grid until the real asynchronous write finishes.
    // Instrumentation delegates to native clipboard APIs and never reads contents.
    await expect.poll(() => execute("return window.__safariClipboardAudit.writes.at(-1)?.state")).toBe('fulfilled')
    // Paste through the installed browser, with its real clipboard permission and
    // user gesture. Do not read or report any pre-existing clipboard contents.
    await execute("const e=document.createElement('textarea');e.id='safari-copy-verification';e.style.cssText='position:fixed;top:0;left:0;z-index:9999';document.body.append(e)")
    await expect.poll(async () => {
      await execute("const e=document.getElementById('safari-copy-verification');e.value='';e.focus()")
      await shortcut('v')
      return execute("return (document.getElementById('safari-copy-verification').value.match(/SAFARI-CLIP-\\d{3}/g)||[]).sort()")
    }).toEqual(Array.from({ length: 110 }, (_, index) => `SAFARI-CLIP-${String(index + 1).padStart(3, '0')}`))
    await expect.poll(() => execute("return document.body.innerText.includes('Загружено: 100')")).toBe(true)
    console.info('SAFARI_NATIVE_CLIPBOARD', JSON.stringify({ documents: 110, loadedBlock: 100, nativePaste: true }))
    await writeFile(info.outputPath('safari-clipboard-diagnostic.json'), JSON.stringify(await execute('return window.__safariClipboardAudit'), null, 2))
  } catch (error) {
    await writeFile(info.outputPath('safari-clipboard-diagnostic.json'), JSON.stringify(await execute("return {clipboard:window.__safariClipboardAudit,active:document.hasFocus()&&!document.hidden,focused:document.activeElement?.tagName,column:document.activeElement?.closest('.ag-cell')?.getAttribute('col-id')}"), null, 2))
    await writeFile(info.outputPath('safari-keyboard-failure.png'), Buffer.from(await command(prefix + '/screenshot'), 'base64'))
    throw error
  } finally { await command(prefix, undefined, 'DELETE') }
})
