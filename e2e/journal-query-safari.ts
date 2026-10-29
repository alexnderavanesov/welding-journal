import { expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { WELD_FIELDS } from '../src/lib/weld-fields'
import { prepareSafariMeasurementWindow } from './safari-foreground'
import { rpcName } from './rpc'

/** Native Safari measurements against the runner's disposable local fixture. */
export async function measureJournalQueriesInSafari(project: string, total: number, diagnosticPath: string) {
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
  const wait = (script: string, timeout = 30_000) => expect.poll(() => execute(script), { timeout }).toBe(true)
  const ready = 'document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"'
  const button = (label: string) => `[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)})`
  const fill = async (value: string) => {
    const element = await command(session + '/element', { using: 'css selector', value: 'input[aria-label="Быстрый поиск по отчету"]' })
    await execute('const el=document.querySelector("input[aria-label=\\"Быстрый поиск по отчету\\"]");el.focus();el.select()')
    await command(session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/value', { text: value })
  }
  const menu = async (field: string) => {
    await execute('document.querySelector(`.ag-header-cell[col-id="${arguments[0]}"]`).dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:450,clientY:150}))', field)
    await wait('return !!document.querySelector("[role=menuitem]")')
  }
  const samples: object[] = []
  const measure = async (round: number, action: string, run: () => Promise<unknown>, condition: string) => {
    await execute(`window.querySample={start:performance.now(),frames:0,hidden:document.hidden,calls:[]};window.queryDone=false;
      const tick=()=>{const s=window.querySample;s.frames++;s.hidden||=document.hidden;
        if(performance.now()-s.start>30&&${ready}&&(${condition})){s.milliseconds=performance.now()-s.start;window.queryDone=true;return}requestAnimationFrame(tick)};requestAnimationFrame(tick)`)
    await run()
    await wait('return window.queryDone===true', 60_000)
    const sample = await execute('return window.querySample')
    expect(sample.hidden).toBe(false)
    expect(sample.frames).toBeGreaterThan(0)
    const calls = sample.calls.map((url: string) => rpcName(new URL(url, 'http://127.0.0.1:3100').toString())).filter(Boolean)
    const blockReads = calls.filter((name: string) => /^readJournalGrid(?:Blocks)?_/.test(name)).length
    if (action === 'open') expect(blockReads).toBe(1)
    if (action === 'reopen' && process.env.JOURNAL_QUERY_BEFORE_INDEX !== '1') expect(blockReads).toBe(0)
    samples.push({ round, action, ...sample, calls, blockReads })
  }
  try {
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await command(session + '/window', { handle: await command(session + '/window') })
    await prepareSafariMeasurementWindow(command, session)
    await command(session + '/url', { url: 'http://127.0.0.1:3100/journal' })
    await wait('return !!document.querySelector("input[aria-label=\\"Быстрый поиск по отчету\\"]")')
    const hidden = WELD_FIELDS.filter(field => !['projectTitle', 'line', 'joint', 'wdi'].includes(field.key)).map(field => field.key)
    for (let round = 0; round < 3; round++) {
      await execute(`localStorage.clear();sessionStorage.clear();localStorage.setItem('welding-report-view:v1:weldingJournal',JSON.stringify({activePreset:'custom',hiddenFieldKeys:arguments[0],customHiddenFieldKeys:arguments[0],collapsedSections:[],savedViews:[]}))`, hidden)
      await command(session + '/refresh', {})
      await wait('return !!document.querySelector("input[aria-label=\\"Быстрый поиск по отчету\\"]")')
      await fill(project)
      await wait(`return ${ready}&&document.body.innerText.includes('Найдено: ${total}')`, 180_000)
      await execute(`const original=window.fetch;window.fetch=function(...args){if(window.querySample)window.querySample.calls.push(String(args[0] instanceof Request?args[0].url:args[0]));return original.apply(this,args)}`)
      await menu('joint')
      await measure(round, 'sort', () => execute('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.textContent.trim()==="По убыванию").click()'),
        `document.querySelector('.ag-row[row-index="0"] [col-id=joint]')?.textContent==='F${total}'`)
      await measure(round, 'filter', () => fill('F' + total), `document.body.innerText.includes('Найдено: 1')&&!document.body.innerText.includes('Найдено: ${total}')`)
      await fill(project)
      await wait(`return ${ready}&&document.body.innerText.includes('Найдено: ${total}')`)
      await menu('line')
      await measure(round, 'group', () => execute('[...document.querySelectorAll("[role=menuitem]")].find(e=>e.textContent.startsWith("Сгруппировать по")).click()'),
        `!!${button('Развернуть группу QUERY-0000')}`)
      for (const action of ['open', 'reopen']) {
        await measure(round, action, () => execute(`${button('Развернуть группу QUERY-0000')}.click()`),
          `!!document.querySelector('[aria-label="Выбрать стык F299"]')`)
        if (action === 'open') {
          await execute('const el=document.querySelector(\'[aria-label="Выбрать стык F299"]\');if(!el.checked)el.click()')
          await wait('return document.querySelector(\'[aria-label="Выбрать стык F299"]\')?.checked===true')
        }
        else expect(await execute('return document.querySelector(\'[aria-label="Выбрать стык F299"]\').checked')).toBe(true)
        await execute(`${button('Свернуть группу QUERY-0000')}.click()`)
        await wait('return !document.querySelector(\'[aria-label="Выбрать стык F299"]\')')
      }
    }
    return { browser: created.capabilities.browserVersion, total, samples }
  } catch (error) {
    await writeFile(diagnosticPath, JSON.stringify({ samples, state: await execute('return {text:document.body.innerText,hidden:document.hidden,focus:document.hasFocus(),sample:window.querySample}') }, null, 2))
    await writeFile(diagnosticPath + '.png', Buffer.from(await command(session + '/screenshot'), 'base64'))
    throw error
  } finally { await command(session, undefined, 'DELETE') }
}
