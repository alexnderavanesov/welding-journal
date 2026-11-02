import { expect, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { installOpeningProbe, type OpeningSurface } from './deep-report-opening-probe'
import { prepareSafariMeasurementWindow } from './safari-foreground'
import { rpcName } from './rpc'
import { withE2eDatabase } from './database'
import { project, total, documentCount, repeatRounds, firstJoint, firstLine, manualTitle, templateBytes } from './deep-report-opening-fixture'

const reports = [
  { name: 'journal', report: 'weldingJournal', path: '/journal', button: 'Сварочный журнал' },
  { name: 'lnk', report: 'lnk', path: '/lnk', button: 'ЛНК' },
  { name: 'psto', report: 'heatTreatment', path: '/psto', button: 'ПСТО и ТВМТ' },
  { name: 'documents', report: null, path: '/documents', button: 'Документы' },
] as const
export function deepOpeningSafariProfile() {
  const saveRounds = Number(process.env.DEEP_OPENING_SAVE_ROUNDS ?? 1)
  expect(Number.isInteger(saveRounds) && saveRounds >= 1 && saveRounds <= 20).toBe(true)
  const requested = process.env.DEEP_OPENING_REPORTS?.split(',').map(value => value.trim())
  if (requested) {
    expect(requested.length).toBeGreaterThan(0)
    expect(new Set(requested).size).toBe(requested.length)
    expect(requested.every(name => reports.some(report => report.name === name))).toBe(true)
  }
  return { saveRounds, selectedReports: requested ? reports.filter(report => requested.includes(report.name)) : reports }
}
type Report = { name: string; report: 'weldingJournal' | 'lnk' | 'heatTreatment' | null; path: string; button: string; root?: string }
const surface = (report: Report): OpeningSurface => {
  const root = report.root ?? (report.report ? `[data-weld-report-grid="${report.report}"]` : '[data-document-history-grid="generated:weldingJournal"]')
  return { name: report.name, path: report.path, root, frame: `${root} .journal-grid-frame`,
    leaf: report.report ? '.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading)' : '.ag-row[row-id^="document:"]',
    footer: report.report ? '[data-journal-footer]' : '.document-grid-footer' }
}

/** One owned native Safari session for all reports. Never attach to user tabs. */
export async function measureDeepOpeningInSafari(info: TestInfo) {
  const { saveRounds, selectedReports } = deepOpeningSafariProfile()
  const origin = new URL(String(info.project.use.baseURL))
  expect([origin.hostname, origin.port]).toEqual(['127.0.0.1', '3100'])
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(`${path}: ${JSON.stringify(result.value)}`)
    return result.value
  }
  const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
  const session = '/session/' + created.sessionId
  let activeAction = 'prepare'
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const wait = (script: string, ...args: unknown[]) => expect.poll(() => execute(script, ...args), {
    timeout: 240_000, intervals: [20, 40, 75, 100], message: script,
  }).toBe(true)
  const click = async (selector: string, label?: string) => {
    activeAction = `click ${selector}: ${label ?? '(first visible)'}`
    await expect.poll(() => execute(`return [...document.querySelectorAll(arguments[0])].some(e=>e.getClientRects().length&&!e.disabled&&
      (arguments[1]===null||e.textContent.trim()===arguments[1]||e.getAttribute('aria-label')===arguments[1]))`, selector, label ?? null),
    { timeout: 30_000, message: activeAction }).toBe(true)
    await execute(`const e=[...document.querySelectorAll(arguments[0])].find(e=>e.getClientRects().length&&!e.disabled&&
      (arguments[1]===null||e.textContent.trim()===arguments[1]||e.getAttribute('aria-label')===arguments[1]));e.click()`, selector, label ?? null)
  }
  const fill = async (selector: string, value: string) => {
    activeAction = `fill ${selector}`
    await wait('return !!document.querySelector(arguments[0])', selector)
    const element = await command(session + '/element', { using: 'css selector', value: selector })
    await execute('const e=document.querySelector(arguments[0]);e.focus();e.select()', selector)
    await command(session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/value', { text: value })
    await wait('return document.querySelector(arguments[0])?.value===arguments[1]', selector, value)
  }
  const search = (report: Report) => report.report ? 'input[aria-label="Быстрый поиск по отчету"]' : 'input[aria-label="Поиск документов"]'
  const ready = async (report: Report, grouped: boolean | 'either' = false, count?: number, summary = true) => {
    const s = surface(report)
    await wait(`const root=document.querySelector(arguments[0].root),frame=document.querySelector(arguments[0].frame);
      if(location.pathname!==arguments[0].path||!root||!frame||frame.getAttribute('aria-busy')==='true'||frame.hasAttribute('data-journal-updating'))return false;
      const footer=root.querySelector(arguments[0].footer)?.textContent||'';
      const row=arguments[1]==='either'?'.ag-row-group,'+arguments[0].leaf:arguments[1]?'.ag-row-group':arguments[0].leaf;
      const loaded=!!root.querySelector(row)&&!root.querySelector('.ag-row-loading');
      if(!loaded||!arguments[3])return loaded;
      return /Найдено:\\s*[\\d\\s]+/.test(footer)&&!/Подсчёт|Загрузка…/.test(footer)&&
        (arguments[2]===null||[...root.querySelectorAll(arguments[0].footer+' span')].some(e=>e.textContent.trim()==='Найдено: '+arguments[2]))`, s, grouped, count ?? null, summary)
  }
  const groupSelector = (report: Report, expanded: boolean) => `${surface(report).root} .ag-row-group[aria-expanded="${expanded}"]`
  const toggleGroup = async (report: Report, expanded: boolean) => {
    if (report.report) await click('button', `${expanded ? 'Свернуть' : 'Развернуть'} группу ${firstLine}`)
    else await click(groupSelector(report, expanded) + (expanded ? ' .ag-group-expanded' : ' .ag-group-contracted'))
  }
  const revealColumn = async (report: Report, field: string) => {
    const root = surface(report).root
    await execute('const v=document.querySelector(arguments[0]+" .ag-grid-viewport");v.scrollLeft=0', root)
    await command(session + '/execute/async', { script: 'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(done))', args: [] })
    const selector = `${root} .ag-header-cell[col-id="${field}"]`
    const steps = await execute('const v=document.querySelector(arguments[0]+" .ag-grid-viewport");return Math.ceil(v.scrollWidth/Math.max(v.clientWidth/2,1))+1', root)
    for (let step = 0; step <= steps; step++) {
      if (await execute('return !!document.querySelector(arguments[0])', selector)) {
        await execute('document.querySelector(arguments[0]).scrollIntoView({block:"nearest",inline:"nearest"})', selector)
        return selector
      }
      await execute('const v=document.querySelector(arguments[0]+" .ag-grid-viewport");v.scrollLeft+=Math.max(v.clientWidth/2,1)', root)
      await command(session + '/execute/async', { script: 'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(done))', args: [] })
    }
    throw Error(`Visible column missing: ${field}`)
  }
  const groupByLine = async (report: Report) => {
    const selector = await revealColumn(report, 'line')
    await execute(`document.querySelector(arguments[0]).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:450,clientY:150}))`, selector)
  }
  const openFirstCollapsedGroup = async (report: Report) => {
    const selector = groupSelector(report, false)
    if (!await execute('return !!document.querySelector(arguments[0])', selector)) return
    if (report.report) await execute(`const group=document.querySelector(arguments[0]);
      const button=[...group.querySelectorAll('button')].find(e=>/^Развернуть группу /.test(e.getAttribute('aria-label')||e.textContent.trim()));
      if(!button)throw Error('Collapsed group button missing');button.click()`, selector)
    else await click(selector + ' .ag-group-contracted')
  }
  const waitForRpc = async (started: number, prefix: string) => {
    await expect.poll(async () => {
      const urls: string[] = await execute('return performance.getEntriesByType("resource").filter(e=>e.startTime>=arguments[0]&&e.name.includes("/_serverFn/")).map(e=>e.name)', started)
      return urls.some(url => rpcName(url).startsWith(prefix))
    }, { timeout: 240_000, intervals: [20, 40, 75, 100] }).toBe(true)
  }
  const samples: object[] = [], diagnostics: object[] = []
  let activePhase = ''
  const foreground = async () => {
    expect(await execute('return {visible:!document.hidden,focused:document.hasFocus()}'), 'Owned Safari window must remain in the foreground').toEqual({ visible: true, focused: true })
  }
  const install = async (target: OpeningSurface) => {
    await execute(`(${installOpeningProbe.toString()})(arguments[0]);
      window.deepSafariVisibility={started:performance.now(),visible:true,focused:true,frames:0,active:true,
        firstLostFocusMs:null,firstHiddenMs:null,firstLossElement:null};
      const tick=()=>{const v=window.deepSafariVisibility;if(!v.active)return;v.frames++;
        const visible=!document.hidden,focused=document.hasFocus();
        if((!visible&&v.firstHiddenMs===null)||(!focused&&v.firstLostFocusMs===null)){
          const at=performance.now()-v.started;
          if(!visible&&v.firstHiddenMs===null)v.firstHiddenMs=at;
          if(!focused&&v.firstLostFocusMs===null)v.firstLostFocusMs=at;
          if(v.firstLossElement===null){const e=document.activeElement;v.firstLossElement={tag:e?.tagName??null,ariaLabel:e?.getAttribute('aria-label')??null}}}
        v.visible&&=visible;v.focused&&=focused;requestAnimationFrame(tick)};tick()`, target)
  }
  const measure = async (report: Report, phase: string, round: number, action: () => Promise<unknown>, options: { navigation?: boolean; grouped?: boolean; count?: number; condition?: () => Promise<unknown> } = {}) => {
    activePhase = `${report.name}:${phase}:${round}`
    console.log('DEEP_SAFARI_PHASE', JSON.stringify({ phase: activePhase, state: 'start' }))
    await foreground()
    if (!options.navigation) { await execute('performance.clearResourceTimings()'); await install(surface(report)) }
    const start = performance.now()
    await action()
    if (options.navigation) await install(surface(report))
    await options.condition?.()
    await ready(report, options.grouped, options.count, false)
    const observedRowsReadyMs = performance.now() - start
    await ready(report, options.grouped, options.count)
    const observedSummaryReadyMs = performance.now() - start
    const result = await execute(`const p=window.deepOpeningProbe;p.inspect();p.stop();const v=window.deepSafariVisibility;v.active=false;
      const f=p.frames.slice(1).map((n,i)=>n-p.frames[i]).sort((a,b)=>a-b);
      const nav=performance.getEntriesByType('navigation')[0];return {gridMs:p.gridMs,firstRowMs:p.firstRowMs,readyAfterTransitionMs:p.readyAfterTransitionMs,
        summaryMs:p.summaryMs,gridMounts:p.gridMounts,busySeen:p.busySeen,visibility:v,probeInstalledAtMs:v.started-p.started,raf:{count:f.length,p95Ms:f[Math.floor(f.length*.95)]??null,maxMs:f.at(-1)??null},
        navigation:arguments[0]?{ttfbMs:nav.responseStart,htmlCompleteMs:nav.responseEnd,domContentLoadedMs:nav.domContentLoadedEventEnd,type:nav.type}:null,
        domNodes:document.querySelectorAll('*').length}`, Boolean(options.navigation))
    if (!result.visibility.visible || !result.visibility.focused) diagnostics.push({
      invalidForegroundSample: true, failurePhase: activePhase, observedRowsReadyMs, observedSummaryReadyMs, result,
    })
    await foreground()
    expect(result.visibility.visible).toBe(true); expect(result.visibility.focused).toBe(true)
    // Allow ancillary responses to finish outside timed readiness. No route/
    // fetch interception: ResourceTiming observes the real cache and transport.
    await command(session + '/execute/async', { script: 'setTimeout(arguments[arguments.length-1],500)', args: [] })
    const resources: Array<{ name: string; startMs: number; finishMs: number; transferBytes: number; encodedBytes: number }> = await execute(`return performance.getEntriesByType('resource').filter(e=>e.startTime>=window.deepOpeningProbe.started).map(e=>
      ({name:e.name,startMs:e.startTime-window.deepOpeningProbe.started,finishMs:e.responseEnd-window.deepOpeningProbe.started,transferBytes:e.transferSize,encodedBytes:e.encodedBodySize}))`)
    const requests = resources.filter(r => r.name.includes('/_serverFn/')).map(r => ({ ...r, name: rpcName(r.name) }))
    samples.push({ surface: report.name, phase, round, observedRowsReadyMs, observedSummaryReadyMs, ...result, resources, requests })
    console.log('DEEP_SAFARI_PHASE', JSON.stringify({ phase: activePhase, state: 'complete', observedRowsReadyMs, observedSummaryReadyMs, calls: requests.map(r => r.name) }))
  }
  const leave = async (report: Report) => {
    const other = report.name === 'journal' ? reports[1] : reports[0]
    await click('button', other.button); await ready(other, 'either')
  }
  try {
    // Inspect only this owned session if preparation stalls; keep cleanup in
    // the surrounding finally even if writing this diagnostic fails.
    await writeFile(info.outputPath('native-safari-session.json'), JSON.stringify({ driver: 'http://127.0.0.1:4445', sessionId: created.sessionId }))
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    // Foreground coordination is outside every timing. Give the operator
    // time to see the message; the frame-by-frame guards remain unchanged.
    await prepareSafariMeasurementWindow(command, session, 600_000)
    // Auth helper opens only JSON. Confirm foreground again before timed HTML.
    await foreground()
    await measure(reports[0], 'dispatcher-dirty-fixture-first-opening', 0,
      () => command(session + '/url', { url: origin.origin + '/journal' }), { navigation: true })
    // One session deliberately shares asset cache across reports. This first
    // direct visit is not labelled cold; actual transferBytes remain available.
    for (const report of selectedReports) {
      await measure(report, 'first-direct-report-visit-in-session', 0,
        () => command(session + '/url', { url: origin.origin + report.path }), { navigation: true })
      for (let round = 0; round < repeatRounds; round++) await measure(report, 'warm-browser-reload', round,
        () => command(session + '/refresh', {}), { navigation: true })
      for (let round = 0; round < repeatRounds; round++) {
        await leave(report)
        await measure(report, 'warm-spa-return', round, () => click('button', report.button))
      }
      await measure(report, 'fragment-filter', 0, async () => {
        const started = await execute('return performance.now()')
        await fill(search(report), project)
        await waitForRpc(started, report.report ? 'readJournalGrid_' : 'listRemoteGeneratedDocumentHistoryGrid_')
      }, { count: report.report ? total : documentCount })
      await groupByLine(report)
      await measure(report, 'group-after-fragment-filter', 0, () => click('[role="menuitem"]', 'Сгруппировать по «Линия»'), { grouped: true })
      await measure(report, 'expand-filtered-group', 0, () => toggleGroup(report, false))
      const leaf = `${surface(report).root} ${surface(report).leaf}`
      const selectedId = await execute('return document.querySelector(arguments[0]).getAttribute("row-id")', leaf)
      await click(`${leaf} input[type="checkbox"]`)
      await wait('return document.querySelector(arguments[0]+" input[type=checkbox]")?.checked===true', `${surface(report).root} [row-id="${selectedId}"]`)
      for (let round = 0; round < repeatRounds; round++) {
        await measure(report, 'collapse-until-leaf-controls-removed', round, () => toggleGroup(report, true), {
          grouped: true, condition: () => wait('return !document.querySelector(arguments[0])', leaf),
        })
        await measure(report, 'reopen-after-completed-collapse', round, () => toggleGroup(report, false))
        expect(await execute('return document.querySelector(arguments[0]+" input[type=checkbox]")?.checked', `${surface(report).root} [row-id="${selectedId}"]`)).toBe(true)
      }
      await leave(report)
      await measure(report, 'return-with-filter-and-group', 0, () => click('button', report.button), { grouped: true })
      expect(await execute('return document.querySelector(arguments[0]).value', search(report))).toBe(project)
      for (let saveRound = 0; saveRound < saveRounds; saveRound++) {
        activePhase = `${report.name}:ordinary-save-preparation:${saveRound}`
        await foreground()
        // Normalize the view before the write. No filter restoration or fresh
        // target read may warm the changed revision before timed reopening.
        if (await execute('return document.querySelector(arguments[0]).value', search(report)) !== project) await fill(search(report), project)
        await ready(report, true, report.report ? total : documentCount)
        await revealColumn(report, 'line')
        const group = `${surface(report).root} .ag-row-group${report.report ? ' .ag-group-value' : ''}`
        await execute(`const e=document.querySelector(arguments[0]);if(!e)throw Error('Save scope group missing');
          e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:450,clientY:200}))`, group)
        await click('button', 'Свернуть все')
        await wait('return !document.querySelector(arguments[0])', groupSelector(report, true))
        if (report.name === 'journal') {
          await revealColumn(report, 'joint')
          await toggleGroup(report, false)
          await ready(report, false, total)
        } else {
          await click('button', reports[0].button)
          await ready(reports[0], 'either')
          await fill(search(reports[0]), firstJoint)
          await ready(reports[0], 'either', 1)
          await openFirstCollapsedGroup(reports[0])
          await ready(reports[0], false, 1)
          await revealColumn(reports[0], 'joint')
        }
        const savedJointRowId = await execute(`const e=[...document.querySelectorAll('[data-weld-report-grid="weldingJournal"] [col-id="joint"] button')].find(e=>e.textContent.trim()===arguments[0]);
          if(!e)throw Error('Saved joint target missing');return e.closest('.ag-row')?.getAttribute('row-id')`, firstJoint)
        expect(savedJointRowId).toBeTruthy()
        const editTarget = await command(session + '/element', { using: 'css selector',
          value: `[data-weld-report-grid="weldingJournal"] .ag-row[row-id="${savedJointRowId}"] [col-id="joint"] button` })
        // Exercise the ordinary right-click pointer sequence. A standalone
        // synthetic contextmenu event did not open the native row menu.
        activeAction = 'right click saved joint'
        await command(session + '/actions', { actions: [{ type: 'pointer', id: 'deep-opening-context',
          parameters: { pointerType: 'mouse' }, actions: [
            { type: 'pointerMove', origin: editTarget, x: 0, y: 0, duration: 0 },
            { type: 'pointerDown', button: 2 }, { type: 'pointerUp', button: 2 },
          ] }] })
        await click('button', 'Редактировать стык')
        const label = report.name === 'documents' ? 'Линия' : 'Изометрия'
        const baseValue = report.name === 'documents' ? `${firstLine}-UPDATED` : `SAVED-${report.name}`
        const value = saveRounds === 1 ? baseValue : `${baseValue}-${String(saveRound + 1).padStart(3, '0')}`
        const changed = await execute('return performance.now()')
        await fill(`[role="dialog"] input[aria-label="${label}"]`, value)
        if (report.name === 'documents') {
          await waitForRpc(changed, 'getPstoWeldLineMovePreview_')
          // Preserve the real move prerequisite and its ordinary default of
          // retaining control stages; a fresh line can need no confirmation.
          await command(session + '/execute/async', { script: 'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(done))', args: [] })
          const confirmation = await execute(`return [...document.querySelectorAll('button')].find(e=>/^Подтвердить перенос(?: цепочки)?$/.test(e.textContent.trim()))?.textContent.trim()||null`)
          if (confirmation) await click('button', confirmation)
        }
        await click('[role="dialog"] button', 'Сохранить')
        await wait('return !document.querySelector(arguments[0])', `[role="dialog"] input[aria-label="${label}"]`)
        await ready(reports[0], 'either', report.name === 'journal' ? total : 1)
        if (report.name === 'journal') await leave(report)
        const field = report.report ? 'isometry' : 'line'
        const freshRows = report.report
          ? `.ag-row[row-id="${savedJointRowId}"]:not(.ag-row-group)` : surface(report).leaf
        await measure(report, 'reopen-and-read-saved-record', saveRound, async () => {
          await click('button', report.button)
          await ready(report, true, undefined, false)
          expect(await execute('return document.querySelector(arguments[0]).value', search(report))).toBe(project)
          await revealColumn(report, 'line')
          const groupValue = report.report ? firstLine : value
          const labelSelector = report.report ? '.ag-group-value' : '.document-grid-group-label > span'
          await wait(`const root=document.querySelector(arguments[0]);return [...root.querySelectorAll('.ag-row.ag-row-group')]
            .some(row=>row.querySelector(arguments[1])?.textContent.trim()===arguments[2])`, surface(report).root, labelSelector, groupValue)
          if (!report.report) await wait(`const root=document.querySelector(arguments[0]),groups=[...root.querySelectorAll('.ag-row.ag-row-group')];
            const row=groups.find(row=>row.querySelector(arguments[1])?.textContent.trim()===arguments[2]);
            return row?.querySelector('.ag-group-child-count')?.textContent.trim()==='(1)'&&
              (arguments[3]===null||!groups.some(row=>row.querySelector(arguments[1])?.textContent.trim()===arguments[3]))`,
          surface(report).root, labelSelector, groupValue, saveRound > 0 ? `${baseValue}-${String(saveRound).padStart(3, '0')}` : null)
          await execute(`const root=document.querySelector(arguments[0]);const row=[...root.querySelectorAll('.ag-row.ag-row-group')]
            .find(row=>row.querySelector(arguments[1])?.textContent.trim()===arguments[2]);
            if(!row)throw Error('Saved line group missing');if(row.getAttribute('aria-expanded')!=='true'){
              const toggle=row.querySelector('.ag-group-contracted');if(!toggle)throw Error('Saved group toggle missing');toggle.click()}`,
          surface(report).root, labelSelector, groupValue)
          await revealColumn(report, field)
        }, {
          count: report.report ? total : documentCount,
          condition: () => wait(`const root=document.querySelector(arguments[0]),rows=[...root.querySelectorAll(arguments[1])];
            if(!arguments[4]&&new Set(rows.map(row=>row.getAttribute('row-id'))).size!==1)return false;return rows.some(row=>{
              const cell=row.querySelector('[col-id="'+arguments[2]+'"]');return cell?.getClientRects().length&&cell.textContent.trim()===arguments[3]})`,
          surface(report).root, freshRows, field, value, Boolean(report.report)),
        })
        const stored = await withE2eDatabase(async db => (await db.query('select line,isometry from weld_joints where project_title=$1 and joint=$2', [project, firstJoint])).rows[0])
        expect(report.name === 'documents' ? stored.line : stored.isometry).toBe(value)
        await fill(search(report), report.report ? firstJoint : manualTitle)
        await ready(report, true, 1)
        await openFirstCollapsedGroup(report)
        await ready(report, false, 1)
        // LNK/PSTO deliberately have no ordinary weld editor. Check the fresh
        // visible value in their report cell, as in the Chrome comparator.
        await revealColumn(report, field)
        await wait(`const root=document.querySelector(arguments[0]);return [...root.querySelectorAll(arguments[1])]
          .some(e=>e.getClientRects().length&&e.textContent.includes(arguments[2]))`, surface(report).root,
        `${surface(report).leaf} [col-id="${field}"]`, value)
        diagnostics.push({ report: report.name, selectedId, saveRound, saved: value, savedJointRowId, timedSavedValueVerified: true, durableAndFreshReadVerified: true,
          savedScope: { search: project, groupBy: ['line'], rows: report.report ? total : documentCount } })
      }
      if (report.name === 'documents') {
        const system: Report = { ...report, name: 'documents-system', root: '[data-document-history-grid^="system:lnkRequest:"]' }
        await measure(system, 'first-system-registry-tab', 0, () => click('button', 'Заявка ЛНК'), { count: documentCount })
        for (let round = 0; round < repeatRounds; round++) {
          await leave(system)
          await measure(system, 'warm-system-registry-return', round, () => click('button', 'Документы'), { count: documentCount })
        }
      }
    }
  } catch (error) {
    try {
      diagnostics.push({ failurePhase: activePhase, activeAction, state: await execute('return {url:location.href,text:document.body.innerText,hidden:document.hidden,focused:document.hasFocus()}') })
      await writeFile(info.outputPath('deep-opening-safari-failure.png'), Buffer.from(await command(session + '/screenshot'), 'base64'))
    } catch (diagnosticError) { diagnostics.push({ diagnosticError: String(diagnosticError) }) }
    throw error
  } finally {
    const result = { label: process.env.DEEP_OPENING_LABEL ?? 'unlabelled', browser: 'installed Safari', version: created.capabilities.browserVersion,
      joints: total, manualDocuments: documentCount, systemRequests: documentCount, templateBytes, repeatRounds, saveRounds,
      selectedReports: selectedReports.map(report => report.name), sessions: 1, cpuThrottling: 'none',
      limitations: ['One native Safari session shares asset cache across reports; no cold-disk claim',
        'DEEP_OPENING_REPORTS may select a subset: the full fixture and journal preparation/navigation remain; separate subset sessions do not measure one shared four-family cache',
        'After-save rounds restore project filters/line grouping before ordinary UI writes; durable SQL and an additional narrow visible-value check run after timed reopening',
        'reopen-and-read-saved-record includes navigation, finding/expanding the saved line group and revealing its column; observedRowsReadyMs waits for the exact new visible value without changing the project filter, unlike ordinary warm reopening or the historical after-save phase',
        'WebDriver polling is an upper bound; navigation DOM observer is installed just after eager navigation returns',
        'Foreground is checked before/after each sample and in every observed RAF; the pre-observer navigation interval is not sampled',
        'Collapse timing includes removal of obsolete leaf controls; reopen starts only after completed collapse, unlike Chrome immediate reopen',
        'RPC names/timing are ResourceTiming observations; no interception or request-body instrumentation',
        'RAF intervals are not physical FPS; binary-update recovery and large document cardinality are separate profiles'], samples, diagnostics }
    try { await writeFile(info.outputPath(`deep-opening-safari-${process.env.DEEP_OPENING_LABEL ?? 'unlabelled'}.json`), JSON.stringify(result, null, 2)) }
    finally { await command(session, undefined, 'DELETE') }
  }
}
