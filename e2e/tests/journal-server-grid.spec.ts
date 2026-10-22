import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
// Trace snapshots at every wheel step distort the performance comparison.
test.use({ trace: process.env.JOURNAL_DEPTH_LABEL || process.env.JOURNAL_SCROLL_LABEL || process.env.JOURNAL_RENDER_LABEL || process.env.JOURNAL_RESIZE_LABEL || process.env.JOURNAL_MOTION_LABEL || process.env.JOURNAL_PAINT_LABEL ? 'off' : 'retain-on-failure',
  video: process.env.JOURNAL_PAINT_LABEL ? 'on' : process.env.JOURNAL_DEPTH_LABEL || process.env.JOURNAL_RENDER_LABEL || process.env.JOURNAL_RESIZE_LABEL || process.env.JOURNAL_MOTION_LABEL ? 'off' : 'retain-on-failure' })
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { rpcName } from '../rpc'
import { observeGridResults } from '../grid-result-motion'
import { journalCompositorProbe } from '../journal-compositor-probe'
import { captureJournalGaps } from '../journal-gap-capture'
import { measureJournalMotion } from '../journal-motion-measurement'
import { measureInstalledSafari } from '../journal-safari-measurement'
import { measureJournalGroupDepth } from '../journal-group-depth-measurement'

let previousSettings: string | undefined
const PROJECT = 'E2E server journal'
const SHORT_PROJECT = 'E2E short groups'
const SORT_PROJECT = 'E2E grouped cipher'
const EXPAND_PROJECT = 'E2E expand unloaded groups'
test.beforeAll(async () => {
  await withLineProgramFixture(async db => {
    previousSettings = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,wdi,has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date)
      select $1,'SERVER',case when n<=250 then 'SERVER-A' else 'SERVER-B' end, 'S'||lpad(n::text,4,'0'),
      '2026-10-01','действующий','актуальная','С17',1,'да','годен','V-1','2026-10-01','V-1','2026-10-01' from generate_series(1,350) n`, [PROJECT])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [PROJECT])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,wdi)
      select $1,'SHORT', 'SHORT-'||lpad(((n-1)/2+1)::text,2,'0'), 'T'||lpad(n::text,2,'0'),
      '2026-10-01','действующий','актуальная','С17',1 from generate_series(1,18) n`, [SHORT_PROJECT])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [SHORT_PROJECT])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,wdi)
      select $1, 'CODE-'||code, 'LINE-'||line, 'G'||line||code,
      '2026-10-01','действующий','актуальная','С17',1
      from unnest(array['C','A','B']) code cross join generate_series(1,2) line`, [SORT_PROJECT])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [SORT_PROJECT])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,wdi)
      select $1,'CODE-'||code,'EXP-'||lpad(n::text,3,'0'),'E'||lpad(n::text,3,'0')||code,
      '2026-10-01','действующий','актуальная','С17',1
      from generate_series(1,120) n cross join unnest(array['A','B']) code`, [EXPAND_PROJECT])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [EXPAND_PROJECT])
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
  })
})
test.afterAll(async () => {
  await cleanupLineProgramProjects([PROJECT, SHORT_PROJECT, SORT_PROJECT, EXPAND_PROJECT])
  await withLineProgramFixture(db => previousSettings === undefined ? db.query("delete from app_settings where key='other'") : db.query("update app_settings set value=$1 where key='other'", [previousSettings]))
})
test.beforeEach(async ({ page }, info) => {
  if (process.env.JOURNAL_COMPOSITOR_LABEL === 'fallback') await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS)
    CSS.supports = ((property: string, value?: string) => property === 'animation-timeline' ? false
      : value === undefined ? supports(property) : supports(property, value)) as typeof CSS.supports
  })
  if (info.title.startsWith('scroll partner')) await page.addInitScript(() => {
    const active = new Map<number, number>()
    const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window)
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      const id = set(handler, timeout, ...args); active.set(id, timeout ?? 0); return id
    }) as typeof window.setInterval
    window.clearInterval = id => { if (typeof id === 'number') active.delete(id); clear(id) }
    ;(window as any).journalIntervals = active
  })
  const fields = /^(grouped resize|grouped browser)/.test(info.title) ? WELD_FIELDS.map(field => field.key)
    : info.title.startsWith('composited grouped rows') ? ['line', 'joint', 'projectTitle', 'subtitleCode', 'wdi', 'jointNextAction', 'finalStatus']
    : /^(journal interaction: grouped cipher|expand all includes)/.test(info.title) ? ['line', 'joint', 'subtitleCode', 'wdi'] : info.title.startsWith('normal CPU')
    ? ['line', 'joint', 'jointNextAction', 'vikRequest', 'vikResult', 'weldDate', 'finalStatus']
    : info.title.startsWith('slow scroll')
    ? ['line', 'joint', 'projectTitle', 'subtitleCode', 'groupName', 'category', 'weldControlPercent', 'isometry', 'finalStatus']
    : ['line', 'joint', 'wdi', 'weldDate']
  await page.addInitScript(({ fields, hidden, standardPins }) => {
    localStorage.setItem('welding-journal-ag-grid:v1', JSON.stringify({ columns: fields.map(colId => ({ colId, pinned: standardPins ? ['line', 'joint'].includes(colId) ? 'left' : colId === 'finalStatus' ? 'right' : null : 'left', width: colId === 'line' ? 200 : colId === 'jointNextAction' ? 340 : 120 })) }))
    localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({ activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
  }, { fields, hidden: WELD_FIELDS.filter(field => !fields.includes(field.key)).map(field => field.key), standardPins: /^(grouped resize|grouped browser|scroll placeholder)/.test(info.title) })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(PROJECT)
  await expect(page.getByText('Найдено: 350', { exact: true })).toBeVisible()

})

test('journal interaction: Space toggles the focused joint or complete group without scrolling or double activation', async ({ page }) => {
  const first = page.locator('.ag-row[row-index="0"]')
  const checkbox = page.getByRole('checkbox', { name: 'Выбрать стык S0001', exact: true })
  await first.locator('[col-id="wdi"]').click()
  const y = await page.evaluate(() => scrollY)
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toBeEnabled()
  await page.keyboard.down('Space')
  await page.keyboard.down('Space') // Holding Space must not toggle back.
  await page.keyboard.up('Space')
  await expect(checkbox).not.toBeChecked()
  expect(await page.evaluate(() => scrollY)).toBe(y)
  await expect(checkbox).toBeEnabled()
  await checkbox.focus()
  await page.keyboard.press('Space') // Native checkbox keeps its own activation.
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toBeEnabled()
  await page.keyboard.press('Space')
  await expect(checkbox).not.toBeChecked()

  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  const groupCheckbox = page.getByRole('checkbox', { name: 'Выбрать стыки группы SERVER-A', exact: true })
  const group = groupCheckbox.locator('xpath=ancestor::*[@role="row"][1]')
  await group.locator('[col-id="wdi"]').click()
  await page.keyboard.press('Space')
  await expect(page.getByText('Выбрано: 250', { exact: true })).toBeVisible()
  await expect(groupCheckbox).toBeChecked()
  await expect(groupCheckbox).toBeEnabled()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(groupCheckbox).not.toBeChecked()
  await expect(groupCheckbox).toBeEnabled()
  const expand = page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true })
  await expand.focus()
  await page.keyboard.press('Space') // Native button expands, not selects.
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await expect(groupCheckbox).not.toBeChecked()
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  await search.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Space')
  await expect(search).toHaveValue(`${PROJECT} `)
})

test('journal keyboard headers: arrows, Space filter and select all, Enter sort', async ({ page }) => {
  const line = page.locator('.ag-header-cell[col-id="line"]')
  const joint = page.locator('.ag-header-cell[col-id="joint"]')
  const all = page.locator('.ag-header-cell[col-id="ag-Grid-SelectionColumn"]')
  await page.locator('.ag-row[row-index="0"] [col-id="wdi"]').click()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.ag-header-cell[col-id="wdi"]')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.ag-row[row-index="0"] [col-id="wdi"]')).toBeFocused()
  const firstCheckbox = page.getByRole('checkbox', { name: 'Выбрать стык S0001', exact: true })
  await firstCheckbox.click()
  await expect(firstCheckbox).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(all).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.ag-row[row-index="0"] [col-id="ag-Grid-SelectionColumn"]')).toBeFocused()
  await line.click()
  await page.keyboard.press('ArrowRight')
  await expect(joint).toBeFocused()
  await page.keyboard.press('Space')
  const filter = page.getByRole('dialog', { name: 'Фильтр: Стык', exact: true })
  await expect(filter).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Найти значение фильтра' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(filter).not.toBeVisible()
  await expect(joint).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(joint).toHaveAttribute('aria-sort', 'ascending')
  await page.keyboard.press('Enter')
  await expect(joint).toHaveAttribute('aria-sort', 'descending')
  await page.keyboard.press('ArrowLeft')
  await expect(line).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(all).toBeFocused()
  const checkbox = all.getByRole('checkbox')
  await page.keyboard.press('Space')
  await expect(page.getByText('Выбрано: 350', { exact: true })).toBeVisible()
  await expect(checkbox).toBeChecked()
  await page.keyboard.press('Space')
  await expect(checkbox).not.toBeChecked()
  // Header navigation also works when the checkbox itself has native focus.
  await checkbox.focus()
  await page.keyboard.press('ArrowRight')
  await expect(line).toBeFocused()
})

test('journal keyboard selection paints one complete state per frame', async ({ page }) => {
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  await page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Выбрать стык S0001', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).includes('countJournalGridSelection')) await new Promise(resolve => setTimeout(resolve, 600))
    await route.continue().catch(() => {})
  })
  const group = page.getByRole('checkbox', { name: 'Выбрать стыки группы SERVER-A', exact: true })
  await group.locator('xpath=ancestor::*[@role="row"][1]').locator('[col-id="wdi"]').click()
  await page.evaluate(() => {
    const frames: unknown[] = []
    const state = { running: true, frames }
    ;(window as any).selectionFrames = state
    const tick = () => {
      const leaves = [...document.querySelectorAll<HTMLInputElement>('input[aria-label^="Выбрать стык "]')]
      const group = document.querySelector<HTMLInputElement>('input[aria-label="Выбрать стыки группы SERVER-A"]')!
      const header = document.querySelector<HTMLInputElement>('input[aria-label="Выбрать все стыки по текущим фильтрам"]')!
      frames.push({ time: performance.now(), leaves: leaves.length, checked: leaves.filter(node => node.checked).length,
        styled: leaves.filter(node => node.closest('.journal-server-selected')).length, group: group.checked, partial: header.indeterminate })
      if (state.running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.keyboard.press('Space')
  await expect(group).toBeChecked()
  await page.waitForTimeout(750)
  const frames = await page.evaluate(() => { const state = (window as any).selectionFrames; state.running = false; return state.frames })
  const transitions = frames.filter((value: any, index: number) => !index || ['checked', 'styled', 'group', 'partial'].some(key => value[key] !== frames[index - 1][key]))
  console.log('SELECTION_FRAMES', JSON.stringify(transitions))
  await writeFile(`/tmp/journal-selection-${process.env.JOURNAL_SELECTION_LABEL ?? 'current'}.json`, JSON.stringify(transitions, null, 2))
  expect(frames.filter((value: any) => value.group && (value.checked !== value.leaves || value.styled !== value.leaves || !value.partial))).toEqual([])
  await page.unrouteAll({ behavior: 'wait' })
})

test('journal keyboard loaded group: immediate checks and rapid toggles despite slow counters', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(SHORT_PROJECT)
  await expect(page.getByText('Найдено: 18', { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  await page.getByRole('button', { name: 'Развернуть группу SHORT-01', exact: true }).click()
  const group = page.getByRole('checkbox', { name: 'Выбрать стыки группы SHORT-01', exact: true })
  const first = page.getByRole('checkbox', { name: 'Выбрать стык T01', exact: true })
  const second = page.getByRole('checkbox', { name: 'Выбрать стык T02', exact: true })
  await expect(first).toBeVisible(); await expect(second).toBeVisible()
  let selectRequests = 0
  await page.route('**/_serverFn/**', async route => {
    const name = rpcName(route.request().url())
    if (name.includes('selectJournalGridRows')) selectRequests++
    if (/selectJournalGridRows|countJournalGridSelection/.test(name)) await new Promise(resolve => setTimeout(resolve, 800))
    await route.continue().catch(() => {})
  })
  await group.locator('xpath=ancestor::*[@role="row"][1]').locator('[col-id="wdi"]').click()
  const started = performance.now()
  await page.keyboard.press('Space')
  await expect(first).toBeChecked({ timeout: 500 })
  await expect(second).toBeChecked({ timeout: 500 })
  await expect(group).toBeChecked({ timeout: 500 })
  console.log('Loaded group Space to observed checks (ms):', Math.round(performance.now() - started))
  await page.waitForTimeout(120) // Counts are now in flight, not yet answered.
  for (const checked of [false, true, false, true]) {
    await page.keyboard.press('Space')
    await expect(group).toBeChecked({ checked, timeout: 500 })
    await expect(first).toBeChecked({ checked, timeout: 500 })
  }
  expect(selectRequests).toBe(0)
  await first.locator('xpath=ancestor::*[@role="row"][1]').locator('[col-id="wdi"]').click()
  await page.keyboard.press('Space')
  await expect(first).not.toBeChecked()
  await expect(second).toBeChecked()
  await expect(group).toHaveJSProperty('indeterminate', true)
  await page.unrouteAll({ behavior: 'wait' })
})

test('journal interaction: pointer menus do not preselect commands or create cell ranges', async ({ page }) => {
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  const group = page.locator('.ag-row-group').filter({ has: page.getByText('SERVER-A', { exact: true }) })
  await group.locator('.ag-group-value').click({ button: 'right' })
  const menu = page.getByTestId('context-action-menu')
  await expect(menu).toBeVisible()
  expect(await menu.locator('button:focus').count()).toBe(0)
  await expect(page.locator('.ag-cell-range-selected')).toHaveCount(0)
  await menu.getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await expect(page.locator('.ag-cell-range-selected')).toHaveCount(0)
  await expect(group.locator('.ag-cell-focus')).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('button', { name: 'Свернуть', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.ag-cell-focus')).toBeFocused()
  // An intentional range remains available for copying from a row menu.
  await page.locator('.ag-row[row-index="1"] [col-id="wdi"]').click()
  await page.keyboard.press('Shift+ArrowDown')
  const selected = await page.locator('.ag-cell-range-selected').count()
  expect(selected).toBeGreaterThan(1)
  await page.locator('.ag-row[row-index="1"] [col-id="joint"]').click({ button: 'right' })
  await expect(menu).toBeVisible()
  await expect(page.locator('.ag-cell-range-selected')).toHaveCount(selected)
})

test('expand all includes unloaded root blocks and nested levels without fetching the whole report', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('searchbox').fill(EXPAND_PROJECT)
  await expect(page.getByText('Найдено: 240', { exact: true })).toBeVisible()
  const groupBy = async (id: string) => {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
  }
  const command = async (name: string) => {
    await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
    await page.getByTestId('context-action-menu').getByRole('button', { name, exact: true }).click()
  }
  await groupBy('line')
  await expect(page.getByRole('button', { name: 'Развернуть группу EXP-001', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const reads: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name.startsWith('readJournalGrid')) reads.push(name) })
  await command('Развернуть все')
  await expect(page.getByRole('button', { name: 'E001A', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(reads.length).toBeLessThan(30) // 120 roots must not cause 120 leaf requests.
  // Root block 100..119 did not exist when Expand All was invoked.
  await expect.poll(async () => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    return page.getByRole('button', { name: 'Свернуть группу EXP-120', exact: true }).isVisible()
  }).toBe(true)
  // Loading and expanding that block adds rows below the previous bottom.
  await expect.poll(async () => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    return page.getByRole('button', { name: 'E120B', exact: true }).isVisible()
  }).toBe(true)
  await page.waitForLoadState('networkidle')
  expect(reads.length).toBeLessThan(55)
  await page.getByRole('button', { name: 'E120B', exact: true }).locator('xpath=ancestor::*[@role="row"][1]').locator('[col-id="joint"]').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).trim().split(/\r?\n/).at(-1))).toBe('E120B')
  // A regroup resets expansion; a single command must reach new child levels.
  await page.evaluate(() => scrollTo(0, 0))
  await groupBy('subtitleCode')
  await expect(page.getByRole('button', { name: 'Развернуть группу EXP-001', exact: true })).toBeVisible()
  reads.length = 0
  await command('Развернуть все')
  await expect(page.getByRole('button', { name: 'E001A', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Свернуть группу CODE-A', exact: true }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(reads.length).toBeLessThan(30)
  // Individual overrides still work while the remaining groups stay open.
  await page.getByRole('button', { name: 'Свернуть группу EXP-001', exact: true }).click()
  await expect(page.getByRole('button', { name: 'E001A', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Развернуть группу EXP-001', exact: true }).click()
  await expect(page.getByRole('button', { name: 'E001A', exact: true })).toBeVisible()
  await command('Свернуть все')
  await expect.poll(async () => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    return page.getByRole('button', { name: 'Развернуть группу EXP-120', exact: true }).isVisible()
  }).toBe(true)
  await page.getByRole('button', { name: 'Развернуть группу EXP-120', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Развернуть группу CODE-A', exact: true }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: 'E120A', exact: true })).toHaveCount(0)
})

test('composited rows follow native scrolling between JavaScript updates', async ({ page }, info) => {
  test.skip(!process.env.JOURNAL_COMPOSITOR_LABEL, 'Opt-in compositor-pixel comparison')
  await journalCompositorProbe(page, info)
})

test('scroll pipeline avoids repeated chrome geometry and covers unpainted rows', async ({ page }, info) => {
  test.skip(!process.env.JOURNAL_GAP_LABEL, 'Opt-in scroll pipeline diagnostic')
  const label = process.env.JOURNAL_GAP_LABEL!
  const cdp = await page.context().newCDPSession(page)
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  await page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }).click()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  const scroll = async () => {
    for (const yDistance of [-5000, 5000]) await cdp.send('Input.synthesizeScrollGesture', { x: 700, y: 500, yDistance, speed: 8000, gestureSourceType: 'mouse' })
  }
  await scroll()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => {
    const counters = { sidebar: 0, boundary: 0 }
    ;(window as any).chromeGeometry = counters
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-app-sidebar')) counters.sidebar++
      if (this.hasAttribute('data-scroll-top-boundary')) counters.boundary++
      return original.call(this)
    }
  })
  const events: any[] = []
  cdp.on('Tracing.dataCollected', event => events.push(...event.value))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
  await scroll()
  const done = new Promise<void>(resolve => cdp.once('Tracing.tracingComplete', () => resolve()))
  await cdp.send('Tracing.end'); await done
  const geometry = await page.evaluate(() => (window as any).chromeGeometry)
  const layout = events.filter(event => event.name === 'Layout' && event.ph === 'X')
  const result = { geometry, layoutCount: layout.length, layoutMs: layout.reduce((sum, event) => sum + event.dur / 1000, 0) }
  await writeFile(`/tmp/journal-pipeline-${label}.json`, JSON.stringify(result))
  console.log('SCROLL_PIPELINE', JSON.stringify(result))
  // Simulate the paint gap independently of network timing: the grid's row
  // layer is temporarily absent, exactly where an underlay must be visible.
  const viewport = page.locator('.ag-grid-viewport')
  await page.evaluate(() => scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 700))
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(700)
  const style = await page.addStyleTag({ content: '.ag-grid-scrolling-container { visibility: hidden !important; }' })
  await page.screenshot({ path: `/tmp/journal-gap-${label}.png` })
  const background = await viewport.evaluate(element => getComputedStyle(element).backgroundImage)
  await style.evaluate(element => element.parentNode?.removeChild(element))
  if (label.endsWith('after')) {
    expect(geometry.sidebar).toBe(0)
    expect(geometry.boundary).toBeLessThanOrEqual(2) // Button appears/disappears once.
    expect(background).toContain('data:image/svg+xml')
  }
  await info.attach('pipeline.json', { body: JSON.stringify({ ...result, background }), contentType: 'application/json' })
  await cdp.detach()
})

test('scroll placeholder is static, follows columns and leaves short and empty results clear', async ({ page }, info) => {
  const viewport = page.locator('.ag-grid-viewport')
  const tile = () => viewport.evaluate(element => element.style.getPropertyValue('--journal-gap-image'))
  await expect.poll(tile).toContain('data:image/svg+xml')
  const initial = await tile()
  expect(await page.locator('.ag-row').first().evaluate(element => getComputedStyle(element).getPropertyValue('--journal-gap-image').trim())).toBe('none')
  await page.evaluate(() => scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 700))
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(700)
  expect(await tile()).toBe(initial)
  await expect(viewport).toHaveCSS('animation-name', 'none')
  await expect(viewport).toHaveCSS('transition-duration', '0s')
  const hide = await page.addStyleTag({ content: '.ag-grid-scrolling-container { visibility:hidden !important; }' })
  await page.screenshot({ path: info.outputPath('static-scroll-placeholder.png') })
  await hide.evaluate(element => element.parentNode?.removeChild(element))
  const handle = (await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-resize').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, { steps: 20 })
  expect(await tile()).toBe(initial)
  await expect(page.locator('.ag-header-cell[col-id="line"]')).toHaveCSS('width', '260px')
  await page.mouse.up()
  await expect.poll(tile).not.toBe(initial)
  await page.setViewportSize({ width: 1100, height: 900 })
  await expect.poll(tile).not.toBe(initial)
  const narrow = await tile()
  await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect.poll(tile).not.toBe(narrow)
  await page.evaluate(() => scrollTo(0, 0))
  await page.getByRole('searchbox').fill(SORT_PROJECT)
  await expect(page.getByText('Найдено: 6', { exact: true })).toBeVisible()
  await expect(viewport).toHaveCSS('background-image', 'none')
  await expect(page.locator('[data-journal-scrollable]')).toHaveCount(0)
  await page.getByRole('searchbox').fill('E2E no matching scroll placeholder result')
  await expect(page.getByText('Найдено: 0', { exact: true })).toBeVisible()
  await expect(viewport).toHaveCSS('background-image', 'none')
})

test('composited gaps retain the static placeholder while row rendering catches up', async ({ page }) => {
  test.skip(!process.env.JOURNAL_GAP_LABEL, 'Opt-in compositor gap diagnostic')
  await captureJournalGaps(page)
})

test('composited grouped rows follow native scrolling between JavaScript updates', async ({ page }, info) => {
  test.skip(!process.env.JOURNAL_COMPOSITOR_LABEL, 'Opt-in compositor-pixel comparison')
  await page.getByRole('searchbox').fill(SHORT_PROJECT)
  await expect(page.getByText('Найдено: 18', { exact: true })).toBeVisible()
  for (const id of ['line', 'projectTitle', 'subtitleCode']) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
  }
  await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(page.getByRole('button', { name: 'T01', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  // This probe compares pixels against a fixed document ruler. Finish the
  // bounded fixture's expand-on-load stores before calibrating that ruler;
  // otherwise the model/scroll extent changes during the measurement.
  await expect.poll(async () => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    return page.getByRole('button', { name: 'T18', exact: true }).isVisible()
  }).toBe(true)
  await expect(page.locator('.journal-loading-cell')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  await journalCompositorProbe(page, info, true)
})

test('native row positioning preserves horizontal alignment, resize and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.evaluate(() => scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 400))
  const viewport = page.locator('.ag-grid-viewport')
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(400)
  await expect(page.locator('[data-journal-native-scroll]')).toHaveCount(process.env.JOURNAL_COMPOSITOR_LABEL === 'fallback' ? 0 : 1)
  const row = page.locator('.ag-grid-scrolling-rows .ag-row[row-index="10"]')
  const line = row.locator('[col-id="line"]')
  await expect(line).toBeVisible()
  const left = (await line.boundingBox())!.x
  await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth })
  expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(async () => (await line.boundingBox())!.x).toBe(left)
  const cell = row.locator('[col-id="finalStatus"]')
  await expect.poll(async () => Math.abs((await cell.boundingBox())!.x - (await page.locator('.ag-header-cell[col-id="finalStatus"]').boundingBox())!.x)).toBeLessThan(1)
  await page.setViewportSize({ width: 1600, height: 1000 })
  // Responsive page controls get shorter at the wider viewport. Keep the row
  // position matched to the document's new origin, not the old 400px offset.
  await expect.poll(() => viewport.evaluate(element => Math.abs(element.scrollTop - Math.max(0, -document.querySelector('.journal-page-track')!.getBoundingClientRect().top)))).toBeLessThan(1)
  const misaligned = () => row.evaluate(element => [...element.querySelectorAll<HTMLElement>('.ag-cell')].flatMap(cell => {
    const id = cell.getAttribute('col-id')!
    const header = document.querySelector(`.ag-header-cell[col-id="${CSS.escape(id)}"]`)
    if (!header) return []
    const body = cell.getBoundingClientRect(), head = header.getBoundingClientRect()
    return body.right > 280 && body.left < innerWidth && Math.abs(body.x - head.x) > 1 ? [{ id, cell: body.x, header: head.x }] : []
  }))
  await expect.poll(misaligned).toEqual([])
  await viewport.evaluate(element => { element.scrollLeft = 0 })
  await expect.poll(misaligned).toEqual([])
  await line.click()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.ag-cell-focus').locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '11')
})

test('journal interaction: header sorting keeps groups expanded and sorts their leaves', async ({ page }) => {
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  await page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }).click()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  const header = page.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-text')
  await header.click()
  await expect(page.getByRole('button', { name: 'Свернуть группу SERVER-A', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await header.click()
  await expect(page.locator('.ag-row[row-index="1"] [col-id="joint"]')).toContainText('S0250')
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-text').click()
  await expect(page.locator('.ag-row[row-index="0"] .ag-group-value')).toHaveText('SERVER-A')
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-text').click()
  await expect(page.locator('.ag-row[row-index="0"] .ag-group-value')).toHaveText('SERVER-B')
  await expect(page.getByRole('button', { name: 'Свернуть группу SERVER-A', exact: true })).toBeVisible()
})

for (const nested of [false, true]) test(`journal interaction: grouped cipher sorts ${nested ? 'inside lines' : 'at root'}`, async ({ page }) => {
  await page.getByRole('searchbox').fill(SORT_PROJECT)
  await expect(page.getByText('Найдено: 6', { exact: true })).toBeVisible()
  for (const field of nested ? ['line', 'subtitleCode'] : ['subtitleCode']) {
    await page.locator(`.ag-header-cell[col-id="${field}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
  }
  if (nested) await page.getByRole('button', { name: 'Развернуть группу LINE-1', exact: true }).click()
  const values = page.locator(`.ag-row-group.ag-row-level-${nested ? 1 : 0} .ag-group-value`)
  await expect(values).toHaveText(['CODE-A', 'CODE-B', 'CODE-C'])
  const header = page.locator('.ag-header-cell[col-id="subtitleCode"]')
  await header.locator('.ag-header-cell-text').click()
  await expect(header).toHaveAttribute('aria-sort', 'ascending')
  await header.locator('.ag-header-cell-text').click()
  await expect(header).toHaveAttribute('aria-sort', 'descending')
  await expect(values).toHaveText(['CODE-C', 'CODE-B', 'CODE-A'])
  if (nested) {
    await expect(page.locator('.ag-row-group.ag-row-level-0 .ag-group-value')).toHaveText(['LINE-1', 'LINE-2'])
    await expect(page.getByRole('button', { name: 'Свернуть группу LINE-1', exact: true })).toBeVisible()
  }
  await header.locator('.ag-header-cell-text').click()
  await expect(header).toHaveAttribute('aria-sort', 'none')
  await expect(values).toHaveText(['CODE-A', 'CODE-B', 'CODE-C'])
})

test('journal interaction: filter transition starts with committed rows and does not block input', async ({ page }) => {
  await page.waitForLoadState('networkidle')
  const motion = await observeGridResults(page, '.journal-grid-frame .ag-grid-scrolling-container')
  await page.evaluate(() => {
    const animate = Element.prototype.animate
    ;(window as any).journalReveals = []
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      if (this.matches('.journal-grid-frame .ag-grid-scrolling-container')) (window as any).journalReveals.push({
        first: this.querySelector('.ag-row[row-index="0"] [col-id="joint"]')?.textContent,
        busy: this.closest('[aria-busy]')?.getAttribute('aria-busy'),
      })
      return animate.apply(this, args)
    }
  })
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  const reads: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name.startsWith('readJournalGrid')) reads.push(name) })
  await search.fill('SERVER-B')
  await expect(page.getByRole('button', { name: 'S0251', exact: true })).toBeVisible()
  await motion.completed(1)
  expect(await page.evaluate(() => (window as any).journalReveals)).toEqual([{ first: 'S0251', busy: 'false' }])
  await expect(search).toBeFocused()
  expect(reads).toHaveLength(1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await search.fill(PROJECT)
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect((await motion.read()).length).toBe(1)
})

test('scroll partner stays measurable and leaves no visibility retry timers running', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  for (let pass = 0; pass < 2; pass++) {
    await cdp.send('Input.synthesizeScrollGesture', { x: 600, y: 500, yDistance: -1400, speed: 1400, gestureSourceType: 'mouse' })
    await cdp.send('Input.synthesizeScrollGesture', { x: 600, y: 500, yDistance: 1400, speed: 1400, gestureSourceType: 'mouse' })
  }
  await page.waitForTimeout(250)
  const result = await page.evaluate(() => ({
    retries: [...(window as any).journalIntervals.values()].filter(delay => delay === 10).length,
    measurable: document.querySelector('.ag-body-vertical-scroll-viewport')!.checkVisibility({ checkVisibilityCSS: true }),
  }))
  console.log('SCROLL_PARTNER', JSON.stringify(result))
  expect(result).toEqual({ retries: 0, measurable: true })
  await cdp.detach()
})
test('page viewport, automatic blocks, and full groups without loading their leaves', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('button', { name: 'Загрузить ещё', exact: true })).toHaveCount(0)
  const footer = page.locator('[data-journal-footer]')
  expect((await footer.boundingBox())!.y + (await footer.boundingBox())!.height).toBeLessThanOrEqual(1000)
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(1000)
  await expect(page.locator('.ag-body-vertical-scroll')).toHaveCSS('opacity', '0')
  await expect(page.locator('.ag-body-vertical-scroll')).toHaveCSS('pointer-events', 'none')
  await expect(page.locator('.journal-server-checkbox .ag-checkbox-input-wrapper').first()).toBeVisible()
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  const group = page.locator('.ag-row-group').filter({ has: page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }) })
  await expect(group.locator('[data-group-summary="joint"]')).toHaveText('250')
  await expect(group.locator('[data-group-summary="wdi"]')).toHaveText('250')
  await group.getByRole('checkbox').click()
  await expect(page.getByText('Выбрано: 250', { exact: true })).toBeVisible()
  await expect(group.getByRole('checkbox')).toBeChecked()
  await group.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }).click()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await expect(page.locator('.ag-row:not(.ag-row-group)').filter({ has: page.getByRole('button', { name: 'S0001', exact: true }) }).getByRole('checkbox')).toBeChecked()
  await page.screenshot({ path: info.outputPath('journal-server.png') })
  expect(errors).toEqual([])
  expect(calls.filter(name => name.startsWith('listWeldingJournalPage'))).toHaveLength(0)
})


test('range totals and clipboard include unloaded rows; scrolling loads bounded blocks', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const requests: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) requests.push(name) })
  await page.locator('.ag-row[row-index="0"] .ag-cell[col-id="wdi"]').click()
  await page.keyboard.press('ControlOrMeta+Shift+ArrowDown')
  await expect(page.getByText('Количество: 350', { exact: true })).toBeVisible()
  await expect(page.getByText('Сумма: 350', { exact: true })).toBeVisible()
  await expect(page.getByText('Среднее: 1', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'))).toBe('WDI\n' + Array(350).fill('1,000').join('\n'))
  await page.locator('.ag-grid-viewport').evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(page.getByRole('button', { name: 'S0350', exact: true })).toBeVisible()
  expect(requests.filter(name => name.startsWith('readJournalGrid')).length).toBeLessThanOrEqual(4)
  expect(requests.filter(name => name.startsWith('summarizeJournalGridRange')).length).toBeLessThanOrEqual(3)
  await page.locator('.ag-grid-viewport').evaluate(element => { element.scrollTop = 0 })
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
})

test('unloaded and cancelled blocks show skeletons while the newest filter is loading', async ({ page }, info) => {
  let releaseBlock!: () => void, releaseFilter!: () => void
  const block = new Promise<void>(resolve => { releaseBlock = resolve })
  const filter = new Promise<void>(resolve => { releaseFilter = resolve })
  let calls = 0
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('readJournalGrid')) {
      calls++
      if (calls === 1) await block
      else if (calls === 2) await filter
    }
    await route.continue()
  })
  try {
    await page.locator('.ag-grid-viewport').evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(page.locator('.journal-loading-cell').first()).toBeVisible()
    // Filling the offscreen search scrolls back to the toolbar. Return to the
    // pending block while the replacement is held to inspect the cancelled store.
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('SERVER-B')
    await expect.poll(() => calls).toBeGreaterThanOrEqual(2)
    await page.locator('.ag-grid-viewport').evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(page.locator('.journal-loading-cell').first()).toBeVisible()
    await expect(page.locator('.ag-cell').filter({ hasText: 'Не удалось загрузить' })).toHaveCount(0)
    await expect(page.locator('.journal-load-error')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('journal-loading-skeleton.png') })
  } finally { releaseBlock(); releaseFilter() }
  await expect(page.getByText('Найдено: 100', { exact: true })).toBeVisible()
  await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  // This test deliberately moved to the bottom while the replacement was
  // pending. Return via the user scroll surface before checking its first row;
  // viewport/document acknowledgement order differs between browser engines.
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.getByRole('button', { name: 'S0251', exact: true })).toBeVisible()
})

test('initial loading uses skeletons, real errors have one viewport notice, and retry recovers', async ({ page }) => {
  let release!: () => void
  let held = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('readJournalGrid')) {
      const attempt = ++calls
      await held
      if (attempt === 1) { await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporarily unavailable' }); return }
    }
    await route.continue()
  })
  try {
    await page.reload()
    await expect(page.locator('.journal-loading-cell').first()).toBeVisible()
    release()
    const notice = page.locator('.journal-load-error')
    await expect(notice).toHaveCount(1)
    await expect(notice).toBeVisible()
    const failureMessage = await notice.locator('span').getAttribute('title')
    await expect(page.locator('.ag-cell').filter({ hasText: 'Не удалось загрузить' })).toHaveCount(0)
    held = new Promise<void>(resolve => { release = resolve })
    await notice.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.locator('.journal-update-notice')).toHaveText('Обновление…')
    release()
    await expect(page.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
    if (failureMessage) await expect(page.getByText(failureMessage, { exact: true })).toHaveCount(0)
  } finally { release() }
})

test('nested groups, partial selection, and filter changes keep their exact scope', async ({ page }) => {
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
  await page.getByRole('checkbox', { name: 'Выбрать стыки группы SERVER-A', exact: true }).click()
  await expect(page.getByText('Выбрано: 250', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Выбрать стык S0001', exact: true }).click()
  await expect(page.getByText('Выбрано: 249', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Выбрать стыки группы SERVER-A', exact: true })).toBeChecked({ indeterminate: true })
  await page.locator('.ag-header-cell[col-id="weldDate"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Дата сварки/ }).click()
  await page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Развернуть группу 2026-10-01', exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('SERVER-B')
  await expect(page.getByText('Найдено: 100', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true })).toHaveCount(0)
})


test('document scroll hides heading, keeps table chrome, and follows keyboard and resize', async ({ page }, info) => {
  const frame = page.locator('.journal-grid-frame')
  const viewport = page.locator('.ag-grid-viewport')
  const readPosition = () => page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.ag-grid-viewport')!
    const track = document.querySelector<HTMLElement>('.journal-page-track')!
    return { page: scrollY, grid: viewport.scrollTop, origin: track.getBoundingClientRect().top + scrollY,
      rows: document.querySelectorAll('.ag-grid-scrolling-rows .ag-row').length }
  })
  const box = (await frame.boundingBox())!
  await page.mouse.move(box.x + 120, box.y + 60)
  await page.mouse.wheel(0, 80)
  await expect.poll(async () => (await readPosition()).page).toBeGreaterThan(60)
  expect((await readPosition()).grid).toBe(0)
  expect((await readPosition()).page).toBeLessThan(150)
  await page.mouse.move(box.x + 120, box.y + 180)
  await page.mouse.wheel(0, 650)
  await expect.poll(async () => (await readPosition()).page).toBeGreaterThan(600)
  await expect.poll(async () => (await frame.boundingBox())!.y).toBeLessThan(2)
  await expect.poll(async () => {
    const p = await readPosition(); return Math.abs(p.page - p.origin - p.grid)
  }).toBeLessThan(2)
  await expect(page.getByRole('heading', { name: 'Сварочный журнал', exact: true })).not.toBeInViewport()
  await expect(page.locator('.ag-header')).toBeInViewport()
  await expect(page.locator('[data-journal-footer]')).toBeInViewport()
  await page.screenshot({ path: info.outputPath('journal-page-scroll.png') })
  // Dragging the native page scrollbar to the end is equivalent to this document scroll.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByRole('button', { name: 'S0350', exact: true })).toBeVisible()
  expect((await readPosition()).rows).toBeLessThan(60)
  await page.locator('.ag-row[row-index="349"] .ag-cell[col-id="wdi"]').click()
  await page.keyboard.press('Home')
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await expect.poll(async () => (await readPosition()).grid).toBeLessThan(2)
  await page.mouse.wheel(0, -1000)
  await expect.poll(async () => (await readPosition()).page).toBeLessThan(2)
  await expect(page.getByRole('heading', { name: 'Сварочный журнал', exact: true })).toBeInViewport()
  await page.setViewportSize({ width: 1200, height: 760 })
  await expect.poll(async () => (await page.locator('[data-journal-footer]').boundingBox())!.y).toBeLessThan(760)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByRole('button', { name: 'S0350', exact: true })).toBeVisible()
  // Replacing the query at the bottom must shrink the page and leave the result accessible.
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('S0001')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await expect.poll(async () => (await readPosition()).grid).toBeLessThan(2)
  await expect(viewport).toHaveCSS('overflow-y', 'hidden')
})

for (const sorting of [false, true]) test(`${sorting ? 'sort' : 'filter'} keeps the previous rows and page height until the replacement is ready, with stale actions disabled`, async ({ page }) => {
  const frame = page.locator('.journal-grid-frame')
  const first = page.locator('.ag-row[row-index="0"]')
  await expect(first.locator('[col-id="joint"]')).toHaveText('S0001')
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const requested = new Promise<void>(resolve => { started = resolve })
  let blocked = false
  await page.route('**/_serverFn/**', async route => {
    if (!blocked && rpcName(route.request().url()).startsWith('readJournalGrid')) {
      blocked = true; started(); await held
    }
    await route.continue()
  })
  if (sorting) {
    await page.locator('.ag-header-cell[col-id="joint"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
  } else await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('SERVER-B')
  await requested
  try {
    await expect(frame).toHaveAttribute('aria-busy', 'true')
    await expect(frame.getByRole('status')).toHaveText('Обновление…')
    await expect(first.locator('[col-id="joint"]')).toHaveText('S0001')
    await expect(first.getByRole('button', { name: 'Редактировать', exact: true })).toBeDisabled()
    await expect(first.getByRole('checkbox')).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height)
  } finally { release() }
  await expect(frame).toHaveAttribute('aria-busy', 'false')
  await expect(first.locator('[col-id="joint"]')).toHaveText(sorting ? 'S0350' : 'S0251')
  await expect(first.getByRole('checkbox')).toBeEnabled()
  await expect(page.getByText(sorting ? 'Найдено: 350' : 'Найдено: 100', { exact: true })).toBeVisible()
})

test('wheel scrolling remains monotonic through the heading and across loaded blocks', async ({ page }, info) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start')
  await page.evaluate(() => {
    const samples: { y: number; top: number; grid: number; height: number; time: number }[] = []
    const state = { samples, active: true }
    ;(window as any).scrollProbe = state
    const tick = () => {
      if (!state.active) return
      const stage = document.querySelector('.journal-page-stage')!
      const viewport = document.querySelector('.ag-grid-viewport')!
      samples.push({ y: scrollY, top: stage.getBoundingClientRect().top, grid: viewport.scrollTop, height: document.documentElement.scrollHeight, time: performance.now() })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.mouse.move(750, 500)
  for (let i = 0; i < 45; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 750, y: 500, deltaX: 0, deltaY: 80 }); await page.waitForTimeout(18) }
  await page.waitForTimeout(400)
  const down = await page.evaluate(() => {
    const state = (window as any).scrollProbe
    const samples = state.samples.splice(0)
    return samples
  })
  for (let i = 0; i < 45; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 750, y: 500, deltaX: 0, deltaY: -80 }); await page.waitForTimeout(18) }
  await page.waitForTimeout(400)
  const up = await page.evaluate(() => { const state = (window as any).scrollProbe; state.active = false; return state.samples })
  const origin = down[0].top + down[0].y
  const summarize = (samples: { y: number; top: number; grid: number; height: number; time: number }[], direction: number) => {
    const frames = samples.slice(1).map((s, i) => s.time - samples[i].time).sort((a, b) => a - b)
    return { lagFrames: samples.filter(s => Math.abs(Math.max(0, s.y - origin) - s.grid) > 1).length, reversals: samples.slice(1).filter((s, i) => (s.y - samples[i].y) * direction < -1).length,
      heightSwing: Math.max(...samples.map(s => s.height)) - Math.min(...samples.map(s => s.height)),
      p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1), end: samples.at(-1)?.y }
  }
  const metrics = { down: summarize(down, 1), up: summarize(up, -1) }
  await info.attach('scroll-frames.json', { body: JSON.stringify({ metrics, down, up }), contentType: 'application/json' })
  const { profile } = await cdp.send('Profiler.stop')
  const label = process.env.JOURNAL_SCROLL_LABEL === 'after' ? 'after' : 'before'
  await writeFile(`/tmp/journal-scroll-${label}.json`, JSON.stringify({ metrics, down, up }))
  await writeFile(`/tmp/journal-scroll-${label}.cpuprofile`, JSON.stringify(profile))
  console.log('JOURNAL_SCROLL', JSON.stringify(metrics))
  if (label === 'after') { expect(metrics.down.lagFrames).toBe(0); expect(metrics.up.lagFrames).toBe(0) }
  expect(metrics.down.reversals).toBe(0)
  expect(metrics.up.reversals).toBe(0)
  expect(metrics.up.end).toBeLessThanOrEqual(1)
})

test('only joint and next-step cells show styled tips, dismissed on scroll and Escape', async ({ page }, info) => {
  const first = page.locator('.ag-row[row-index="0"]')
  await first.locator('[col-id="joint"]').hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toContainText('Стык S0001')
  await expect(tip).toContainText('хронологию')
  await page.screenshot({ path: info.outputPath('joint-tooltip.png') })
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toHaveValue(PROJECT)
  await first.locator('[col-id="line"]').hover()
  await page.waitForTimeout(550)
  await expect(tip).toHaveCount(0)
  await expect(first.locator('[col-id="line"] [title], [col-id="line"][title], [col-id="wdi"] [title], [col-id="finalStatus"] [title], [col-id="__actions"] [title]')).toHaveCount(0)
  await first.locator('[data-joint-next-action-cell] > div').hover()
  await expect(tip).toContainText('Нажмите, чтобы открыть картину стыка')
  await expect(first.locator('[data-joint-next-action-cell][title]')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('next-step-tooltip.png') })
  await page.mouse.wheel(0, 180)
  await expect(tip).toHaveCount(0)
})

test('group transitions move surviving rows without delayed requests or retained collapsed cells', async ({ page }) => {
  await page.locator('.ag-header-cell[col-id="joint"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Сгруппировать.*Стык/ }).click()
  await expect(page.getByRole('button', { name: 'Развернуть группу S0001', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const state = { transitions: 0, clicked: 0, duration: '' }
    ;(window as any).groupMotionProbe = state
    document.querySelector('.journal-grid-frame')!.addEventListener('transitionrun', event => {
      if ((event as TransitionEvent).propertyName === 'transform' && (event.target as Element).matches('.ag-row')) {
        state.transitions++
        state.duration = getComputedStyle(event.target as Element).transitionDuration
      }
    })
    document.querySelector('.journal-grid-frame')!.addEventListener('click', () => { state.clicked = Date.now() }, true)
  })
  let requestAt = 0
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid')) requestAt ||= Date.now() })
  await page.getByRole('button', { name: 'Развернуть группу S0001', exact: true }).click()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  const clicked = await page.evaluate(() => (window as any).groupMotionProbe.clicked)
  expect(requestAt - clicked).toBeGreaterThanOrEqual(0)
  expect(requestAt - clicked).toBeLessThan(300)
  await expect.poll(() => page.evaluate(() => (window as any).groupMotionProbe.transitions)).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as any).groupMotionProbe.duration)).toBe('0.12s')
  console.log('Journal group motion', JSON.stringify({ requestStartMs: requestAt - clicked, transitionMs: 120 }))
  await page.getByRole('button', { name: 'Свернуть группу S0001', exact: true }).click()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toHaveCount(0)
  const ids = await page.locator('.ag-grid-scrolling-rows .ag-row').evaluateAll(rows => rows.map(row => row.getAttribute('row-id')))
  expect(new Set(ids).size).toBe(ids.length)
  await page.mouse.wheel(0, 80)
  await expect(page.locator('.journal-grid-frame')).not.toHaveClass(/journal-group-motion/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Развернуть группу S0001', exact: true }).click()
  await expect(page.locator('.journal-grid-frame')).not.toHaveClass(/journal-group-motion/)
})

test('sticky nested groups retain their cells while scrolling across the pin boundary', async ({ page, browserName }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  for (const [id, label] of [['line', 'Линия'], ['weldDate', 'Дата сварки'], ['wdi', 'WDI']]) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: new RegExp(`Сгруппировать.*${label}`) }).click()
  }
  for (const label of ['SERVER-A', '2026-10-01', '1']) {
    await page.getByRole('button', { name: `Развернуть группу ${label}`, exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const state = { samples: [] as unknown[], running: true }
    ;(window as any).stickyProbe = state
    const sample = () => {
      const viewport = document.querySelector<HTMLElement>('.ag-grid-viewport')!
      const sticky = document.querySelector<HTMLElement>('.ag-grid-sticky-top-rows-container')!
      const headerBottom = document.querySelector('.ag-header')!.getBoundingClientRect().bottom
      state.samples.push({ time: performance.now(), scroll: viewport.scrollTop, height: sticky.clientHeight,
        bodyCells: document.querySelectorAll('.ag-grid-scrolling-rows .ag-cell').length,
        // Immediately before pinning, the original three ancestor rows may
        // still display their labels in the body. An empty sticky container
        // alone is not a blink; verify that representation instead.
        originalRows: Array.from(document.querySelectorAll('.ag-grid-scrolling-rows .ag-row-group'))
          .filter(row => row.hasAttribute('row-index') && Number(row.getAttribute('row-index')) < 3)
          .filter(row => { const r = row.getBoundingClientRect(); return r.top + r.height / 2 >= headerBottom && r.bottom <= innerHeight })
          .map(row => ({ id: row.getAttribute('row-id'), cells: row.querySelectorAll('.ag-cell').length, text: row.textContent, opacity: getComputedStyle(row).opacity })),
        rows: Array.from(sticky.querySelectorAll('.ag-row')).map(row => ({ id: row.getAttribute('row-id'), cells: row.querySelectorAll('.ag-cell').length,
          text: row.textContent, opacity: getComputedStyle(row).opacity })) })
      if (state.running) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const origin = await page.locator('.journal-page-track').evaluate(el => el.getBoundingClientRect().top + scrollY)
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: process.env.JOURNAL_STICKY_CPU === '1' ? 1 : 4 })
  await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), origin)
  const box = (await page.locator('.journal-grid-frame').boundingBox())!
  // Both engines must scroll over the actual cells, including sticky handoffs.
  if (!cdp) await page.mouse.move(box.x + 320, 300)
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const deltaY of [8, 8, 20, 40, 100, -100, -40, -20, -8, -8]) {
      if (cdp) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x + 320, y: 300, deltaX: 0, deltaY })
      else await page.mouse.wheel(0, deltaY)
      await page.waitForTimeout(25)
    }
  }
  await page.waitForTimeout(150)
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const samples = await page.evaluate(() => { (window as any).stickyProbe.running = false; return (window as any).stickyProbe.samples })
  await writeFile(info.outputPath('sticky-frames.json'), JSON.stringify(samples))
  const missing = samples.filter((sample: any) => {
    const rows = sample.height > 0 ? sample.rows : sample.originalRows
    return sample.scroll > 2 && (rows.length < 3 || rows.some((row: any) => !row.cells || !row.text || row.opacity !== '1'))
  })
  console.log('STICKY_PROBE', JSON.stringify({ frames: samples.length, missing: missing.length, examples: missing.slice(0, 4) }))
  await page.screenshot({ path: info.outputPath('sticky.png') })
  expect(samples.length).toBeGreaterThan(20)
  expect(samples.some((sample: any) => sample.scroll > 100)).toBe(true)
  expect(samples.filter((sample: any) => !sample.bodyCells)).toEqual([])
  expect(missing).toEqual([])
  expect(errors).toEqual([])
})

test('slow scroll across short nested groups keeps the page chrome and table continuous', async ({ page, browserName }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(SHORT_PROJECT)
  await expect(page.getByText('Найдено: 18', { exact: true })).toBeVisible()
  for (const [id, label] of [['line', 'Линия'], ['projectTitle', 'Проект'], ['subtitleCode', 'Шифр']]) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: new RegExp(`Сгруппировать.*${label}`) }).click()
  }
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  const scroll = async (distance: number, speed: number) => {
    if (cdp) {
      await cdp.send('Input.synthesizeScrollGesture', { x: 600, y: 450, yDistance: distance, speed, gestureSourceType: 'mouse' })
    } else {
      await page.mouse.move(600, 450)
      for (let remaining = Math.abs(distance); remaining > 0; remaining -= 10) {
        const step = Math.min(10, remaining)
        await page.mouse.wheel(0, -Math.sign(distance) * step)
        await page.waitForTimeout(step / speed * 1000)
      }
    }
  }
  // Exercise the short, collapsed table at both document boundaries first.
  for (const distance of [-500, 500]) await scroll(distance, 250)
  await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(page.getByRole('button', { name: 'T01', exact: true })).toBeVisible()
  await page.evaluate(() => {
    scrollTo({ top: 0, behavior: 'instant' })
    const state = { samples: [] as unknown[], running: true }
    ;(window as any).slowProbe = state
    const sample = () => {
      const sidebar = document.querySelector('[data-app-sidebar]')!.getBoundingClientRect()
      const frame = document.querySelector('.journal-grid-frame')!.getBoundingClientRect()
      const body = document.querySelector<HTMLElement>('.ag-grid-viewport')!
      const sticky = document.querySelector<HTMLElement>('.ag-grid-sticky-top-rows-container')!
      const rows = Array.from(document.querySelectorAll('.journal-grid-frame .ag-row')).map(row => {
        const rect = row.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, cells: row.querySelectorAll('.ag-cell').length,
          loadingCells: row.querySelectorAll('.journal-loading-cell > span').length, text: row.textContent }
      }).filter(row => row.bottom > frame.top + 95 && row.top < frame.bottom - 20)
      state.samples.push({ time: performance.now(), y: scrollY, grid: body.scrollTop, sidebarX: sidebar.x, sidebarY: sidebar.y,
        frameX: frame.x, frameY: frame.y, width: frame.width, stickyHeight: sticky.clientHeight,
        stickyRows: sticky.querySelectorAll('.ag-row').length, rows })
      if (state.running) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  for (const yDistance of [-1700, 1700]) {
    await scroll(yDistance, 180)
  }
  const samples = await page.evaluate(() => { (window as any).slowProbe.running = false; return (window as any).slowProbe.samples })
  await writeFile(info.outputPath('slow-scroll.json'), JSON.stringify(samples))
  // Expand-all also opens stores that arrive later. A row whose every cell
  // contains a static loading bar is valid pending UI, not a lost paint frame.
  const blanks = samples.filter((s: any) => !s.rows.length || s.rows.some((row: any) => !row.cells || !row.text && row.loadingCells !== row.cells) || s.stickyHeight > 0 && !s.stickyRows)
  const intervals = samples.slice(1).map((s: any, i: number) => s.time - samples[i].time).sort((a: number, b: number) => a - b)
  console.log('SLOW_SCROLL', JSON.stringify({ frames: samples.length, blanks: blanks.length, examples: blanks.slice(0, 2), p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1) }))
  expect(samples.length).toBeGreaterThan(100)
  expect(Math.max(...samples.map((s: any) => s.y)) - Math.min(...samples.map((s: any) => s.y))).toBeGreaterThan(1000)
  expect(blanks).toEqual([])
  expect(samples.every((s: any) => Math.abs(s.sidebarX) < 1 && Math.abs(s.sidebarY) < 1)).toBe(true)
  expect(Math.max(...samples.map((s: any) => s.frameX)) - Math.min(...samples.map((s: any) => s.frameX))).toBeLessThan(1)
  expect(Math.max(...samples.map((s: any) => s.width)) - Math.min(...samples.map((s: any) => s.width))).toBeLessThan(1)
  expect(errors).toEqual([])
  const boundaryPolicy = await page.evaluate(() => CSS.supports('overscroll-behavior-y', 'chain') ? 'chain' : 'auto')
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', boundaryPolicy)
  await page.getByRole('button', { name: 'Справочники', exact: true }).click()
  await expect(page.locator('[data-journal-workspace]')).toHaveCount(0)
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'auto')
})

test.describe('horizontal paint diagnostic', () => {
  test('grouped browser horizontal paint capture', async ({ page }) => {
    test.skip(!process.env.JOURNAL_PAINT_LABEL, 'Opt-in actual paint recording')
    for (const id of ['line', 'projectTitle', 'subtitleCode']) {
      await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
    await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
    await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 180))
    await page.waitForTimeout(300)
    await page.mouse.move(1000, 600)
    await page.evaluate(() => {
      const marker = document.createElement('div'); marker.id = 'paint-recording-marker'
      Object.assign(marker.style, { position: 'fixed', left: '0', bottom: '0', width: '20px', height: '20px', background: '#00ff00', zIndex: '999999', pointerEvents: 'none' })
      document.body.append(marker)
    })
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const sign of [1, -1]) for (let i = 0; i < 6; i++) { await page.mouse.wheel(sign * 1000, 0); await page.waitForTimeout(25) }
      await page.waitForTimeout(300)
    }
    const video = page.video()!
    await page.close()
    await video.saveAs(`/tmp/journal-paint-${process.env.JOURNAL_PAINT_LABEL}.webm`)
  })
})

test('grouped browser installed Safari measurement', async ({ page }) => {
  test.skip(!process.env.JOURNAL_SAFARI_LABEL, 'Opt-in installed Safari; requires local SafariDriver')
  test.setTimeout(240_000)
  await measureInstalledSafari(page)
})

test('grouped browser depth cost on identical short-group records', async ({ page, browser }) => {
  test.skip(!process.env.JOURNAL_DEPTH_LABEL, 'Opt-in nested-group rendering measurement')
  test.setTimeout(240_000)
  await page.getByRole('searchbox').fill(SHORT_PROJECT)
  await expect(page.getByText('Найдено: 18', { exact: true })).toBeVisible()
  await measureJournalGroupDepth(page, browser.version())
})

test('grouped browser resize preserves visible group rows and restores scroll overscan', async ({ page }) => {
  await page.getByRole('searchbox').fill(SHORT_PROJECT)
  await expect(page.getByText('Найдено: 18', { exact: true })).toBeVisible()
  for (const id of ['line', 'projectTitle', 'subtitleCode']) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
  }
  await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(page.getByRole('button', { name: 'T01', exact: true })).toBeVisible()
  await page.evaluate(() => scrollTo(0, document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY + 380))
  await page.waitForTimeout(200)
  await expect(page.locator('.journal-loading-cell')).toHaveCount(0)
  const visible = () => page.evaluate(() => {
    const header = document.querySelector('.ag-header')!.getBoundingClientRect().bottom
    const bottom = document.querySelector('.journal-grid-frame')!.getBoundingClientRect().bottom - 20
    return [...document.querySelectorAll('.ag-row .ag-cell[col-id="line"]')].filter(cell => {
      const rect = cell.getBoundingClientRect(); return rect.top + rect.height / 2 >= header && rect.top + rect.height / 2 < bottom
    }).map(cell => ({ id: cell.closest('.ag-row')!.getAttribute('row-id'), text: cell.textContent })).sort((a,b) => (a.id ?? '').localeCompare(b.id ?? ''))
  })
  const before = await visible(), count = await page.locator('.ag-row').count()
  const handle = (await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-resize').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 180, handle.y + handle.height / 2, { steps: 30 })
  await expect.poll(() => page.locator('.ag-row').count()).toBeLessThan(count)
  expect(await visible()).toEqual(before)
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2, { steps: 30 })
  await page.mouse.up()
  await expect.poll(() => page.locator('.ag-row').count()).toBe(count)
  expect(await visible()).toEqual(before)
  await expect(page.locator('.journal-loading-cell')).toHaveCount(0)
})

test('grouped browser scroll cadence with expanded groups', async ({ page, browser }) => {
  test.skip(!process.env.JOURNAL_MOTION_LABEL, 'Opt-in cross-browser scroll measurement')
  test.setTimeout(240_000)
  for (const id of ['line', 'projectTitle', 'subtitleCode']) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
  }
  await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  await measureJournalMotion(page, browser.version())
})

test('grouped resize cadence and horizontal rendering on normal CPU', async ({ page, browser, browserName }, info) => {
  test.skip(!process.env.JOURNAL_RESIZE_LABEL, 'Opt-in cross-browser resize diagnostic')
  test.setTimeout(180_000)
  await page.getByRole('searchbox').fill(SHORT_PROJECT)
  await expect(page.getByText('Найдено: 18', { exact: true })).toBeVisible()
  for (const id of ['line', 'projectTitle', 'subtitleCode']) {
    await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
  }
  await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
  await expect(page.getByRole('button', { name: 'T01', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(150)
  await expect(page.locator('.journal-loading-cell')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  const header = page.locator('.ag-header-cell[col-id="line"]')
  const handle = (await header.locator('.ag-header-cell-resize').boundingBox())!
  const samples = []
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  for (let repeat = 0; repeat < 3; repeat++) {
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('.ag-grid-viewport')!
      const state = { running: true, times: [] as number[], tileWrites: 0, long: [] as number[] }
      ;(window as any).resizeProbe = state
      let tile = viewport.style.getPropertyValue('--journal-gap-image')
      const observer = new MutationObserver(() => {
        const next = viewport.style.getPropertyValue('--journal-gap-image')
        if (tile !== next) { tile = next; state.tileWrites++ }
      })
      observer.observe(viewport, { attributes: true, attributeFilter: ['style'] })
      ;(window as any).resizeMutations = observer
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        const long = new PerformanceObserver(list => state.long.push(...list.getEntries().map(entry => entry.duration)))
        long.observe({ type: 'longtask' }); (window as any).resizeLong = long
      }
      const tick = () => { if (state.running) { state.times.push(performance.now()); requestAnimationFrame(tick) } }
      requestAnimationFrame(tick)
    })
    if (cdp && repeat === 2) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
    const start = performance.now()
    await page.mouse.move(handle.x + handle.width / 2 + 180, handle.y + handle.height / 2, { steps: 120 })
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2, { steps: 120 })
    await page.mouse.up()
    const elapsed = performance.now() - start
    if (cdp && repeat === 2) {
      const { profile } = await cdp.send('Profiler.stop')
      await writeFile(`/tmp/journal-resize-${process.env.JOURNAL_RESIZE_LABEL}.cpuprofile`, JSON.stringify(profile))
    }
    const result = await page.evaluate(() => {
      const state = (window as any).resizeProbe; state.running = false
      ;(window as any).resizeMutations.disconnect(); (window as any).resizeLong?.disconnect()
      const intervals = state.times.slice(1).map((time: number, index: number) => time - state.times[index]).sort((a: number, b: number) => a - b)
      return { frames: state.times.length, p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1), over25: intervals.filter((ms: number) => ms > 25).length, tileWrites: state.tileWrites, longTasks: state.long }
    })
    samples.push({ repeat, profiled: Boolean(cdp && repeat === 2), elapsed, ...result })
    if (/^(after|final)/.test(process.env.JOURNAL_RESIZE_LABEL!)) expect(result.tileWrites).toBeLessThanOrEqual(1)
    expect((await header.boundingBox())!.width).toBe(200)
  }
  await cdp?.detach()
  const result = { browserName, browserVersion: browser.version(), deviceScaleFactor: await page.evaluate(() => devicePixelRatio), samples, requests: calls }
  await writeFile(`/tmp/journal-resize-${process.env.JOURNAL_RESIZE_LABEL}.json`, JSON.stringify(result, null, 2))
  console.log('GROUPED_RESIZE', JSON.stringify(result))
  expect(calls).toEqual([])
  const viewport = page.locator('.ag-grid-viewport')
  await viewport.hover()
  for (const dx of [2000, 2000, -4000]) { await page.mouse.wheel(dx, 0); await page.waitForTimeout(100) }
  await page.screenshot({ path: info.outputPath('horizontal.png') })
})

// Opt-in, reproducible browser benchmark. No throttling, video or trace snapshots.
// Use the same production build/resources and fixture before/after each change.
test.describe('rendering benchmark', () => {
  test('normal CPU cells and scroll cadence', async ({ page }, info) => {
    test.skip(!process.env.JOURNAL_RENDER_LABEL, 'Opt-in before/after measurement')
    test.setTimeout(180_000)
    const errors: string[] = [], calls: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await expect(page.locator('[data-joint-next-action-cell]').first()).toBeVisible()
    const results: unknown[] = []
    const scroll = async (speed: number, distance: number) => {
      await cdp.send('Input.synthesizeScrollGesture', { x: 700, y: 500, yDistance: -distance, speed, gestureSourceType: 'mouse' })
      await cdp.send('Input.synthesizeScrollGesture', { x: 700, y: 500, yDistance: distance, speed, gestureSourceType: 'mouse' })
    }
    for (const grouped of [false, true]) {
      if (grouped) {
        await page.evaluate(() => scrollTo(0, 0))
        await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
        await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
        await page.getByRole('button', { name: 'Развернуть группу SERVER-A', exact: true }).click()
        await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
      }
      // Warm two blocks, then measure CPU/rendering independently of first fetch.
      await scroll(2400, 6800)
      for (const speed of [180, 1800]) {
        for (let repeat = 0; repeat < 3; repeat++) {
          await page.evaluate(() => {
            const viewport = document.querySelector<HTMLElement>('.ag-grid-viewport')!
            const origin = document.querySelector('.journal-page-track')!.getBoundingClientRect().top + scrollY
            scrollTo(0, origin + 100)
            const state = { running: true, frames: [] as { time: number; y: number; grid: number; expected: number }[], long: [] as number[] }
            ;(window as any).renderProbe = state
            const observer = new PerformanceObserver(list => state.long.push(...list.getEntries().map(entry => entry.duration)))
            observer.observe({ type: 'longtask' })
            ;(window as any).renderObserver = observer
            const tick = () => {
              if (!state.running) return
              state.frames.push({ time: performance.now(), y: scrollY, grid: viewport.scrollTop, expected: Math.max(0, scrollY - origin) })
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
          const callStart = calls.length
          await scroll(speed, speed === 180 ? 650 : 6200)
          const sample = await page.evaluate(() => {
            const state = (window as any).renderProbe; state.running = false
            ;(window as any).renderObserver.disconnect()
            return { frames: state.frames, long: state.long,
              rows: document.querySelectorAll('.ag-row').length, cells: document.querySelectorAll('.ag-cell').length }
          })
          const intervals = sample.frames.slice(1).map((frame: any, i: number) => frame.time - sample.frames[i].time).sort((a: number, b: number) => a - b)
          const median = intervals[Math.floor(intervals.length / 2)]
          results.push({ grouped, speed, repeat, frames: sample.frames.length, p50: median, p95: intervals[Math.floor(intervals.length * .95)],
            p99: intervals[Math.floor(intervals.length * .99)], max: intervals.at(-1), over25ms: intervals.filter((ms: number) => ms > 25).length,
            lagFrames: sample.frames.filter((f: any) => Math.abs(f.grid - f.expected) > 1).length,
            longTasks: sample.long, rows: sample.rows, cells: sample.cells, requests: calls.slice(callStart) })
        }
      }
      // CPU sampling is separate from the cadence measurements.
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.start')
      await scroll(1800, 6200)
      const { profile } = await cdp.send('Profiler.stop')
      await writeFile(`/tmp/journal-render-${process.env.JOURNAL_RENDER_LABEL}-${grouped ? 'grouped' : 'flat'}.cpuprofile`, JSON.stringify(profile))
    }
    await writeFile(`/tmp/journal-render-${process.env.JOURNAL_RENDER_LABEL}.json`, JSON.stringify({ cpuThrottle: 1, results, errors }, null, 2))
    console.log('NORMAL_CPU_RENDER', JSON.stringify(results))
    expect(errors).toEqual([])
    for (const result of results as { lagFrames: number; rows: number }[]) {
      expect(result.lagFrames).toBe(0)
      expect(result.rows).toBeLessThan(80)
    }
    await cdp.detach()
  })
})

// Actual wheel input over the table, not a document-margin workaround. The
// root overscroll policy must not swallow cancelable wheel events in WebKit.
for (const grouped of [false, true]) test(`grouped browser wheel reaches the document over ${grouped ? 'nested groups' : 'flat cells'}`, async ({ page }) => {
  if (grouped) {
    for (const id of ['line', 'projectTitle', 'subtitleCode']) {
      await page.locator(`.ag-header-cell[col-id="${id}"]`).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    }
    await page.locator('.ag-row-group .ag-cell[col-id="line"]').first().click({ button: 'right' })
    await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
    await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
  }
  const origin = await page.locator('.journal-page-track').evaluate(el => el.getBoundingClientRect().top + scrollY)
  const position = () => page.evaluate(() => ({ page: scrollY, grid: document.querySelector('.ag-grid-viewport')!.scrollTop }))
  for (const target of ['.ag-grid-scrolling-rows .ag-grid-pinned-left-cells', '.ag-grid-scrolling-rows .ag-grid-scrolling-cells',
    '.ag-grid-scrolling-rows .ag-grid-pinned-right-cells', '.ag-header-cell[col-id="line"]',
    ...(grouped ? ['.ag-grid-sticky-top-rows-container .ag-cell[col-id="line"]'] : [])]) {
    await page.evaluate(top => scrollTo(0, top), origin + 400)
    await expect.poll(async () => (await position()).grid).toBe(400)
    const point = await page.locator(target).evaluateAll(elements => {
      const headerBottom = document.querySelector('.ag-header')!.getBoundingClientRect().bottom
      for (const el of elements) {
        const r = el.getBoundingClientRect(), x = Math.max(0, r.left) + Math.min(r.width, innerWidth - r.left) / 2, y = r.top + r.height / 2
        if (x < 280 || x > innerWidth - 20 || y < 0 || y > innerHeight - 80) continue
        if (el.closest('.ag-grid-scrolling-rows') && y < headerBottom + 200) continue
        const hit = document.elementFromPoint(x, y)
        if (hit && el.contains(hit)) return { x, y }
      }
      throw Error('No visible wheel target: ' + elements[0]?.className)
    })
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(0, 240)
    await expect.poll(async () => (await position()).page, { message: target + ' downward wheel' }).toBeCloseTo(origin + 640, 0)
    await page.mouse.wheel(0, -240)
    await expect.poll(async () => (await position()).page, { message: target + ' upward wheel' }).toBeCloseTo(origin + 400, 0)
    await expect.poll(async () => (await position()).grid).toBe(400)
  }
})

test('grouped browser wheel preserves horizontal input, page boundaries and filter scrolling', async ({ page }) => {
  const viewport = page.locator('.ag-grid-viewport')
  const origin = await page.locator('.journal-page-track').evaluate(el => el.getBoundingClientRect().top + scrollY)
  await page.evaluate(top => scrollTo(0, top + 400), origin)
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(400)
  await page.mouse.move(1000, 600)
  await page.mouse.wheel(320, 0)
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(320)
  expect(await page.evaluate(() => scrollY)).toBe(origin + 400)
  await page.mouse.wheel(-320, 0)
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0)

  // At both page boundaries, reversing the gesture must work immediately.
  for (const edge of ['bottom', 'top']) {
    await page.evaluate(edge => scrollTo(0, edge === 'bottom' ? document.documentElement.scrollHeight : 0), edge)
    await page.waitForTimeout(100)
    const boundary = await page.evaluate(() => scrollY)
    await page.mouse.move(1000, 600)
    await page.mouse.wheel(0, edge === 'bottom' ? 240 : -240)
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => scrollY)).toBe(boundary)
    await page.mouse.wheel(0, edge === 'bottom' ? -240 : 240)
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(boundary + (edge === 'bottom' ? -240 : 240), 0)
  }
  await page.locator('.ag-header-cell[col-id="joint"]').click()
  await page.keyboard.press('Space')
  const values = page.locator('.journal-filter-values')
  await expect(values).toBeVisible()
  const before = await page.evaluate(() => scrollY)
  await values.hover()
  await page.mouse.wheel(0, 200)
  await expect.poll(() => values.evaluate(el => el.scrollTop)).toBeGreaterThan(100)
  expect(await page.evaluate(() => scrollY)).toBe(before)
  await page.keyboard.press('Escape')
  await page.getByRole('searchbox').fill('S0001')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await page.mouse.move(1000, 600)
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(100)
  expect(await viewport.evaluate(el => el.scrollTop)).toBe(0)
  await expect(page.getByRole('button', { name: 'S0001', exact: true })).toBeVisible()
})
