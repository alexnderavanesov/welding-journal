import { expect, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { installPopupProbe, popupWait, type PopupBrowser, type PopupProbeTarget } from './deep-popup-browser'
import { popupMarker, popupRows, type PopupFact, type PopupField } from './deep-popup-fixture'
import { rpcName } from './rpc'

const reports = [
  { name: 'journal', report: 'weldingJournal', path: '/journal' },
  { name: 'lnk', report: 'lnk', path: '/lnk' },
  { name: 'psto', report: 'heatTreatment', path: '/psto' },
] as const
type Report = typeof reports[number]
// Validate at module load, before fixture setup or an owned Safari session.
// Keep canonical navigation order even when the requested subset is reordered.
const selectedReports = (() => {
  const configured = process.env.DEEP_POPUP_REPORTS
  if (configured === undefined) return reports
  const requested = configured.split(',').map(value => value.trim())
  if (requested.some(value => !value) || new Set(requested).size !== requested.length ||
    requested.some(value => !reports.some(report => report.name === value))) {
    throw new Error('DEEP_POPUP_REPORTS must be a nonempty, duplicate-free subset of journal,lnk,psto')
  }
  return reports.filter(report => requested.includes(report.name))
})()
const fields: Array<{ field: PopupField; label: string; fragment: string; single: string }> = [
  { field: 'projectTitle', label: 'Проект', fragment: 'PROJECT-00', single: `${popupMarker}-PROJECT-003` },
  { field: 'subtitleCode', label: 'Шифр', fragment: 'CODE-01', single: 'CODE-017' },
  { field: 'line', label: 'Линия', fragment: 'LINE-00', single: 'LINE-0017' },
  { field: 'joint', label: 'Стык', fragment: 'F000', single: 'F0000123' },
  { field: 'weldDate', label: 'Дата сварки', fragment: '10.2026', single: '2026-10-03' },
  { field: 'finalStatus', label: 'Итоговый статус', fragment: 'годен', single: 'годен' },
]
type FieldCase = typeof fields[number]
const dialog = '.journal-filter', input = `${dialog} input[aria-label="Найти значение фильтра"]`
const rootOf = (report: Report) => `[data-weld-report-grid="${report.report}"]`
const displayDate = (value: string) => value.split('-').reverse().join('.')
const matches = (row: PopupFact, item: FieldCase) => (item.field === 'weldDate' ? displayDate(row.weldDate) : row[item.field]).includes(item.fragment)
const valueSelector = (item: FieldCase, value: string) => item.field === 'weldDate'
  ? `${dialog} input[aria-label="День ${displayDate(value)}"]`
  : `${dialog} .journal-filter-option:has(span[title=${JSON.stringify(value)}]) input`

function choices(facts: PopupFact[], field: PopupField, fragment?: string, collapsedDate = false) {
  const counts = new Map<string, number>()
  for (const fact of facts) {
    const value = field === 'weldDate' ? collapsedDate ? fact.weldDate.slice(0, 4) : displayDate(fact.weldDate) : fact[field]
    if (fragment && !value.includes(fragment)) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, 'ru', { numeric: true }))
  return field === 'weldDate' ? values : values.slice(0, 150)
}

export async function runPopupScenarios(browser: PopupBrowser, facts: PopupFact[], info: TestInfo) {
  const foundRecheck = process.env.DEEP_POPUP_FOUND_RECHECK === '1'
  if (foundRecheck) {
    expect(browser.kind).toBe('chrome')
    expect(selectedReports.map(report => report.name)).toEqual(['journal'])
    expect(popupRows).toBe(200000)
  }
  const rounds = Number(process.env.DEEP_POPUP_ROUNDS ?? 3)
  const repeatRounds = Number(process.env.DEEP_POPUP_REPEAT_ROUNDS ?? 20)
  expect(Number.isInteger(rounds) && rounds > 0 && rounds <= 20).toBe(true)
  expect(Number.isInteger(repeatRounds) && repeatRounds > 0 && repeatRounds <= 20).toBe(true)
  const ordered = facts.slice().sort((a, b) => a.joint.localeCompare(b.joint))
  const samples: any[] = [], checks: object[] = []
  let failureDiagnostics: unknown
  let phase = '', currentReport: Report = selectedReports[0], gridRpcPath = ''
  const save = () => writeFile(info.outputPath(`priority-popup-${browser.kind}.json`), JSON.stringify({
    label: process.env.DEEP_POPUP_LABEL ?? 'unlabelled', browser: browser.kind, rows: popupRows, rounds, repeatRounds, foundRecheck,
    selectedReports: selectedReports.map(report => report.name), sessions: 1,
    representative: { reports: selectedReports.some(report => report.name === 'journal') ? ['journal'] : [],
      fields: foundRecheck ? fields.map(item => item.field) : ['joint', 'weldDate'], rounds: selectedReports.some(report => report.name === 'journal') ? repeatRounds : 0 },
    recheckScope: foundRecheck ? 'Six fields, repeated actual Select Found and reset; then two natural 31-second expiry waits each for line/joint. Original matrix/group/combined cases are not rerun. Warm labels describe rapid repeats only: classify actual facet rebuilds from the separately captured server SQL row counts. Waits occur after popup/search preparation, outside click-to-ready measurements. No cache settings or responses are replaced.' : undefined,
    oracle: 'Independent fixture formula and INSERT-returned IDs. Every visible flat row is checked by exact ID/order/index plus full-query count; group leaves by exact filtered membership. Does not claim to visit every result row.',
    input: browser.kind === 'chrome' ? 'Playwright real click/fill/keyboard' : 'Installed Safari WebDriver keys and DOM click/contextmenu, not OS pointer/FPS',
    limits: foundRecheck ? 'See recheckScope: this run replaces the broad matrix with a matched Select Found diagnostic; no grouping or startup timings are claimed.' : `The full warm fixture formula and cardinality stay identical for every report subset. Constant quick-search marker isolates its projects before timings. DOM/RAF and completed real ResourceTiming RPCs, no network replacement or CDP. Not a cold startup or retained-heap test. Each selected report retains all six fields for ${rounds} matrix rounds and the combined-filter scenario. Journal joint/date retain ${repeatRounds} repetitions when journal is selected; other subsets do not execute those repetitions. One browser session per run: separately run subsets have separate browser/cache histories, not one shared three-report session. Compare matching subsets and session setup before/after.`,
    factDigest: createHash('sha256').update(JSON.stringify(ordered)).digest('hex'), phase, samples, checks,
    failureDiagnostics,
  }, null, 2))
  const diagnosticState = () => browser.execute(`
    const root=document.querySelector(arguments[0]),frame=root?.querySelector('.journal-grid-frame');
    const p=window.deepPopupProbe,t=p?.target,resources=performance.getEntriesByType('resource').filter(e=>e.name.includes('/_serverFn/'));
    const rowSelector=t?.kind==='groups'?'.ag-row-group:not(.ag-opacity-zero)':'.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading):not(.ag-opacity-zero)';
    const describe=e=>e?{tag:e.tagName,role:e.getAttribute('role'),colId:e.getAttribute('col-id'),label:e.getAttribute('aria-label'),value:e.value}:null;
    return {path:location.pathname,visible:!document.hidden,focused:document.hasFocus(),active:describe(document.activeElement),
      search:document.querySelector('input[aria-label="Быстрый поиск по отчету"]')?.value,
      busy:frame?.getAttribute('aria-busy'),updating:frame?.hasAttribute('data-journal-updating'),
      footer:root?.querySelector('[data-journal-footer]')?.textContent,
      rowCount:root?.querySelectorAll('.ag-row[row-id]').length,loadingRows:root?.querySelectorAll('.ag-row-loading').length,
      dialogs:[...document.querySelectorAll('[role="dialog"]')].map(e=>({label:e.getAttribute('aria-label'),text:e.textContent?.slice(0,1000)})),
      jointSort:root?.querySelector('.ag-header-cell[col-id="joint"]')?.getAttribute('aria-sort'),
      alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>({text:e.textContent,visible:!!e.getClientRects().length})),
      errors:window.deepPopupErrors,
      rows:[...(root?.querySelectorAll(rowSelector)||[])].slice(0,40).map(e=>({id:e.getAttribute('row-id'),index:e.getAttribute('row-index')})),
      probe:p?{target:t,started:p.started,ready:p.ready,active:p.active,stable:p.stable,visible:p.visible,focused:p.focused,
        busySeen:p.busySeen,frameCount:p.frames.length,lastFrame:p.frames.at(-1),now:performance.now(),
        flags:{root:!!root,frame:!!frame,busy:frame?.getAttribute('aria-busy')==='true'||!!frame?.hasAttribute('data-journal-updating'),
          countMatch:[...(root?.querySelectorAll('[data-journal-footer] span')||[])].some(e=>e.textContent.trim()==='Найдено: '+t?.count),
          rowMatch:!!root?.querySelector(rowSelector),loading:!!root?.querySelector('.ag-row-loading'),
          rpcMatch:resources.some(e=>e.startTime>=p.started&&new URL(e.name).pathname===t?.gridRpcPath&&e.responseEnd>0)}}:null,
      resources:resources.slice(-30).map(e=>({path:new URL(e.name).pathname,start:e.startTime,end:e.responseEnd,duration:e.duration,bytes:e.encodedBodySize,
        afterStart:p?.started===null?null:e.startTime>=p?.started,startDelta:p?.started===null?null:e.startTime-p?.started,
        gridPathMatch:new URL(e.name).pathname===t?.gridRpcPath}))}`,
    rootOf(currentReport))
  const foreground = async () => expect(await browser.execute('return {visible:!document.hidden,focused:document.hasFocus()}')).toEqual({ visible: true, focused: true })
  const frames = () => browser.frames()
  const ready = async (expected: number, grouped = false) => popupWait(browser, `const root=document.querySelector(arguments[0]),frame=root?.querySelector('.journal-grid-frame');
    return !!frame&&frame.getAttribute('aria-busy')!=='true'&&!frame.hasAttribute('data-journal-updating')&&!root.querySelector('.ag-row-loading')&&
    [...root.querySelectorAll('[data-journal-footer] span')].some(e=>e.textContent.trim()==='Найдено: '+arguments[1])&&
    !!root.querySelector(arguments[2]?'.ag-row-group':'.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading):not(.ag-opacity-zero)')`, rootOf(currentReport), expected, grouped)
  const reveal = async (field: string) => {
    const root = rootOf(currentReport), selector = `${root} .ag-header-cell[col-id="${field}"]`
    await browser.execute('document.querySelector(arguments[0]+" .ag-grid-viewport").scrollLeft=0', root)
    const steps = await browser.execute('const v=document.querySelector(arguments[0]+" .ag-grid-viewport");return Math.ceil(v.scrollWidth/Math.max(v.clientWidth/2,1))+1', root)
    for (let n = 0; n <= steps; n++) {
      await frames()
      if (await browser.execute('return !!document.querySelector(arguments[0])', selector)) {
        await browser.execute('document.querySelector(arguments[0]).scrollIntoView({block:"nearest",inline:"nearest"})', selector)
        await frames(); return selector
      }
      await browser.execute('const v=document.querySelector(arguments[0]+" .ag-grid-viewport");v.scrollLeft+=Math.max(v.clientWidth/2,1)', root)
    }
    throw Error(`Missing visible column: ${field}`)
  }
  const measure = async (name: string, target: Omit<PopupProbeTarget, 'root'>, action: () => Promise<unknown>) => {
    phase = `${currentReport.name}:${name}`
    console.log('DEEP_POPUP_PHASE', JSON.stringify({ phase, state: 'start' }))
    await foreground()
    await browser.execute('performance.clearResourceTimings()')
    await browser.execute(`(${installPopupProbe.toString()})(arguments[0])`, { ...target, root: rootOf(currentReport), gridRpcPath })
    const observedStart = performance.now()
    await action()
    await popupWait(browser, 'return window.deepPopupProbe.ready!==null')
    const observedMs = performance.now() - observedStart
    const result = await browser.execute(`const p=window.deepPopupProbe;return {milliseconds:p.ready,firstInputToLastInputMs:p.lastInput===null?null:p.lastInput-p.started,
      afterLastInputMs:p.lastInput===null?null:p.ready-(p.lastInput-p.started),visible:p.visible,focused:p.focused,busySeen:p.busySeen,maxRows:p.maxRows,domNodes:document.querySelectorAll('*').length,
      frames:p.frames,resources:performance.getEntriesByType('resource').filter(e=>e.startTime>=p.started).map(e=>({url:e.name,start:e.startTime-p.started,end:e.responseEnd-p.started,bytes:e.transferSize})),
      focusedElement:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),header:document.activeElement?.closest('.ag-header-cell')?.getAttribute('col-id')}}`)
    await foreground()
    expect(result.visible).toBe(true); expect(result.focused).toBe(true)
    const resources = result.resources as Array<{ url: string; start: number; end: number; bytes: number }>
    const requests = resources.filter(value => value.url.includes('/_serverFn/')).map(value => ({ ...value, name: rpcName(value.url) }))
    delete result.resources
    samples.push({ phase, report: currentReport.report, ...result, observedMs, requests })
    console.log('DEEP_POPUP_PHASE', JSON.stringify({ phase, state: 'complete', milliseconds: result.milliseconds, requests: requests.map(value => value.name) }))
    return requests
  }
  const assertRows = async (expected: PopupFact[], grouped = false) => {
    const snapshot: { rows: Array<{ id: number; index: number }>; errors: string[] } = await browser.execute(`const root=document.querySelector(arguments[0]);
      return {rows:[...root.querySelectorAll('.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading):not(.ag-opacity-zero)')].map(e=>({id:Number(e.getAttribute('row-id')),index:Number(e.getAttribute('row-index'))})),errors:window.deepPopupErrors||[]}`, rootOf(currentReport))
    expect(snapshot.errors).toEqual([])
    const rows = [...new Map(snapshot.rows.map(row => [row.id, row])).values()]
    expect(rows.length).toBeGreaterThan(0); expect(rows.length).toBeLessThan(100)
    const expectedIds = new Set(expected.map(row => row.id))
    for (const row of rows) {
      expect(expectedIds.has(row.id), `Visible ${row.id} belongs to the independently expected result`).toBe(true)
      if (!grouped) expect(row.id, `Exact joint-ascending identity at visual index ${row.index}`).toBe(expected[row.index]?.id)
    }
    checks.push({ phase, expectedCount: expected.length, visibleIds: rows.map(row => row.id), grouped })
  }
  const open = async (item: FieldCase, expected: PopupFact[], name: string, search = '') => {
    const header = await reveal(item.field)
    await browser.execute('document.querySelector(arguments[0]).focus({preventScroll:true})', header)
    await measure(name, { kind: 'popup', event: 'click', trigger: `${header} .ag-header-cell-filter-button`,
      options: choices(expected, item.field, search, item.field === 'weldDate' && !search), date: item.field === 'weldDate', dateCollapsed: !search, text: search },
    () => browser.click(`${header} .ag-header-cell-filter-button`))
    expect(await browser.execute('return document.activeElement===document.querySelector(arguments[0])', input)).toBe(true)
  }
  const search = async (item: FieldCase, expected: PopupFact[], name: string) => {
    const requests = await measure(name, { kind: 'search', event: 'input', trigger: input, text: item.fragment,
      options: choices(expected, item.field, item.fragment), date: item.field === 'weldDate' }, () => browser.fill(input, item.fragment))
    const cardinality = new Set(expected.map(row => row[item.field])).size
    const facetCalls = requests.filter(value => /^(readJournalFilterPage|listJournalFilterOptions)_/.test(value.name)).length
    if (item.field === 'weldDate' || cardinality <= 1000) expect(facetCalls).toBe(0)
    else expect(facetCalls).toBeLessThanOrEqual(1) // cached prefixes legitimately use zero requests
    expect(await browser.execute('return document.activeElement===document.querySelector(arguments[0])', input)).toBe(true)
  }
  const close = async () => {
    await browser.key('Escape')
    await popupWait(browser, 'return !document.querySelector(".journal-filter")')
  }
  const reset = async (expected: PopupFact[], name: string) => {
    await measure(name, { kind: 'grid', event: 'click', trigger: `${dialog} button`, count: expected.length, requireGridRpc: true },
      () => browser.click(`${dialog} button`, 'Сбросить фильтр'))
    expect(await browser.execute('return document.activeElement===document.querySelector(arguments[0])&&document.activeElement.value===""', input)).toBe(true)
    await assertRows(expected)
  }
  const selectFound = async (item: FieldCase, expected: PopupFact[], name: string) => {
    const result = expected.filter(row => matches(row, item))
    const requests = await measure(name, { kind: 'grid', event: 'click', trigger: `${dialog} button`, count: result.length, requireGridRpc: true },
      () => browser.click(`${dialog} button`, 'Выбрать найденные'))
    const remote = item.field !== 'weldDate' && new Set(expected.map(row => row[item.field])).size > 1000 && new Set(result.map(row => row[item.field])).size > 150
    expect(requests.filter(value => value.name.startsWith('selectJournalFilterValues_')).length).toBe(remote ? 1 : 0)
    expect(await browser.execute('return document.activeElement===document.querySelector(arguments[0])&&document.activeElement.value===arguments[1]', input, item.fragment)).toBe(true)
    await assertRows(result)
    return result
  }
  const groupAndOpen = async (expected: PopupFact[], name: string) => {
    const header = await reveal('line')
    await browser.click(header, undefined, true)
    await measure(`${name}:group`, { kind: 'groups', event: 'click', trigger: '[role="menuitem"]', count: expected.length },
      () => browser.click('[role="menuitem"]', 'Сгруппировать по «Линия»'))
    const label: string = await browser.execute(`return [...document.querySelectorAll(arguments[0]+' button')].map(e=>e.getAttribute('aria-label')||e.textContent.trim()).find(t=>t.startsWith('Развернуть группу '))`, rootOf(currentReport))
    expect(label).toBeTruthy()
    const line = label.slice('Развернуть группу '.length), expectedLine = expected.filter(row => row.line === line)
    expect(expectedLine.length).toBeGreaterThan(0)
    await measure(`${name}:open`, { kind: 'leaves', event: 'click', trigger: `${rootOf(currentReport)} button`, count: expected.length },
      () => browser.click(`${rootOf(currentReport)} button`, label))
    await assertRows(expectedLine, true)
    await browser.click('button', 'Снять все группировки')
    await ready(expected.length)
    await assertRows(expected)
  }
  const fullCase = async (item: FieldCase, round: number) => {
    const name = `matrix:${round}:${item.field}`
    await open(item, ordered, `${name}:popup-ready`)
    // Prove the actual hierarchy is available, independently of search's auto expansion.
    if (item.field === 'weldDate') {
      const year = `${dialog} input[aria-label="Год 2026"]`, month = `${dialog} input[aria-label="Октябрь 2026"]`
      const inYear = ordered.filter(row => row.weldDate.startsWith('2026-'))
      await measure(`${name}:year-to-grid`, { kind: 'grid', event: 'click', trigger: year, count: inYear.length, requireGridRpc: true }, () => browser.click(year))
      await assertRows(inYear)
      await browser.click(`${dialog} button`, 'Развернуть Год 2026')
      expect(await browser.execute('return document.querySelector(arguments[0]).checked', month)).toBe(true)
      // There is one month in this year. Deselecting it removes the last active
      // values and restores the full fixture, per the existing empty-choice rule.
      await measure(`${name}:month-clear-to-grid`, { kind: 'grid', event: 'click', trigger: month, count: ordered.length, requireGridRpc: true }, () => browser.click(month))
      await assertRows(ordered)
      await browser.click(`${dialog} button`, 'Развернуть Октябрь 2026')
      expect(await browser.execute('return !!document.querySelector(arguments[0])', valueSelector(item, item.single))).toBe(true)
    }
    await search(item, ordered, `${name}:search-ready`)
    const single = ordered.filter(row => row[item.field] === item.single)
    await measure(`${name}:single-to-grid`, { kind: 'grid', event: 'click', trigger: valueSelector(item, item.single), count: single.length, requireGridRpc: true },
      () => browser.click(valueSelector(item, item.single)))
    expect(await browser.execute('return document.activeElement===document.querySelector(arguments[0])&&document.activeElement.checked', valueSelector(item, item.single))).toBe(true)
    await assertRows(single)
    await close()
    await open(item, ordered, `${name}:reopen-selected`, item.fragment)
    expect(await browser.execute('return document.querySelector(arguments[0]).checked', valueSelector(item, item.single))).toBe(true)
    await reset(ordered, `${name}:reset-single`)
    await search(item, ordered, `${name}:search-again`)
    const found = await selectFound(item, ordered, `${name}:found-to-grid`)
    await close()
    await groupAndOpen(found, name)
    await open(item, ordered, `${name}:reopen-after-group`, item.fragment)
    expect(await browser.execute(`return [...document.querySelectorAll('.journal-filter-option input')].length>0&&[...document.querySelectorAll('.journal-filter-option input')].every(e=>e.checked)`)).toBe(true)
    await reset(ordered, `${name}:reset-found`)
    await close()
  }
  try {
    expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
    for (const report of selectedReports) {
      currentReport = report
      phase = `${report.name}:preparation`
      await browser.navigate(report.path)
      await popupWait(browser, 'return !!document.querySelector(arguments[0])', 'input[aria-label="Быстрый поиск по отчету"]')
      await browser.execute(`window.deepPopupErrors=[];window.addEventListener('error',e=>window.deepPopupErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.deepPopupErrors.push(String(e.reason)))`)
      await browser.fill('input[aria-label="Быстрый поиск по отчету"]', popupMarker)
      await ready(popupRows)
      await browser.click('button', 'Настроить вид')
      if (await browser.execute(`return [...document.querySelectorAll('[role="dialog"] button')].some(e=>e.textContent.trim()==='Показать все')`)) await browser.click('[role="dialog"] button', 'Показать все')
      // Native DOM activation does not move focus away from quick search.
      // Escape would clear that input instead of closing the view settings.
      // Use the actual close control in both browsers, before any measurement.
      await browser.click('button[aria-label="Закрыть настройки вида"]')
      await popupWait(browser, 'return !document.querySelector(".journal-settings-panel")')
      expect(await browser.execute('return document.querySelector(arguments[0])?.value', 'input[aria-label="Быстрый поиск по отчету"]'), 'Preparation must preserve fixture marker when closing view settings').toBe(popupMarker)
      const joint = await reveal('joint')
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await browser.execute('return document.querySelector(arguments[0])?.getAttribute("aria-sort")==="ascending"', joint)) break
        await browser.execute('document.querySelector(arguments[0]).focus()', joint)
        await browser.key('Enter'); await frames(); await ready(popupRows)
      }
      await popupWait(browser, 'return document.querySelector(arguments[0])?.getAttribute("aria-sort")==="ascending"', joint)
      await ready(popupRows)
      await assertRows(ordered)
      const urls: string[] = await browser.execute('return performance.getEntriesByType("resource").filter(e=>e.name.includes("/_serverFn/")).map(e=>e.name)')
      const url = urls.find(value => rpcName(value).startsWith('readJournalGrid_'))
      expect(url).toBeTruthy(); gridRpcPath = new URL(url!).pathname
      if (foundRecheck) {
        for (const item of fields) {
          for (let repeat = 0; repeat < repeatRounds; repeat++) {
            const name = `recheck:rapid:${repeat}:${item.field}`
            await open(item, ordered, `${name}:popup-ready`)
            await search(item, ordered, `${name}:search-ready`)
            await selectFound(item, ordered, `${name}:found-to-grid`)
            await reset(ordered, `${name}:reset`); await close()
          }
        }
        for (let repeat = 0; repeat < 2; repeat++) for (const item of fields.filter(item => ['line', 'joint'].includes(item.field))) {
          const name = `recheck:expired:${repeat}:${item.field}`
          await open(item, ordered, `${name}:popup-ready`)
          await search(item, ordered, `${name}:search-ready`)
          console.log('DEEP_POPUP_EXPIRY_WAIT', JSON.stringify({ name, milliseconds: 31_000 }))
          await new Promise(resolve => setTimeout(resolve, 31_000))
          await selectFound(item, ordered, `${name}:found-to-grid`)
          await reset(ordered, `${name}:reset`); await close()
        }
        await save()
        continue
      }
      for (let round = 0; round < rounds; round++) for (const item of fields) await fullCase(item, round)
      // Actual combined popups: line choices/counts must respect the other project filter.
      const project = fields[0], line = { ...fields[2], fragment: 'LINE-0017' }
      await open(project, ordered, 'combined:project-open')
      await search(project, ordered, 'combined:project-search')
      const projectRows = ordered.filter(row => row.projectTitle === project.single)
      await measure('combined:project-choice', { kind: 'grid', event: 'click', trigger: valueSelector(project, project.single), count: projectRows.length, requireGridRpc: true },
        () => browser.click(valueSelector(project, project.single)))
      await close()
      await open(line, projectRows, 'combined:line-open')
      await search(line, projectRows, 'combined:line-search')
      const combined = await selectFound(line, projectRows, 'combined:line-found')
      await close(); await groupAndOpen(combined, 'combined')
      await open(line, projectRows, 'combined:line-reopen', line.fragment)
      await reset(projectRows, 'combined:line-reset'); await close()
      await open(project, ordered, 'combined:project-reopen', project.fragment)
      await reset(ordered, 'combined:project-reset'); await close()
      if (report.name === 'journal') for (const item of fields.filter(item => ['joint', 'weldDate'].includes(item.field))) {
        for (let repeat = 0; repeat < repeatRounds; repeat++) {
          const name = `representative:${repeat}:${item.field}`
          await open(item, ordered, `${name}:popup-ready`)
          await search(item, ordered, `${name}:search-ready`)
          await selectFound(item, ordered, `${name}:found-to-grid`)
          await reset(ordered, `${name}:reset`); await close()
        }
      }
      await save()
    }
  } catch (error) {
    failureDiagnostics = await diagnosticState().catch(diagnosticError => ({ captureError: String(diagnosticError) }))
    throw error
  } finally {
    await save()
    await browser.close()
  }
}
