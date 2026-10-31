import { expect, test, type Locator } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { authenticateE2eSafari } from '../authentication'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E checkbox response'
const safariProject = 'E2E Safari checkbox response'
const smallProject = 'E2E nested checkbox response'
// Wait only before pressing, never retry a click that failed to change state.
// Page scrolling and group transitions can move a target after one DOM read.
async function stablePoint(locator: Locator) {
  return locator.evaluate(el => new Promise<{ x: number; y: number }>((resolve, reject) => {
    let previous = '', stable = 0
    const deadline = performance.now() + 3000
    const sample = () => {
      const rect = el.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
      const key = [rect.x, rect.y, rect.width, rect.height].map(n => n.toFixed(1)).join(',')
      const hit = document.elementFromPoint(x, y)
      stable = key === previous && !!hit && (el === hit || el.contains(hit)) ? stable + 1 : 0
      previous = key
      if (stable >= 3) resolve({ x, y })
      else if (performance.now() > deadline) reject(new Error('The click target did not settle in the visible viewport'))
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
}
test.beforeAll(async () => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints
    (project_title, subtitle_code, line, joint, weld_date, connection_type, officiality,
     revision_actuality, has_vik, psto_required)
    select $1,'CLICK','CLICK-L'||lpad(((n-1)/6+1)::text,2,'0'),'F'||(95000+n),
      '2026-09-01','С17','действующий','актуальная','да','да'
    from generate_series(1,60) n`, [project]))
  await withLineProgramFixture(db => db.query(`insert into weld_joints
    (project_title, subtitle_code, line, joint, weld_date, connection_type, officiality,
     revision_actuality, has_vik, psto_required)
    select $1,'CLICK','CLICK-L'||lpad(((n-1)/6+1)::text,3,'0'),'F'||(95000+n),
      '2026-09-01','С17','действующий','актуальная','да','да'
    from generate_series(1,600) n`, [safariProject]))
  await withLineProgramFixture(db => db.query(`insert into weld_joints
    (project_title, subtitle_code, line, joint, weld_date, connection_type, officiality,
     revision_actuality, has_vik, psto_required)
    select $1,'CLICK','CLICK-L'||lpad(((n-1)/5+1)::text,2,'0'),'F'||(95000+n),
      '2026-09-01','С17','действующий','актуальная','да','да'
    from generate_series(1,20) n`, [smallProject]))
})
test.afterAll(() => cleanupLineProgramProjects([project, safariProject, smallProject]))

test('lnk: checkboxes stay aligned after loading distant expanded groups', async ({ page }, info) => {
  await page.setViewportSize({ width: 1728, height: 975 })
  await page.addInitScript(() => localStorage.setItem('lnk-ag-grid:v1', JSON.stringify({ columns: [], views: {}, appearance: { density: 'compact', wrapText: false, taskFill: false } })))
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(safariProject)
  await expect(page.getByText('Найдено: 600', { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
  await page.locator('.ag-row-group').first().click({ button: 'right' })
  await page.getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Выбрать стык F95001', exact: true })).toBeAttached()
  await page.evaluate(() => scrollTo(0, 20000))
  await page.waitForLoadState('networkidle')
  let previous = '', stable = 0
  await expect.poll(async () => {
    const scene = await page.locator('.ag-row').evaluateAll(rows => JSON.stringify(rows.map(row => [row.getAttribute('row-id'), row.getBoundingClientRect().y])))
    stable = scene === previous ? stable + 1 : 0; previous = scene
    return stable >= 3
  }).toBe(true)
  const labels = await page.locator('.ag-row .journal-server-checkbox input').evaluateAll(inputs => {
    const header = document.querySelector('.ag-header')!.getBoundingClientRect().bottom
    const top = Math.max(header, ...[...document.querySelectorAll('.ag-grid-sticky-top-rows-container .ag-row')].map(el => el.getBoundingClientRect().bottom))
    const bottom = document.querySelector('.ag-body-horizontal-scroll')!.getBoundingClientRect().top
    return inputs.filter(el => { const r = el.getBoundingClientRect(); return r.top > top && r.bottom < bottom })
      .map(el => el.getAttribute('aria-label')!)
  })
  expect(labels.length).toBeGreaterThan(5)
  for (const label of labels.slice(0, 12)) {
    const check = page.getByRole('checkbox', { name: label, exact: true })
    const point = await stablePoint(check), selected = await check.isChecked()
    const geometry = () => check.evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), page: scrollY,
      inner: document.querySelector('.ag-grid-viewport')!.scrollTop,
      body: getComputedStyle(document.querySelector('.ag-grid-scrolling-rows')!).transform,
      row: getComputedStyle(el.closest('.ag-row')!).transform,
      active: document.activeElement?.outerHTML.slice(0, 500) }))
    const before = await geometry()
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    const during = await check.boundingBox()
    const pressed = await geometry()
    await page.mouse.up()
    await info.attach(label + '.json', { body: JSON.stringify({ before, pressed, after: await geometry() }), contentType: 'application/json' })
    expect(Math.abs(during!.y + during!.height / 2 - point.y), label).toBeLessThanOrEqual(1)
    await expect(check).toBeChecked({ checked: !selected })
    await expect(page.locator('.ag-cell-focus .journal-server-checkbox input')).toHaveAttribute('aria-label', label)
  }
})


for (const [nativeProject, nativeCount] of [[smallProject, 20], [safariProject, 600]] as const) test(`installed Safari: ${nativeCount} joints, repeated Shift+Space in three group levels then mouse clicks`, async ({ baseURL }, info) => {
  test.skip(process.env.CHECKBOX_SAFARI !== '1', 'Explicit installed Safari pointer check')
  test.setTimeout(120_000)
  const driver = spawn('/usr/bin/safaridriver', ['--port', '4471'], { stdio: 'ignore' })
  let session = ''
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4471' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(`Safari: ${JSON.stringify(result.value)}`)
    return result.value
  }
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const wait = (script: string) => expect.poll(() => execute(script), { timeout: 20_000 }).toBe(true)
  const samples: unknown[] = []
  try {
    await expect.poll(async () => { try { return !!await command('/status') } catch { return false } }).toBe(true)
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
    session = '/session/' + created.sessionId
    await command(session + '/window/rect', { x: 0, y: 0, width: 1728, height: 1050 })
    await command(session + '/window', { handle: await command(session + '/window') })
    await authenticateE2eSafari(command, session)
    await command(session + '/url', { url: baseURL + '/lnk' })
    await execute(`localStorage.setItem('lnk-ag-grid:v1',JSON.stringify({columns:[],views:{},appearance:{density:'compact',wrapText:false,taskFill:false}}))`)
    await command(session + '/refresh', {})
    await expect.poll(() => execute('return !document.hidden && document.hasFocus()'), { timeout: 60_000, message: 'Safari must be visible on the unlocked Mac before pointer checks' }).toBe(true)
    await wait('return Boolean(document.querySelector("input[type=search]"))')
    const search = await command(session + '/element', { using: 'css selector', value: 'input[type=search]' })
    await command(session + '/element/' + search['element-6066-11e4-a52e-4f735466cecf'] + '/value', { text: nativeProject })
    await wait(`return document.body.innerText.includes('Найдено: ${nativeCount}')`)
    await execute(`window.checkboxReads=0;const original=window.fetch;window.fetch=async function(...args){window.checkboxReads++;try{return await original.apply(this,args)}finally{window.checkboxReads--}}`)
    for (const field of ['projectTitle', 'subtitleCode', 'line']) {
      await execute(`document.querySelector('.ag-header-cell[col-id="'+arguments[0]+'"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:200}))`, field)
      await wait(`return [...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.includes('Сгруппировать'))`)
      await execute(`Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Сгруппировать')).click()`)
      await wait(`return window.checkboxReads===0&&!document.querySelector('.ag-row-loading')`)
    }
    await wait('return Boolean(document.querySelector(".ag-row-group"))')
    await execute(`document.querySelector('.ag-row-group').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:300}))`)
    await wait(`return [...document.querySelectorAll('[data-testid=context-action-menu] button')].some(e=>e.textContent.trim()==='Развернуть все')`)
    await execute(`Array.from(document.querySelectorAll('[data-testid=context-action-menu] button')).find(e=>e.textContent.trim()==='Развернуть все').click()`)
    await wait(`return Boolean(document.querySelector('input[aria-label="Выбрать стык F95001"]'))`)
    await execute(`window.checkboxPointerEvents=[];for(const type of ['pointerdown','mousedown','mouseup','click','change','keydown','keyup'])document.addEventListener(type,e=>{const t=e.target;window.checkboxPointerEvents.push({type,key:e.key,shift:e.shiftKey,target:t.getAttribute('aria-label'),row:t.closest('[row-id]')?.getAttribute('row-id'),tag:t.tagName,classes:t.className,path:e.composedPath().slice(0,7).map(n=>n.className||n.nodeName),x:e.clientX,y:e.clientY,scroll:scrollY})},true)`)
    console.log('CHECKBOX_INSTALLED_SAFARI', JSON.stringify({ capabilities: created.capabilities, state: await execute('return {hidden:document.hidden,focused:document.hasFocus(),timeline:CSS.supports("animation-timeline","scroll(root block)")}') }))
    if (nativeCount === 20) {
      const points = await execute(`return ['F95001','F95003'].map(joint=>{const e=document.querySelector('input[aria-label="Выбрать стык '+joint+'"]'),r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})`)
      await command(session + '/actions', { actions: [{ type: 'pointer', id: 'checkbox', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', origin: 'viewport', ...points[0], duration: 0 }, { type: 'pointerDown', button: 0 },
        ...Array.from({ length: 6 }, (_, index) => ({ type: 'pointerMove', origin: 'viewport', x: points[0].x,
          y: Math.round(points[0].y + (points[1].y - points[0].y) * (index + 1) / 6), duration: 40 })), { type: 'pointerUp', button: 0 },
      ] }] })
      await wait(`return document.querySelectorAll('.ag-cell-range-selected[col-id="ag-Grid-SelectionColumn"]').length===3`)
      for (const total of [3, 0]) {
        await command(session + '/actions', { actions: [{ type: 'key', id: 'checkbox-keyboard', actions: [
          { type: 'keyDown', value: '\uE008' }, { type: 'keyDown', value: '\uE00D' },
          { type: 'keyUp', value: '\uE00D' }, { type: 'keyUp', value: '\uE008' },
        ] }] })
        await wait(`return ([...document.querySelectorAll('.journal-footer span')].find(e=>e.textContent.startsWith('Выбрано:'))?.textContent||'Выбрано: 0')==='Выбрано: ${total}'`)
        await wait(`return document.activeElement?.getAttribute('aria-label')==='Выбрать стык F95001'`)
        expect(await execute(`return ['F95001','F95002','F95003'].map(joint=>document.querySelector('input[aria-label="Выбрать стык '+joint+'"]')?.checked)`)).toEqual([total > 0, total > 0, total > 0])
        await wait(`return window.checkboxReads===0&&!document.querySelector('.journal-server-checkbox input[aria-busy="true"]')`)
      }
      console.log('SAFARI_CHECKBOX_COLUMN_RANGE', JSON.stringify({ nativeCount, selectedAndCleared: 3, nativeInputFocus: true }))
    }
    const visibleLabels = () => execute(`const header=document.querySelector('.ag-header').getBoundingClientRect().bottom,top=Math.max(header,...[...document.querySelectorAll('.ag-grid-sticky-top-rows-container .ag-row')].map(e=>e.getBoundingClientRect().bottom)),bottom=document.querySelector('.ag-body-horizontal-scroll').getBoundingClientRect().top;return [...document.querySelectorAll('.ag-row .journal-server-checkbox input')].filter(e=>{const r=e.getBoundingClientRect();return r.top>(e.closest('.ag-grid-sticky-top-rows-container')?header:top)&&r.bottom<bottom}).map(e=>e.getAttribute('aria-label')).reverse()`)
    let wheelDelta = 0
    for (const offset of [150, 320, 450, 'wheel-down', 'wheel-up', 'resize-short', 'resize-tall', 20000, 'regroup', 'wheel-down', 'wheel-up'] as const) {
      await expect.poll(() => execute('return !document.hidden && document.hasFocus()'), { timeout: 30_000, message: 'Safari lost foreground before pointer gesture' }).toBe(true)
      if (typeof offset === 'number') await execute('scrollTo(0,document.querySelector(".journal-page-track").getBoundingClientRect().top+scrollY+arguments[0])', offset)
      else if (offset === 'regroup') {
        for (const action of ['Свернуть все', 'Развернуть все']) {
          await execute(`document.querySelector('.ag-row-group').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:300}))`)
          await wait(`return [...document.querySelectorAll('[data-testid=context-action-menu] button')].some(e=>e.textContent.trim()==='${action}')`)
          await execute(`Array.from(document.querySelectorAll('[data-testid=context-action-menu] button')).find(e=>e.textContent.trim()===arguments[0]).click()`, action)
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        await execute('scrollTo(0,500)')
      }
      else if (offset.startsWith('resize')) await command(session + '/window/rect', { x: 0, y: 0, width: 1728, height: offset === 'resize-short' ? 850 : 1050 })
      else {
        const actions: unknown[] = []
        for (let n = 0; n < 12; n++) {
          wheelDelta += offset === 'wheel-down' ? 25 : -25
          actions.push({ type: 'scroll', origin: 'viewport', x: 1000, y: 600, deltaX: 0, deltaY: wheelDelta, duration: 0 }, { type: 'pause', duration: 25 })
        }
        await command(session + '/actions', { actions: [{ type: 'wheel', id: 'checkbox-wheel', actions }] })
      }
      await wait(`return window.checkboxReads===0&&!document.querySelector('.ag-row-loading')`)
      // Settle data/geometry before pressing; never retry a failed click.
      let previous = '', stable = 0
      await expect.poll(async () => {
        const scene = await execute(`return JSON.stringify({reads:window.checkboxReads,scroll:scrollY,rows:[...document.querySelectorAll('.ag-row')].map(e=>[e.getAttribute('row-id'),Math.round(e.getBoundingClientRect().y*10)/10])})`)
        stable = scene === previous ? stable + 1 : 0; previous = scene
        return stable >= 3
      }).toBe(true)
      for (const rangeIndex of [3, 7, 5]) {
        const leaves = (await visibleLabels()).filter((label: string) => label.startsWith('Выбрать стык '))
        expect(leaves.length, 'at least three visible joints for a pointer range').toBeGreaterThanOrEqual(3)
        // A shorter Safari window can show fewer than eight joints. Keep all
        // three gestures, starting where two rows above remain in the viewport.
        const rangeLabel = leaves[Math.min(rangeIndex, leaves.length - 3)]
        const range = await execute(`const e=document.querySelector('input[aria-label="'+arguments[0]+'"]');const cell=e.closest('.ag-row').querySelector('[col-id="line"]'),r=cell.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`, rangeLabel)
        await command(session + '/actions', { actions: [{ type: 'pointer', id: 'checkbox', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: 'viewport', x: Math.round(range.x), y: Math.round(range.y), duration: 0 }, { type: 'pointerDown', button: 0 }, ...[1,2,3,4,5,6].flatMap(n => [{ type: 'pointerMove', origin: 'viewport', x: Math.round(range.x), y: Math.round(range.y - 68*n/6), duration: 30 }, { type: 'pause', duration: 30 }]), { type: 'pointerUp', button: 0 }] }] })
        const selectedBefore = await execute(`return [...document.querySelectorAll('.journal-footer span')].find(e=>e.textContent.startsWith('Выбрано:'))?.textContent||'Выбрано: 0'`)
        expect(await execute(`return document.querySelectorAll('.ag-cell-range-selected[col-id="line"]').length`), 'mouse drew a real range').toBeGreaterThan(1)
        await command(session + '/actions', { actions: [{ type: 'key', id: 'checkbox-keyboard', actions: [
          { type: 'keyDown', value: '\uE008' }, { type: 'keyDown', value: '\uE00D' },
          { type: 'keyUp', value: '\uE00D' }, { type: 'keyUp', value: '\uE008' },
        ] }] })
        await expect.poll(() => execute(`return [...document.querySelectorAll('.journal-footer span')].find(e=>e.textContent.startsWith('Выбрано:'))?.textContent||'Выбрано: 0'`)).not.toBe(selectedBefore)
        await wait(`return window.checkboxReads===0&&!document.querySelector('.journal-server-checkbox input[aria-busy="true"]')`)
      }
      await execute('window.checkboxPointerEvents.length=0')
      for (const label of await visibleLabels()) {
        await wait('return !document.hidden && document.hasFocus()')
        const before = await execute(`const e=document.querySelector('input[aria-label="'+arguments[0]+'"]');const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),checked:e.checked,x:r.x+r.width/2,y:r.y+r.height/2,scroll:scrollY,inner:document.querySelector('.ag-grid-viewport').scrollTop,bodyTransform:getComputedStyle(document.querySelector('.ag-grid-scrolling-rows')).transform,rowTransform:getComputedStyle(e.closest('.ag-row')).transform,translate:document.querySelector('.ag-grid-scrolling-container').style.translate,motion:document.querySelector('.journal-grid-frame').className,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,600)}`, label)
        await command(session + '/actions', { actions: [{ type: 'pointer', id: 'checkbox', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', origin: 'viewport', x: Math.round(before.x), y: Math.round(before.y), duration: 0 }, { type: 'pointerDown', button: 0 }] }] })
        const during = await execute(`const e=document.querySelector('input[aria-label="'+arguments[0]+'"]');const r=e.getBoundingClientRect();return {y:r.y+r.height/2,scroll:scrollY,inner:document.querySelector('.ag-grid-viewport').scrollTop,bodyTransform:getComputedStyle(document.querySelector('.ag-grid-scrolling-rows')).transform,rowTransform:getComputedStyle(e.closest('.ag-row')).transform,translate:document.querySelector('.ag-grid-scrolling-container').style.translate}`, before.label)
        await command(session + '/actions', { actions: [{ type: 'pointer', id: 'checkbox', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerUp', button: 0 }] }] })
        // A parent group can include unloaded descendants. Wait for its one
        // membership request, but never repeat the click or simulate a toggle.
        await wait(`return !document.querySelector('.journal-server-checkbox input[aria-busy="true"]')`)
        const after = await execute(`const e=document.querySelector('input[aria-label="'+arguments[0]+'"]');return {checked:e.checked,pending:e.getAttribute('aria-busy')}`, before.label)
        const events = await execute('return window.checkboxPointerEvents.splice(0)')
        samples.push({ offset, before, during, after, events })
        expect(events.find((event: { type: string }) => event.type === 'pointerdown')?.target, before.label + ' pointer target').toBe(before.label)
        expect(after.checked, before.label).toBe(!before.checked)
        expect(Math.abs(during.y - before.y), before.label + ' target').toBeLessThanOrEqual(1)
        expect(Math.abs(during.scroll - before.scroll), before.label + ' page').toBeLessThanOrEqual(1)
      }
    }
  } finally {
    await writeFile(info.outputPath('safari-pointer.json'), JSON.stringify(samples, null, 2))
    await info.attach('safari-pointer.json', { body: JSON.stringify(samples), contentType: 'application/json' })
    if (session) {
      await writeFile(info.outputPath('safari-events.json'), JSON.stringify(await execute('return {events:window.checkboxPointerEvents,active:document.activeElement?.outerHTML,footer:document.querySelector(".journal-footer")?.outerHTML,hidden:document.hidden,focused:document.hasFocus()}').catch(() => null), null, 2))
      await info.attach('safari-state.json', { body: JSON.stringify(await execute('return {hidden:document.hidden,focused:document.hasFocus(),title:document.title,text:document.body.innerText.slice(0,3000)}').catch(() => null)), contentType: 'application/json' })
      await writeFile(info.outputPath('safari-pointer.png'), Buffer.from(await command(session + '/screenshot'), 'base64')).catch(() => {})
      await command(session, undefined, 'DELETE').catch(() => {})
    }
    driver.kill('SIGTERM')
  }
})

for (const route of ['lnk', 'psto', 'journal']) {
  test(`${route}: checkbox-column range uses Shift+Space from the focused checkbox`, async ({ page }) => {
    const calls: string[] = []
    page.on('request', request => { const name = rpcName(request.url()); if (name.startsWith('selectJournalGridRange_')) calls.push(name) })
    await page.goto('/' + route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByText('Найдено: 60', { exact: true })).toBeVisible()
    await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
    await page.locator('.ag-row-group').first().click({ button: 'right' })
    await page.getByRole('button', { name: 'Развернуть все', exact: true }).click()
    const check = (joint: string) => page.getByRole('checkbox', { name: `Выбрать стык ${joint}`, exact: true })
    await check('F95006').check()
    const first = check('F95001'), last = check('F95003')
    const start = await stablePoint(first), end = await stablePoint(last)
    // Draw the actual range in the checkbox cells, leaving native input focus
    // where the user's mouse started; do not synthesize an AG range or key event.
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 6 })
    await page.mouse.up()
    await expect(page.locator('.ag-cell-range-selected[col-id="ag-Grid-SelectionColumn"]')).toHaveCount(3)
    await expect(first).toBeFocused()
    await page.keyboard.press('Shift+Space')
    await expect(page.getByText('Выбрано: 4', { exact: true })).toBeVisible()
    for (const joint of ['F95001', 'F95002', 'F95003', 'F95006']) await expect(check(joint)).toBeChecked()
    await expect(first).toBeFocused()
    await expect(page.locator('.ag-cell-range-selected[col-id="ag-Grid-SelectionColumn"]')).toHaveCount(3)
    await page.keyboard.down('Shift')
    await page.keyboard.down('Space')
    await page.keyboard.down('Space')
    await page.keyboard.up('Space')
    await page.keyboard.up('Shift')
    await expect(page.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    for (const joint of ['F95001', 'F95002', 'F95003']) await expect(check(joint)).not.toBeChecked()
    await expect(check('F95006')).toBeChecked()
    await page.keyboard.press('Space')
    await expect(page.getByText('Выбрано: 2', { exact: true })).toBeVisible()
    await expect(first).toBeChecked()
    await expect(check('F95002')).not.toBeChecked()
    await expect(check('F95003')).not.toBeChecked()
    await first.click()
    await expect(page.locator('.ag-cell-range-selected')).toHaveCount(0)
    await expect(first).not.toBeChecked()
    await page.keyboard.press('Shift+Space')
    await expect(first).toBeChecked()
    await expect(page.getByText('Выбрано: 2', { exact: true })).toBeVisible()
    expect(calls).toHaveLength(2)
  })
  test(`${route}: Enter and F2 expand groups in the navigated column with one selection frame`, async ({ page }) => {
    await page.goto('/' + route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByText('Найдено: 60', { exact: true })).toBeVisible()
    for (const field of ['projectTitle', 'subtitleCode', 'line']) {
      await page.locator(`.ag-header-cell[col-id="${field}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    for (const level of [0, 1, 2]) {
      const group = page.locator(`.ag-row-group.ag-row-level-${level}`).first()
      const title = group.locator('[col-id="line"]')
      await title.click()
      for (let step = 0; step <= level; step++) await page.keyboard.press('ArrowRight')
      const column = await page.locator('.ag-cell-focus').getAttribute('col-id')
      expect(column).not.toBe('line')
      for (const [key, expanded] of [['Enter', true], ['F2', false], ['F2', true], ['Enter', false], ['Enter', true]] as const) {
        await page.keyboard.press(key)
        await expect(group.locator('.journal-group-toggle')).toHaveAttribute('aria-expanded', String(expanded))
        await expect(group.locator('.ag-cell-focus')).toHaveAttribute('col-id', column!)
        await expect(page.locator('.ag-cell-focus')).toHaveCount(1)
        await expect(page.locator('.ag-cell-range-selected:not(.ag-cell-focus)')).toHaveCount(0)
        await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.ag-cell')?.getAttribute('col-id'))).toBe(column)
      }
    }
    const row = page.getByRole('checkbox', { name: 'Выбрать стык F95001', exact: true })
    await expect(row).toBeVisible()
    await row.check()
    await expect(row).toBeChecked()
    await page.locator('.ag-row-group.ag-row-level-2').first().locator('[col-id="subtitleCode"]').click()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    await page.keyboard.press('F2')
    await expect(row).toBeChecked()
  })
  for (const fields of [['line'], ['projectTitle', 'subtitleCode', 'line']]) test(`${route}: checkbox hit area after repeated Shift+Space with ${fields.length} group levels`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1728, height: 975 })
    await page.addInitScript(route => localStorage.setItem(`${route === 'journal' ? 'welding-journal' : route}-ag-grid:v1`, JSON.stringify({ columns: [], views: {}, appearance: { density: 'compact', wrapText: false, taskFill: false } })), route)
    await page.goto('/' + route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByText('Найдено: 60', { exact: true })).toBeVisible()
    for (const field of fields) {
      await page.locator(`.ag-header-cell[col-id="${field}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    await page.locator('.ag-row-group').first().click({ button: 'right' })
    await page.getByRole('button', { name: 'Развернуть все', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Выбрать стык F95018', exact: true })).toBeAttached()
    await page.evaluate(levels => scrollTo(0, levels === 1 ? 250 : 350), fields.length)
    const row = (joint: string) => page.locator('.ag-row:not(.ag-row-group)').filter({ has: page.getByRole('checkbox', { name: `Выбрать стык ${joint}`, exact: true }) })
    for (const [first, last, total] of [['F95009', 'F95011', 3], ['F95014', 'F95016', 6], ['F95010', 'F95012', 7]] as const) {
      const start = await stablePoint(row(first).locator('[col-id="line"]'))
      const end = await stablePoint(row(last).locator('[col-id="line"]'))
      await page.mouse.move(start.x, start.y); await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up()
      await expect(page.locator('.ag-cell-range-selected[col-id="line"]')).toHaveCount(3)
      await page.keyboard.press('Shift+Space')
      await expect(page.getByText(`Выбрано: ${total}`, { exact: true })).toBeVisible()
    }
    const samples: unknown[] = []
    await page.evaluate(() => {
      const original = HTMLElement.prototype.focus
      const calls: boolean[] = []
      Object.assign(window, { checkboxFocusScroll: calls })
      HTMLElement.prototype.focus = function(options) {
        if (this.closest('.ag-cell')) calls.push(options?.preventScroll === true)
        return original.call(this, options)
      }
    })
    for (const [joint, edge] of [['F95010', 'top'], ['F95012', 'bottom'], ['F95018', 'left'], ['F95009', 'right'], ['F95011', 'center']] as const) {
      const check = page.getByRole('checkbox', { name: `Выбрать стык ${joint}`, exact: true })
      const point = await stablePoint(check), before = await check.isChecked()
      const box = (await check.boundingBox())!
      // AG extends the visual checkbox hit area by 8px with ::before. Exercise
      // those edges with real pointer events, not only the 15px input center.
      if (edge === 'top') point.y = box.y - 4
      if (edge === 'bottom') point.y = box.y + box.height + 4
      if (edge === 'left') point.x = box.x - 4
      if (edge === 'right') point.x = box.x + box.width + 4
      if (edge !== 'center') expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.classList.contains('ag-checkbox-input-wrapper'), point)).toBe(true)
      await page.mouse.move(point.x, point.y); await page.mouse.down()
      const pressed = await check.boundingBox()
      await page.mouse.up()
      samples.push({ joint, edge, point, pressed, before, after: await check.isChecked() })
      await info.attach('shift-space-pointer.json', { body: JSON.stringify(samples), contentType: 'application/json' })
      expect(Math.abs(pressed!.y - box.y), joint).toBeLessThanOrEqual(1)
      await expect(check).toBeChecked({ checked: !before })
      await expect(page.locator('.ag-cell-range-selected')).toHaveCount(0)
      await expect(page.locator('.ag-cell-focus')).toHaveCount(1)
    }
    const focusScroll = await page.evaluate(() => (window as unknown as { checkboxFocusScroll: boolean[] }).checkboxFocusScroll)
    expect(focusScroll.length).toBeGreaterThan(0)
    expect(focusScroll.every(preventsScroll => preventsScroll)).toBe(true)
    // The same extended hit area must activate group and all-filter selection.
    const group = page.getByRole('checkbox', { name: 'Выбрать стыки группы CLICK-L03', exact: true })
    const point = await stablePoint(group), groupBox = (await group.boundingBox())!
    await page.mouse.click(groupBox.x - 4, point.y)
    await expect(group).toBeChecked()
    await page.mouse.click(groupBox.x + groupBox.width + 4, point.y)
    await expect(group).not.toBeChecked()
    await page.evaluate(() => scrollTo(0, 0))
    const header = page.getByRole('checkbox', { name: 'Выбрать все стыки по текущим фильтрам', exact: true })
    const headerPoint = await stablePoint(header), headerBox = (await header.boundingBox())!
    await page.mouse.click(headerPoint.x, headerBox.y - 4)
    await expect(header).toBeChecked()
    await expect(page.getByText('Выбрано: 60', { exact: true })).toBeVisible()
    await page.mouse.click(headerPoint.x, headerBox.y + headerBox.height + 4)
    await expect(header).not.toBeChecked()
  })

  test(`${route}: plain checkbox clicks replace stale cell ranges but Command keeps multiple ranges`, async ({ page }) => {
    await page.goto('/' + route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByText('Найдено: 60', { exact: true })).toBeVisible()
    const row = (joint: string) => page.locator('.ag-row:not(.ag-row-group)').filter({ has: page.getByRole('checkbox', { name: `Выбрать стык ${joint}`, exact: true }) })
    const first = row('F95001').locator('[col-id="line"]')
    const second = row('F95003').locator('[col-id="line"]')
    const gap = row('F95002').locator('[col-id="line"]')
    const retained = row('F95006').getByRole('checkbox')
    await retained.check()
    await first.click()
    const checkbox = row('F95005').getByRole('checkbox')
    const ordinaryPoint = await stablePoint(checkbox)
    await page.evaluate(() => {
      const original = HTMLElement.prototype.focus
      const calls: boolean[] = []
      Object.assign(window, { checkboxFocusScroll: calls })
      HTMLElement.prototype.focus = function(options) {
        if (this.closest('.ag-cell')) calls.push(options?.preventScroll === true)
        return original.call(this, options)
      }
    })
    await page.mouse.click(ordinaryPoint.x, ordinaryPoint.y, { delay: 80 })
    await expect(checkbox).toBeChecked()
    const focusScroll = await page.evaluate(() => (window as unknown as { checkboxFocusScroll: boolean[] }).checkboxFocusScroll)
    expect(focusScroll.length).toBeGreaterThan(0)
    expect(focusScroll.every(preventsScroll => preventsScroll)).toBe(true)
    await expect(first).not.toHaveClass(/ag-cell-range-selected/)
    await expect(retained).toBeChecked()
    await checkbox.press('Space')
    await expect(checkbox).not.toBeChecked()
    await first.click()
    await second.click({ modifiers: ['Meta'] })
    await expect(first).toHaveClass(/ag-cell-range-selected/)
    await expect(second).toHaveClass(/ag-cell-range-selected/)
    await expect(gap).not.toHaveClass(/ag-cell-range-selected/)
    const point = await stablePoint(checkbox)
    await page.mouse.click(point.x, point.y, { delay: 80 })
    await expect(checkbox).toBeChecked()
    await expect(page.locator('.ag-cell-range-selected')).toHaveCount(0)
    await expect(page.locator('.ag-cell-focus')).toHaveCount(1)
    await expect(row('F95005').locator('.ag-cell-focus')).toHaveAttribute('col-id', 'ag-Grid-SelectionColumn')
    await expect(retained).toBeChecked()
    await checkbox.press('Space')
    await expect(checkbox).not.toBeChecked()
    await first.click()
    await second.click({ modifiers: ['Control'] })
    await expect(first).toHaveClass(/ag-cell-range-selected/)
    await expect(second).toHaveClass(/ag-cell-range-selected/)
    await expect(gap).not.toHaveClass(/ag-cell-range-selected/)
  })

  test(`${route}: pressing a scrolled compact checkbox never moves the target before release`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1728, height: 975 })
    await page.addInitScript(route => localStorage.setItem(`${route === 'journal' ? 'welding-journal' : route}-ag-grid:v1`, JSON.stringify({ columns: [], views: {}, appearance: { density: 'compact', wrapText: false, taskFill: false } })), route)
    await page.goto('/' + route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByText('Найдено: 60', { exact: true })).toBeVisible()
    await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
    for (const line of ['CLICK-L01', 'CLICK-L02', 'CLICK-L03', 'CLICK-L04']) {
      const group = page.locator('.ag-row.ag-row-group').filter({ has: page.locator('.ag-group-value').getByText(line, { exact: true }) })
      await group.locator('.ag-group-contracted').click()
      await expect(group).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('checkbox', { name: `Выбрать стык F${95000 + Number(line.slice(-2)) * 6}`, exact: true })).toBeAttached()
    }
    await page.evaluate(() => window.scrollTo({ top: document.querySelector('.journal-page-track')!.getBoundingClientRect().top + window.scrollY + 150, behavior: 'instant' }))
    const samples: unknown[] = []
    try {
      for (const label of ['Выбрать стык F95009', 'Выбрать стык F95012', 'Выбрать стыки группы CLICK-L03', 'Выбрать стык F95018', 'Выбрать стык F95021']) {
        const check = page.getByRole('checkbox', { name: label, exact: true })
        const point = await stablePoint(check)
        const before = await check.isChecked()
        const top = await page.evaluate(() => window.scrollY)
        await page.mouse.move(point.x, point.y)
        await page.mouse.down()
        await page.waitForTimeout(120)
        const box = await check.boundingBox()
        const afterTop = await page.evaluate(() => window.scrollY)
        await page.mouse.up()
        samples.push({ label, point, box, top, afterTop, before, after: await check.isChecked() })
        expect(Math.abs(afterTop - top), `scroll after pressing ${label}`).toBeLessThanOrEqual(1)
        expect(Math.abs(box!.y + box!.height / 2 - point.y), `target moved after pressing ${label}`).toBeLessThanOrEqual(1)
        await expect(check).toBeChecked({ checked: !before })
      }
    } finally { await info.attach('pointer-stability.json', { body: JSON.stringify(samples), contentType: 'application/json' }) }
  })
}

for (const scenario of ['lnk', 'psto', 'journal', 'lnk compact']) test(`${scenario}: a single mouse click selects a joint in expanded groups`, async ({ page }, info) => {
  const route = scenario.split(' ')[0]!
  if (scenario.endsWith('compact')) {
    await page.setViewportSize({ width: 1728, height: 975 })
    await page.addInitScript(() => localStorage.setItem('lnk-ag-grid:v1', JSON.stringify({ columns: [], views: {}, appearance: { density: 'compact', wrapText: false, taskFill: false } })))
  }
  const errors: string[] = [], calls: string[] = []
  await page.addInitScript(() => {
    const events: unknown[] = []
    Object.assign(window, { gridInputEvents: events })
    for (const event of ['pointerdown', 'mousedown', 'focusin', 'pointerup', 'mouseup', 'click']) document.addEventListener(event, e => {
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('[data-weld-report-grid]')) {
        const button = el.closest('button, input'), row = el.closest('[row-id]')
        events.push({ event, tag: el.tagName, button: button?.getAttribute('aria-label'), row: row?.getAttribute('row-id'),
          t: performance.now(), x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY })
      }
    }, true)
  })
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name.split('_')[0]!) })
  await page.goto('/' + route)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByText('Найдено: 60', { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
  const group = (line: string) => page.locator('.ag-row.ag-row-group').filter({ has: page.locator('.ag-group-value').getByText(line, { exact: true }) })
  for (const line of ['CLICK-L01', 'CLICK-L02', 'CLICK-L03', 'CLICK-L04']) {
    const toggle = group(line).locator('.ag-group-contracted')
    // The document owns scrolling. Native scrollIntoView on a partially clipped
    // AG row can move the inner viewport between Playwright's hit test and click.
    // Scroll the page first, then send one actual mouse click inside the table.
    await toggle.evaluate(el => {
      const box = el.getBoundingClientRect()
      window.scrollBy({ top: box.top - window.innerHeight / 2, behavior: 'instant' })
    })
    await expect.poll(async () => {
      const box = await toggle.boundingBox()
      return !!box && box.y > 100 && box.y + box.height < 850
    }).toBe(true)
    const point = await stablePoint(toggle)
    await page.mouse.click(point.x, point.y, { delay: 80 })
    await expect(group(line)).toHaveAttribute('aria-expanded', 'true').catch(async error => {
      await writeFile(info.outputPath('group-input.json'), JSON.stringify(await page.evaluate(() => (window as unknown as { gridInputEvents: unknown[] }).gridInputEvents)))
      throw error
    })
    const lastJoint = 'F' + (95000 + Number(line.slice(-2)) * 6)
    await expect(page.getByRole('checkbox', { name: `Выбрать стык ${lastJoint}`, exact: true })).toBeAttached()
    await page.waitForLoadState('networkidle')
  }
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => window.scrollTo({ top: document.querySelector('.journal-page-track')!.getBoundingClientRect().top + window.scrollY, behavior: 'instant' }))
  await page.evaluate(() => {
    const events: unknown[] = []
    Object.assign(window, { checkboxEvents: events })
    for (const event of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'change']) document.addEventListener(event, e => {
      const el = e.target
      if (el instanceof HTMLInputElement && el.closest('.journal-server-checkbox')) {
        events.push({ event, label: el.getAttribute('aria-label'), checked: el.checked, disabled: el.getAttribute('aria-disabled'), t: performance.now() })
      }
    }, true)
  })
  const samples: unknown[] = []
  const start = calls.length
  try {
    for (const joint of ['F95003', 'F95009', 'F95015', 'F95021']) {
      const check = page.getByRole('checkbox', { name: `Выбрать стык ${joint}`, exact: true })
      // Move the document before locating a virtual row that is not mounted yet.
      await page.evaluate(joint => {
        const top = document.querySelector('.journal-page-track')!.getBoundingClientRect().top + window.scrollY
        const rowHeight = document.querySelector('.ag-row:not(.ag-row-group)')!.getBoundingClientRect().height
        const n = Number(joint.slice(1)) - 95001
        window.scrollTo({ top: top + Math.max(0, n + Math.floor(n / 6) - 4) * rowHeight, behavior: 'instant' })
      }, joint)
      await check.scrollIntoViewIfNeeded({ timeout: 5_000 })
      await expect(check).toBeEnabled()
      for (const selected of [true, false]) {
        const point = await stablePoint(check)
        // Raw mouse input: locator.check() can hide a lost click by retrying it.
        await page.mouse.click(point.x, point.y, { delay: 80 })
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        const state = await check.evaluate(el => ({ checked: (el as HTMLInputElement).checked, t: performance.now() }))
        samples.push({ joint, expected: selected, ...state })
        expect(state.checked).toBe(selected)
      }
    }
    expect(calls.slice(start).filter(name => /WorkflowRows|readJournalGrid/.test(name))).toEqual([])
    expect(errors).toEqual([])
  } finally {
    const events = page.isClosed() ? [] : await page.evaluate(() => (window as unknown as { checkboxEvents: unknown[] }).checkboxEvents).catch(() => [])
    const gridEvents = page.isClosed() ? [] : await page.evaluate(() => (window as unknown as { gridInputEvents: unknown[] }).gridInputEvents).catch(() => [])
    const body = JSON.stringify({ samples, calls: calls.slice(start), errors, events, gridEvents })
    await writeFile(info.outputPath('checkbox-input.json'), body)
    await info.attach('checkbox-input.json', { body, contentType: 'application/json' })
  }
})
