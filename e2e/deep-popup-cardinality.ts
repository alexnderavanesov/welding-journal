import { expect, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { and, eq, isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../src/db/schema'
import { markDispatcherTaskIndexDirty } from '../src/server/dispatcher-task-index-dirty'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../src/server/system-document-index'
import { setupDeepOpeningFixture, cleanupDeepOpeningFixture, project, total, documentCount } from './deep-report-opening-fixture'
import { withE2eDatabase } from './database'
import { withLineProgramFixture } from './line-program-fixtures'
import { popupWait, type PopupBrowser } from './deep-popup-browser'
import { rpcName } from './rpc'

type Fact = { id: string; documentId?: string; joint: string; line: string; date: string; period: string }
type Surface = 'journal' | 'documents'
const panel = '.journal-filter', input = `${panel} input[aria-label="Найти значение фильтра"]`
const option = `${panel} .journal-filter-option`
const roots = { journal: '[data-weld-report-grid="weldingJournal"]', documents: '[data-document-history-grid="generated:weldingJournal"]' }
const displayDate = (iso: string) => iso.split('-').reverse().join('.')
const dateAt = (index: number) => new Date(Date.UTC(2023, 0, 1) + index * 86_400_000).toISOString().slice(0, 10)
const lineAt = (index: number) => `LONG-${String(index).padStart(4, '0')}`
const dates = Array.from({ length: 1000 }, (_, index) => dateAt(index))
const periods = dates.map(date => `${displayDate(date)} - ${displayDate(date)}`).sort()
const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
// Labels remain present in DOM; native titles now appear only on overflow.
const flatInput = (value: string) => `${option}:has(span[data-overflow-title=${JSON.stringify(value)}]) input`
const dateInput = (label: string) => `${panel} input[aria-label=${JSON.stringify(label)}]`
const daySelector = `${option} input[aria-label^="День "]`
const periodSelector = `${option} span[data-overflow-title*=" - "]`

export async function setupPopupCardinalityFixture() {
  expect(total).toBe(9000)
  expect(documentCount, 'Set DEEP_OPENING_DOCUMENT_COUNT=1000 for this independent profile').toBe(1000)
  await setupDeepOpeningFixture()
  const previous = await withE2eDatabase(db => drizzle(db, { schema }).select().from(schema.weldJoints)
    .where(and(eq(schema.weldJoints.projectTitle, project), isNotNull(schema.weldJoints.vikRequest))))
  const rows = await withLineProgramFixture(async db => (await db.query<{ id: number; joint: string; line: string; date: string }>(`
    update weld_joints set weld_date=date '2023-01-01'+((substring(joint from 4)::int-1)%1000),
      line='LONG-'||lpad(((substring(joint from 4)::int-1)%1000)::text,4,'0')
    where project_title=$1 returning id,joint,line,weld_date::text as date`, [project])).rows)
  // Ordinary generated history derives period/line live from its linked welds.
  // System history has indexed metadata: synchronize it through the normal
  // setup transaction, with the real previous/current rows, before any UI read.
  await withE2eDatabase(db => drizzle(db, { schema }).transaction(async tx => {
    const current = await tx.select().from(schema.weldJoints)
      .where(and(eq(schema.weldJoints.projectTitle, project), isNotNull(schema.weldJoints.vikRequest)))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, current, new Map(previous.map(row => [row.id, row])))
    await markDispatcherTaskIndexDirty(tx)
  }))
  const documents = await withE2eDatabase(async db => {
    const linked = (await db.query<{ id: number; weldId: number; periodFrom: string | null; periodTo: string | null }>(`
      select d.id,a.weld_joint_id as "weldId",d.period_from::text as "periodFrom",d.period_to::text as "periodTo"
      from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      join weld_joints w on w.id=a.weld_joint_id where d.type='weldingJournal' and w.project_title=$1`, [project])).rows
    expect(linked).toHaveLength(1000)
    expect(linked.every(row => row.periodFrom === null && row.periodTo === null), 'Do not manufacture stored periods: the registry must read live weld dates').toBe(true)
    const indexed = (await db.query(`select count(*)::int as total,
      count(*) filter(where (d.source_metadata::jsonb->'lines' @> to_jsonb(array[w.line])) is not true)::int as wrong_lines
      from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      join weld_joints w on w.id=a.weld_joint_id
      where d.type<>'weldingJournal' and d.source_metadata is not null and w.project_title=$1`, [project])).rows[0]
    expect(indexed).toEqual({ total: 1000, wrong_lines: 0 })
    return new Map(linked.map(row => [row.weldId, `document:${row.id}`]))
  })
  const facts: Fact[] = rows.map(row => {
    const ordinal = Number(row.joint.slice(3)), index = (ordinal - 1) % 1000, date = dateAt(index)
    expect(row.date).toBe(date); expect(row.line).toBe(lineAt(index))
    return { id: String(row.id), documentId: documents.get(row.id), joint: row.joint, line: lineAt(index), date,
      period: `${displayDate(date)} - ${displayDate(date)}` }
  })
  expect(facts).toHaveLength(9000)
  expect(new Set(facts.map(row => row.line)).size).toBe(1000)
  expect(new Set(facts.map(row => row.date)).size).toBe(1000)
  expect(new Set(facts.filter(row => row.documentId).map(row => row.date)).size).toBe(1000)
  return facts
}
export const cleanupPopupCardinalityFixture = cleanupDeepOpeningFixture

type Target = { root: string; trigger: string; event: string; kind: 'options' | 'grid' | 'scroll';
  selector?: string; count?: number; text?: string; boundaries?: string[]; rpcPath?: string }

/** Only count + two boundary lookups in RAF; no full option text/count traversal. */
function installCardinalityProbe(target: Target) {
  const holder = window as unknown as { popupCardinalityProbe: any; popupCardinalityScrollDone?: boolean }
  holder.popupCardinalityProbe?.stop()
  const state = holder.popupCardinalityProbe = { started: null as number | null, ready: null as number | null,
    visible: true, focused: true, frames: [] as number[], stable: 0, active: true, stop: () => {} }
  const begin = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(target.trigger)) state.started ??= performance.now()
  }
  document.addEventListener(target.event, begin, true)
  let raf = 0
  state.stop = () => { state.active = false; cancelAnimationFrame(raf); document.removeEventListener(target.event, begin, true) }
  const tick = () => {
    if (!state.active) return
    state.visible &&= !document.hidden; state.focused &&= document.hasFocus()
    if (state.started !== null) {
      state.frames.push(performance.now() - state.started)
      const root = document.querySelector(target.root), dialog = document.querySelector('.journal-filter')
      let ready = false
      if (target.kind === 'options') {
        const list = dialog?.querySelector('.journal-filter-values'), fieldset = dialog?.querySelector('.document-filter-options')
        ready = Boolean(list && list.getAttribute('aria-busy') !== 'true' && fieldset?.getAttribute('aria-busy') !== 'true' && !dialog?.querySelector('[role="alert"]'))
        ready &&= dialog?.querySelector<HTMLInputElement>('input[aria-label="Найти значение фильтра"]')?.value === target.text
        ready &&= document.querySelectorAll(target.selector!).length === target.count
        ready &&= (target.boundaries ?? []).every(value => dialog?.querySelector(`span[data-overflow-title="${CSS.escape(value)}"]`))
      } else if (target.kind === 'scroll') ready = holder.popupCardinalityScrollDone === true
      else {
        const frame = root?.querySelector('.journal-grid-frame')
        ready = Boolean(frame && frame.getAttribute('aria-busy') !== 'true' && !frame.hasAttribute('data-journal-updating')
          && !root?.querySelector('.ag-row-loading') && root?.querySelector('.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading)')
          && [...root.querySelectorAll('[data-journal-footer] span,.document-grid-footer span')].some(e => e.textContent?.trim() === `Найдено: ${target.count}`)
          && performance.getEntriesByType('resource').some(entry => entry.startTime >= state.started!
            && new URL(entry.name).pathname === target.rpcPath && (entry as PerformanceResourceTiming).responseEnd > 0))
      }
      state.stable = ready ? state.stable + 1 : 0
      if (state.stable >= 2) { state.ready = performance.now() - state.started; state.stop(); return }
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

export async function runPopupCardinality(browser: PopupBrowser, facts: Fact[], info: TestInfo) {
  const samples: any[] = [], checks: object[] = [], documents = facts.filter(row => row.documentId)
  let surface: Surface = 'journal', phase = '', gridRpcPath = ''
  let failure: unknown
  const save = () => writeFile(info.outputPath(`popup-cardinality-${browser.kind}.json`), JSON.stringify({
    protocol: 'long-popup-v1', label: process.env.DEEP_POPUP_CARDINALITY_LABEL ?? 'unlabelled', browser: browser.kind,
    input: browser.kind === 'chrome' ? 'Playwright click/fill/keyboard' : 'Installed Safari WebDriver keys and DOM click, not OS pointer input',
    joints: 9000, manualDocuments: 1000, systemDocuments: 1000, dates: 1000, lines: 1000, rounds: 3, broadDateRepeats: 20,
    dateFormula: '2023-01-01 + ((joint ordinal - 1) % 1000)', documentPeriodSource: 'live min/max linked weld_date; stored ordinary period columns remain null',
    capacities: { localOptions: 1000, localInitialDom: 150, remotePages: [150, 300, 450], documentFacetLimit: 200 },
    limits: ['Paired saved/current bundles are run separately by the owner; one browser session per phase.',
      'Journal represents shared WJ/LNK/PSTO popup components; ordinary documents exercise their distinct capped loader and range-date detail leaves.',
      'RAF readiness checks counts/boundaries; full independent option/count/selection and visible-row-ID oracles run once after each timing.',
      'Scroll is a scripted top/bottom traversal over 16 RAF intervals, not native wheel input or physical FPS. Native keyboard uses WebDriver keys.',
      'Each of three branch rounds starts a fresh document in the same browser session, preserving browser/server cache but resetting accumulated popup pages. Startup is outside timing.',
      'Twenty extra warm repeats only of journal broad-date opening/search/reopening. No 200k data or retained-heap claim.',
      'Existing 200-option document scope and partial year/month semantics are preserved, never bypassed.'], phase, failure, samples, checks,
  }, null, 2))
  const foreground = async () => expect(await browser.execute('return {visible:!document.hidden,focused:document.hasFocus()}')).toEqual({ visible: true, focused: true })
  const countReady = (count: number) => popupWait(browser, `const root=document.querySelector(arguments[0]),frame=root?.querySelector('.journal-grid-frame');return !!frame&&
    frame.getAttribute('aria-busy')!=='true'&&!frame.hasAttribute('data-journal-updating')&&!root.querySelector('.ag-row-loading')&&
    [...root.querySelectorAll('[data-journal-footer] span,.document-grid-footer span')].some(e=>e.textContent.trim()==='Найдено: '+arguments[1])`, roots[surface], count)
  const measure = async (name: string, target: Omit<Target, 'root' | 'rpcPath'>, action: () => Promise<unknown>) => {
    phase = `${surface}:${name}`; console.log('LONG_POPUP_PHASE', JSON.stringify({ phase, state: 'start' }))
    await foreground(); await browser.execute('performance.clearResourceTimings()')
    await browser.execute(`(${installCardinalityProbe.toString()})(arguments[0])`, { ...target, root: roots[surface], rpcPath: gridRpcPath })
    const started = performance.now(); await action()
    await popupWait(browser, 'return window.popupCardinalityProbe.ready!==null')
    const observedMs = performance.now() - started
    const result = await browser.execute(`const p=window.popupCardinalityProbe;return {milliseconds:p.ready,visible:p.visible,focused:p.focused,frames:p.frames,
      optionNodes:document.querySelectorAll('.journal-filter-option').length,domNodes:document.querySelectorAll('*').length,
      errors:window.popupCardinalityErrors||[],
      resources:performance.getEntriesByType('resource').filter(e=>e.startTime>=p.started).map(e=>({url:e.name,start:e.startTime-p.started,end:e.responseEnd-p.started,bytes:e.transferSize}))}`)
    if (!result.visible || !result.focused) checks.push({ phase, invalidForegroundSample: true, observedMs, result })
    await foreground(); expect(result.visible).toBe(true); expect(result.focused).toBe(true)
    expect(result.errors).toEqual([])
    const requests = result.resources.filter((entry: { url: string }) => entry.url.includes('/_serverFn/'))
      .map((entry: { url: string }) => ({ ...entry, name: rpcName(entry.url) }))
    delete result.resources; samples.push({ phase, ...result, observedMs, requests })
    return requests as Array<{ name: string }>
  }
  const reveal = async (field: string) => {
    const root = roots[surface], selector = `${root} .ag-header-cell[col-id="${field}"]`
    await browser.execute('document.querySelector(arguments[0]+" .ag-grid-viewport").scrollLeft=0', root)
    const steps = await browser.execute('const v=document.querySelector(arguments[0]+" .ag-grid-viewport");return Math.ceil(v.scrollWidth/Math.max(v.clientWidth/2,1))+1', root)
    for (let n = 0; n <= steps; n++) {
      await browser.frames()
      if (await browser.execute('return !!document.querySelector(arguments[0])', selector)) {
        await browser.execute('document.querySelector(arguments[0]).scrollIntoView({block:"nearest",inline:"nearest"})', selector); await browser.frames(); return selector
      }
      await browser.execute('const v=document.querySelector(arguments[0]+" .ag-grid-viewport");v.scrollLeft+=Math.max(v.clientWidth/2,1)', root)
    }
    throw Error(`Column missing: ${field}`)
  }
  const optionsTarget = (selector: string, count: number, text = '', boundaries: string[] = []) => ({ kind: 'options' as const, selector, count, text, boundaries })
  const open = async (field: string, name: string, target: ReturnType<typeof optionsTarget>) => {
    const header = await reveal(field)
    await browser.execute('document.querySelector(arguments[0]).focus()', header)
    await measure(name, { ...target, trigger: `${header} .ag-header-cell-filter-button`, event: 'click' }, () => browser.click(`${header} .ag-header-cell-filter-button`))
    expect(await browser.execute('return document.activeElement===document.querySelector(arguments[0])', input)).toBe(true)
  }
  const close = async () => { await browser.key('Escape'); await popupWait(browser, 'return !document.querySelector(".journal-filter")') }
  const search = async (text: string, name: string, target: ReturnType<typeof optionsTarget>) => measure(name,
    { ...target, text, trigger: input, event: 'input' }, () => browser.fill(input, text))
  const assertRows = async (expected: Fact[]) => {
    await countReady(expected.length)
    const ids: string[] = await browser.execute(`return [...new Set([...document.querySelectorAll(arguments[0]+' .ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading):not(.ag-opacity-zero)')]
      .map(e=>e.getAttribute('row-id')))]`, roots[surface])
    const allowed = new Set(expected.map(row => surface === 'journal' ? row.id : row.documentId))
    expect(ids.length).toBeGreaterThan(0); expect(ids.length).toBeLessThan(100)
    for (const id of ids) expect(allowed.has(id), `Visible ${id} belongs to independent fixture membership`).toBe(true)
    checks.push({ phase, expectedRows: expected.length, visibleIds: ids })
  }
  const apply = async (selector: string, expected: Fact[], name: string, keyboard = false, label?: string) => {
    if (keyboard) await browser.execute('const e=document.querySelector(arguments[0]);e.scrollIntoView({block:"nearest",inline:"nearest"});e.focus({preventScroll:true})', selector)
    await measure(name, { kind: 'grid', trigger: selector, event: keyboard ? 'keydown' : 'click', count: expected.length },
      () => keyboard ? browser.key('Space') : browser.click(selector, label))
    await assertRows(expected)
    if (keyboard) expect(await browser.execute('return document.activeElement===document.querySelector(arguments[0])', selector)).toBe(true)
  }
  const reset = async (expected: Fact[], name: string) => {
    await measure(name, { kind: 'grid', trigger: `${panel} button`, event: 'click', count: expected.length }, () => browser.click(`${panel} button`, 'Сбросить фильтр'))
    await assertRows(expected)
  }
  const snapshot = async () => browser.execute(`return [...document.querySelectorAll('.journal-filter-option')].map(e=>{
    const i=e.querySelector('input');return {value:e.querySelector('span[data-overflow-title]')?.getAttribute('data-overflow-title'),count:Number(e.querySelector('.journal-count')?.textContent),
      label:i?.getAttribute('aria-label'),checked:i?.checked,partial:i?.indeterminate}})`) as Promise<Array<{ value: string; count: number; label: string | null; checked: boolean; partial: boolean }>>
  const assertOptions = async (expected: Array<{ value: string; count: number }>, kind: 'flat' | 'day' | 'period' | 'year' = 'flat') => {
    const all = await snapshot(), rows = all.filter(row => kind === 'day' ? row.label?.startsWith('День ')
      : kind === 'period' ? row.value.includes(' - ') : kind === 'year' ? row.label?.startsWith('Год ') : true)
    expect(rows.map(({ value, count }) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value)))
      .toEqual(expected.slice().sort((a, b) => a.value.localeCompare(b.value)))
    if (kind === 'day' || kind === 'period') {
      const values = new Set(expected.map(row => row.value)), counts = new Map<string, number>()
      const visibleFacts = kind === 'day' ? facts.filter(row => values.has(displayDate(row.date))) : documents.filter(row => values.has(row.period))
      for (const row of visibleFacts) for (const label of [`Год ${row.date.slice(0, 4)}`,
        `${months[Number(row.date.slice(5, 7)) - 1]} ${row.date.slice(0, 4)}`, `День ${displayDate(row.date)}`]) counts.set(label, (counts.get(label) ?? 0) + 1)
      expect(new Map(all.filter(row => row.label).map(row => [row.label, row.count]))).toEqual(counts)
    }
    checks.push({ phase, optionKind: kind, options: rows.length })
  }
  const scroll = async (name: string) => {
    await measure(name, { kind: 'scroll', trigger: '.journal-filter-values', event: 'long-popup-scroll' }, () => browser.execute(`
      const v=document.querySelector('.journal-filter-values');window.popupCardinalityScrollDone=false;
      v.dispatchEvent(new Event('long-popup-scroll',{bubbles:true}));let n=0;
      const step=()=>{v.scrollTop=(v.scrollHeight-v.clientHeight)*(n<=8?n/8:(16-n)/8);
        if(++n<=16)requestAnimationFrame(step);else window.popupCardinalityScrollDone=true};requestAnimationFrame(step)`))
  }
  const checked = async (selector: string, value: boolean, partial = false) => expect(await browser.execute(
    'const i=document.querySelector(arguments[0]);return {checked:i?.checked,partial:i?.indeterminate}', selector)).toEqual({ checked: value, partial })
  const enter = async (next: Surface) => {
    surface = next; await browser.navigate(next === 'journal' ? '/journal' : '/documents')
    await browser.execute(`window.popupCardinalityErrors=[];addEventListener('error',e=>window.popupCardinalityErrors.push(e.message));
      addEventListener('unhandledrejection',e=>window.popupCardinalityErrors.push(String(e.reason)))`)
    if (next === 'documents') {
      await popupWait(browser, 'return !!document.querySelector("[data-document-history-grid]")')
      if (!await browser.execute('return !!document.querySelector(arguments[0])', roots.documents)) await browser.click('button', 'ЖСР')
    }
    const searchSelector = next === 'journal' ? 'input[aria-label="Быстрый поиск по отчету"]' : 'input[aria-label="Поиск документов"]'
    await popupWait(browser, 'return !!document.querySelector(arguments[0])', searchSelector)
    const changed = await browser.execute('return performance.now()'), current = await browser.execute('return document.querySelector(arguments[0]).value', searchSelector)
    if (current !== project) await browser.fill(searchSelector, project)
    await countReady(next === 'journal' ? facts.length : documents.length)
    const prefix = next === 'journal' ? 'readJournalGrid_' : 'listRemoteGeneratedDocumentHistoryGrid_'
    if (current !== project) await expect.poll(async () => {
      const completed: string[] = await browser.execute(`return performance.getEntriesByType('resource')
        .filter(e=>e.startTime>=arguments[0]&&e.name.includes('/_serverFn/')&&e.responseEnd>0).map(e=>e.name)`, changed)
      return completed.some(url => rpcName(url).startsWith(prefix))
    }, { timeout: 240_000, intervals: [20, 40, 75, 100] }).toBe(true)
    const urls: string[] = await browser.execute('return performance.getEntriesByType("resource").filter(e=>e.name.includes("/_serverFn/")).map(e=>e.name)')
    const url = urls.find(url => rpcName(url).startsWith(prefix)); expect(url).toBeTruthy(); gridRpcPath = new URL(url!).pathname
  }
  const fullDates = dates.map(date => ({ value: displayDate(date), count: 9 }))
  const yearCounts = ['2023', '2024', '2025'].map(year => ({ value: year, count: facts.filter(row => row.date.startsWith(year)).length }))
  const allDateTarget = optionsTarget(daySelector, 1000, '202', [displayDate(dates[0]), displayDate(dates.at(-1)!)])
  try {
    for (let round = 0; round < 3; round++) {
      await enter('journal')
      const localValues = Array.from({ length: 1000 }, (_, index) => ({ value: lineAt(index), count: 9 }))
      await open('line', `${round}:local:open`, optionsTarget(option, 150, '', [lineAt(0), lineAt(149)]))
      await assertOptions(localValues.slice(0, 150))
      for (let shown = 150; shown < 1000; shown += 150) {
        const count = Math.min(shown + 150, 1000)
        const requests = await measure(`${round}:local:more:${count}`, { ...optionsTarget(option, count, '', [lineAt(0), lineAt(count - 1)]), trigger: `${panel} button`, event: 'click' },
          () => browser.click(`${panel} button`, `Ещё значения (${1000 - shown})`))
        expect(requests.filter(request => request.name.startsWith('readJournalFilterPage_'))).toHaveLength(0)
      }
      await assertOptions(localValues); await scroll(`${round}:local:scroll`)
      await apply(flatInput(lineAt(999)), facts.filter(row => row.line === lineAt(999)), `${round}:local:far-space`, true)
      await checked(flatInput(lineAt(999)), true); await close()
      await open('line', `${round}:local:reopen-selected`, optionsTarget(option, 1000, '', [lineAt(0), lineAt(999)]))
      await checked(flatInput(lineAt(999)), true); await reset(facts, `${round}:local:reset`)
      const localRequests = await search('LONG-09', `${round}:local:fragment`, optionsTarget(option, 100, 'LONG-09', [lineAt(900), lineAt(999)]))
      expect(localRequests.filter(request => request.name.startsWith('readJournalFilterPage_'))).toHaveLength(0)
      await assertOptions(localValues.slice(900))
      await apply(`${panel} button`, facts.filter(row => row.line.startsWith('LONG-09')), `${round}:local:select-found`, false, 'Выбрать найденные')
      expect((await snapshot()).every(row => row.checked && !row.partial)).toBe(true)
      await reset(facts, `${round}:local:reset-found`); await close()

      const joints = facts.map(row => ({ value: row.joint, count: 1 })).sort((a, b) => a.value.localeCompare(b.value))
      await open('joint', `${round}:remote:open`, optionsTarget(option, 150, '', [joints[0].value, joints[149].value]))
      for (const count of [300, 450]) {
        const requests = await measure(`${round}:remote:more:${count}`, { ...optionsTarget(option, count, '', [joints[0].value, joints[count - 1].value]), trigger: `${panel} button`, event: 'click' },
          () => browser.click(`${panel} button`, `Ещё значения (${9000 - (count - 150)})`))
        expect(requests.filter(request => request.name.startsWith('readJournalFilterPage_'))).toHaveLength(1)
        await assertOptions(joints.slice(0, count))
      }
      await scroll(`${round}:remote:scroll`)
      await apply(flatInput(joints[449].value), facts.filter(row => row.joint === joints[449].value), `${round}:remote:far-space`, true)
      await checked(flatInput(joints[449].value), true); await reset(facts, `${round}:remote:reset-before-search`)
      const lastJoint = joints.at(-1)!.value
      await search('009000', `${round}:remote:fragment`, optionsTarget(option, 1, '009000', [lastJoint]))
      await assertOptions([{ value: lastJoint, count: 1 }])
      await apply(flatInput(lastJoint), facts.filter(row => row.joint === lastJoint), `${round}:remote:fragment-space`, true)
      await close(); await open('joint', `${round}:remote:reopen-selected`, optionsTarget(option, 1, '009000', [lastJoint]))
      await checked(flatInput(lastJoint), true); await reset(facts, `${round}:remote:reset`); await close()

      await open('weldDate', `${round}:dates:open`, optionsTarget(option, 3))
      await assertOptions(yearCounts, 'year')
      const dateRequests = await search('202', `${round}:dates:broad-search`, allDateTarget)
      expect(dateRequests.filter(request => /^(readJournalFilterPage|listJournalFilterOptions)_/.test(request.name))).toHaveLength(0)
      await assertOptions(fullDates, 'day'); await scroll(`${round}:dates:scroll`)
      await apply(dateInput('Год 2025'), facts.filter(row => row.date.startsWith('2025')), `${round}:dates:year`)
      await checked(dateInput('Год 2025'), true)
      await apply(dateInput('Сентябрь 2025'), facts.filter(row => row.date.startsWith('2025') && !row.date.startsWith('2025-09')), `${round}:dates:month`)
      await checked(dateInput('Год 2025'), false, true)
      const lastDate = dates.at(-1)!
      await apply(dateInput(`День ${displayDate(lastDate)}`), facts.filter(row => row.date.startsWith('2025') && (!row.date.startsWith('2025-09') || row.date === lastDate)), `${round}:dates:day-space`, true)
      await checked(dateInput('Сентябрь 2025'), false, true)
      await reset(facts, `${round}:dates:reset`)
      await search('202', `${round}:dates:search-all`, allDateTarget)
      await apply(`${panel} button`, facts, `${round}:dates:select-found`, false, 'Выбрать найденные')
      expect((await snapshot()).every(row => row.checked && !row.partial)).toBe(true)
      await reset(facts, `${round}:dates:reset-found`); await close()
      await save()
    }
    for (let repeat = 0; repeat < 20; repeat++) {
      await open('weldDate', `repeat:${repeat}:dates:open`, optionsTarget(option, 3))
      await search('202', `repeat:${repeat}:dates:broad-search`, allDateTarget); await assertOptions(fullDates, 'day')
      await close(); await open('weldDate', `repeat:${repeat}:dates:reopen`, allDateTarget)
      await assertOptions(fullDates, 'day')
      await search('', `repeat:${repeat}:dates:clear-search`, optionsTarget(option, 3)); await close()
    }

    const capValues = Array.from({ length: 200 }, (_, index) => ({ value: lineAt(index), count: 1 }))
    const cappedPeriods = periods.slice(0, 200)
    for (let round = 0; round < 3; round++) {
      await enter('documents')
      await open('line', `${round}:documents-flat:open`, optionsTarget(option, 200, '', [lineAt(0), lineAt(199)]))
      await assertOptions(capValues)
      expect(await browser.execute('return document.querySelector(".journal-filter-legacy")?.textContent.includes("Показана часть значений")')).toBe(true)
      await scroll(`${round}:documents-flat:scroll`)
      await apply(`${panel} button`, documents.filter(row => row.line < lineAt(200)), `${round}:documents-flat:select-shown`, false, 'Выбрать найденные')
      expect((await snapshot()).every(row => row.checked && !row.partial)).toBe(true)
      await reset(documents, `${round}:documents-flat:reset-shown`)
      await apply(flatInput(lineAt(199)), documents.filter(row => row.line === lineAt(199)), `${round}:documents-flat:space`, true)
      await checked(flatInput(lineAt(199)), true); await reset(documents, `${round}:documents-flat:reset`)
      await search(lineAt(999), `${round}:documents-flat:outside-slice`, optionsTarget(option, 1, lineAt(999), [lineAt(999)]))
      await assertOptions([{ value: lineAt(999), count: 1 }])
      await apply(flatInput(lineAt(999)), documents.filter(row => row.line === lineAt(999)), `${round}:documents-flat:outside-space`, true)
      await close(); await open('line', `${round}:documents-flat:reopen`, optionsTarget(option, 1, lineAt(999), [lineAt(999)]))
      await checked(flatInput(lineAt(999)), true); await reset(documents, `${round}:documents-flat:reset-outside`); await close()

      await open('period', `${round}:documents-period:open`, optionsTarget(option, 3))
      const shownDocs = documents.filter(row => cappedPeriods.includes(row.period))
      await assertOptions(['2023', '2024', '2025'].map(year => ({ value: year, count: shownDocs.filter(row => row.date.startsWith(year)).length })), 'year')
      expect(await browser.execute('return document.querySelector(".journal-filter-legacy")?.textContent.includes("только значения из этого списка")')).toBe(true)
      await search('202', `${round}:documents-period:broad-search`, optionsTarget(periodSelector, 200, '202', [cappedPeriods[0], cappedPeriods.at(-1)!]))
      await assertOptions(cappedPeriods.map(value => ({ value, count: 1 })), 'period'); await scroll(`${round}:documents-period:scroll`)
      await apply(dateInput('Год 2025'), shownDocs.filter(row => row.date.startsWith('2025')), `${round}:documents-period:capped-year`)
      await checked(dateInput('Год 2025'), true); await reset(documents, `${round}:documents-period:reset`)
      const lastDate = dates.at(-1)!, period = `${displayDate(lastDate)} - ${displayDate(lastDate)}`
      expect(cappedPeriods).not.toContain(period)
      await search(displayDate(lastDate), `${round}:documents-period:outside-slice`, optionsTarget(periodSelector, 1, displayDate(lastDate), [period]))
      await assertOptions([{ value: period, count: 1 }], 'period')
      await apply(flatInput(period), documents.filter(row => row.date === lastDate), `${round}:documents-period:detail-space`, true)
      await checked(flatInput(period), true); await close()
      await open('period', `${round}:documents-period:reopen`, optionsTarget(periodSelector, 1, displayDate(lastDate), [period]))
      await checked(flatInput(period), true); await reset(documents, `${round}:documents-period:reset-outside`); await close()
      await save()
    }
  } catch (error) {
    failure = { name: error instanceof Error ? error.name : 'UnknownError', message: (error instanceof Error ? error.message : String(error)).split('\n')[0] }
    throw error
  } finally { try { await save() } finally { await browser.close() } }
}
