import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { prepareSafariMeasurementWindow } from '../safari-foreground'

const project = 'E2E native Safari document selection'
test.use({ trace: 'off', video: 'off' })

for (const kind of ['generated', 'system'] as const) test(`installed Safari: ${kind} document ranges, checkboxes and group focus`, async ({ baseURL }, info) => {
  test.skip(process.env.DOCUMENT_SELECTION_SAFARI !== '1', 'Explicit installed Safari pointer check')
  test.setTimeout(150_000)
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'NATIVE',case when n<=6 then 'SAFARI-A' else 'SAFARI-B' end,'F'||n,'2026-10-01',
        'действующий','актуальная','да','NATIVE-REQ-'||lpad(n::text,2,'0'),'2026-10-02'
      from generate_series(1,12) n`, [project])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','NATIVE-DOC-'||lpad(n::text,2,'0'),'native.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1 from generate_series(1,12) n`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d join weld_joints w
        on d.title='NATIVE-DOC-'||lpad(substring(w.joint from 2),2,'0') where w.project_title=$1`, [project])
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  const driver = spawn('/usr/bin/safaridriver', ['--port', '4473'], { stdio: 'ignore' })
  let session = ''
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> => {
    const response = await fetch('http://127.0.0.1:4473' + path, { method,
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(`${path}: ${JSON.stringify(result.value)}`)
    return result.value
  }
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const wait = (script: string) => expect.poll(() => execute(script), { timeout: 15_000, message: script }).toBe(true)
  const root = '[data-document-history-grid]'
  const leaf = `${root} .ag-row[row-id^="document:"]`
  const check = `${leaf} input[type="checkbox"]`
  const group = `${root} .ag-full-width-row.ag-row-group[row-index="0"]`
  const point = async (selector: string, index = 0, edge: boolean | 'padding' = false) => {
    await wait(`return !!document.querySelectorAll(${JSON.stringify(selector)})[${index}]`)
    return execute(`const matches=[...document.querySelectorAll(arguments[0])].sort((a,b)=>Number(a.closest('[row-index]')?.getAttribute('row-index')??0)-Number(b.closest('[row-index]')?.getAttribute('row-index')??0));
      const e=matches[arguments[1]],r=e.getBoundingClientRect();
      const x=Math.round(r.x+(arguments[2]==='padding'?3:arguments[2]?-4:r.width/2)),y=Math.round(r.y+r.height/2);
      if(!r.width||!r.height||y<0||y>innerHeight)throw new Error('Pointer target is outside the viewport');
      return {x,y}`, selector, index, edge)
  }
  const pointer = async (selector: string, index = 0, edge: boolean | 'padding' = false, button = 0) => {
    const p = await point(selector, index, edge)
    await command(session + '/actions', { actions: [{ type: 'pointer', id: 'document-mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', origin: 'viewport', ...p, duration: 0 }, { type: 'pointerDown', button }, { type: 'pointerUp', button },
    ] }] })
  }
  const key = (value: string, modifier?: string) => command(session + '/actions', { actions: [{ type: 'key', id: 'document-keys', actions: [
    ...(modifier ? [{ type: 'keyDown', value: modifier }] : []), { type: 'keyDown', value }, { type: 'keyUp', value },
    ...(modifier ? [{ type: 'keyUp', value: modifier }] : []),
  ] }] })
  const count = (value: number) => wait(`return [...document.querySelectorAll('${root} .document-grid-footer span')].some(e=>e.textContent.trim()==='Выбрано: ${value}')`)
  const clickText = async (selector: string, text: string) => {
    let target: { x: number; y: number } | null = null
    await expect.poll(async () => {
      target = await execute(`const e=[...document.querySelectorAll(arguments[0])].find(e=>e.textContent.trim()===arguments[1]&&e.getClientRects().length);
        if(!e)return null;
        for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.visibility==='hidden'||Number(s.opacity)<.99)return null}
        const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
        if(!r.width||!r.height||!e.contains(document.elementFromPoint(x,y)))return null;
        return {x,y}`, selector, text)
      return Boolean(target)
    }, { timeout: 15_000, message: `Visible pointer target: ${text}` }).toBe(true)
    await command(session + '/actions', { actions: [{ type: 'pointer', id: 'document-mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', origin: 'viewport', ...target!, duration: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
    ] }] })
  }
  try {
    await expect.poll(async () => { try { return !!await command('/status') } catch { return false } }).toBe(true)
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
    session = '/session/' + created.sessionId
    await command(session + '/window/rect', { x: 0, y: 0, width: 1728, height: 1050 })
    await prepareSafariMeasurementWindow(command, session, 60_000)
    await command(session + '/url', { url: baseURL + '/documents' })
    if (kind === 'system') await clickText('button', 'Заявка ЛНК')
    await wait(`return document.querySelector('${root}')?.innerText.includes('Найдено: 12')`)
    await pointer(`${root} .ag-header-cell[col-id="line"]`, 0, false, 2)
    await wait(`return [...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.trim()==='Сгруппировать по «Линия»')`)
    await clickText('[role="menuitem"]', 'Сгруппировать по «Линия»')
    await pointer(`${group} input[type="checkbox"]`); await count(6)
    await wait(`return document.activeElement===document.querySelector('${group} input[type="checkbox"]')`)
    await key('\uE00D'); await count(0)
    await pointer(group)
    await key('\uE007')
    await wait(`return document.querySelector('${group}')?.getAttribute('aria-expanded')==='true'`)
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = await point(check, 0), end = await point(check, 2)
      await command(session + '/actions', { actions: [{ type: 'pointer', id: 'document-mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', origin: 'viewport', ...start, duration: 0 }, { type: 'pointerDown', button: 0 },
        ...Array.from({ length: 8 }, (_, i) => ({ type: 'pointerMove', origin: 'viewport', x: start.x,
          y: Math.round(start.y + (end.y - start.y) * (i + 1) / 8), duration: 30 })), { type: 'pointerUp', button: 0 },
      ] }] })
      await wait(`return document.querySelectorAll('${root} .ag-cell-range-selected').length===3`)
      await key('\uE00D', '\uE008'); await count(3)
      await pointer(check, 1, true); await count(2)
      await wait(`return document.querySelectorAll('${root} .ag-cell-range-selected').length===0`)
      await pointer(check, 1); await count(3)
      await pointer(`${group} input[type="checkbox"]`); await count(6)
      await pointer(`${group} input[type="checkbox"]`); await count(0)
    }
    // Keep Cmd multi-range; a subsequent plain checkbox click clears ranges.
    const title = `${leaf} .ag-cell[col-id="title"]`
    // Click the cell padding, avoiding the document link.
    await pointer(title, 0, 'padding')
    await command(session + '/actions', { actions: [{ type: 'key', id: 'document-keys', actions: [{ type: 'keyDown', value: '\uE03D' }] }] })
    try { await pointer(title, 2, 'padding') }
    finally { await command(session + '/actions', { actions: [{ type: 'key', id: 'document-keys', actions: [{ type: 'keyUp', value: '\uE03D' }] }] }) }
    await wait(`return document.querySelectorAll('${root} .ag-cell-range-selected').length===2`)
    await key('\uE00D', '\uE008'); await count(2)
    await pointer(check, 2); await count(1)
    await pointer(check, 0); await count(0)
    await pointer(title, 0, 'padding')
    await key('\uE013')
    for (const value of ['\uE032', '\uE007', '\uE032', '\uE007']) {
      await key(value)
      await wait(`return document.activeElement===document.querySelector('${group}')&&document.querySelectorAll('${root} .ag-cell-range-selected').length===0`)
    }
    await key('\uE015')
    await wait(`return document.activeElement===document.querySelector('${leaf}[row-index="1"] .ag-cell[col-id="title"]')`)
    const header = `${root} input[aria-label="Выбрать все документы"]`
    await pointer(header); await count(12)
    await wait(`return document.activeElement===document.querySelector('${header}')`)
    await key('\uE00D'); await count(0)
    console.log('SAFARI_DOCUMENT_SELECTION', JSON.stringify({ kind, version: created.capabilities.browserVersion }))
  } finally {
    if (session) {
      await writeFile(info.outputPath('safari-document-selection.png'), Buffer.from(await command(session + '/screenshot'), 'base64')).catch(() => {})
      await writeFile(info.outputPath('safari-document-state.json'), JSON.stringify(await execute(`return {hidden:document.hidden,focused:document.hasFocus(),text:document.body.innerText,active:document.activeElement?.outerHTML}`).catch(() => null))).catch(() => {})
      await command(session, undefined, 'DELETE').catch(() => {})
    }
    driver.kill('SIGTERM')
    await cleanupLineProgramProjects([project])
  }
})
