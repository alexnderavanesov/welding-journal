import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { prepareSafariMeasurementWindow } from '../safari-foreground'
import { getReportImportTemplateFields } from '../../src/lib/report-import-template'

const project = 'E2E installed Safari grid families'
const line = 'SAFARI-GRID-01'
test.use({ trace: 'off', video: 'off' })

test('installed Safari: program, nested assignments, LNK/PSTO, statistics, documents and import remain usable', async ({}, info) => {
  test.skip(process.env.AUDIT_SAFARI_GRIDS !== '1', 'Requires the installed SafariDriver automation window')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(info.project.use.baseURL).toBe('http://127.0.0.1:3100')
  test.setTimeout(600_000)
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      select $1,'SAFARI','SAFARI-GRID-'||lpad(n::text,2,'0'),'II','Б(а)',10,10,'assigned' from generate_series(1,50) n`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,stamp_1_k,stamp_1_z,stamp_1_k_fact,
      has_vik,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,vik_result,psto_required)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,3,'0'),'2026-10-20',
        'действующий','актуальная','С17','SFA','SFB','SFA','да','SAFARI-VIK-'||p.line,'2026-10-21',
        'SAFARI-C-'||p.line,'2026-10-22','годен','да'
      from line_programs p cross join generate_series(1,50) n where project_title=$1 and (p.line=$2 or n<=3)`, [project,line])
    await db.query(`update weld_joints set psto_request='SAFARI-PSTO-'||line,psto_request_date='2026-10-20',
      psto_result='проведено',psto_date='2026-10-21',heat_treatment_diagram='SAFARI-DIAGRAM-'||line,
      tvmt_request='SAFARI-TVMT-'||line,tvmt_request_date='2026-10-21',tvmt_conclusion='SAFARI-TVMT-C-'||line,
      tvmt_conclusion_date='2026-10-22',tvmt_result='годен' where project_title=$1`,[project])
    await db.query(`insert into psto_chain_exceptions(line_program_id,root_joint,required,basis)
      select id,'f001',false,'Safari fixture exception' from line_programs where project_title=$1 and line=$2`, [project,line])
    await db.query(`update weld_joints set psto_required='нет' where project_title=$1 and line=$2 and joint='F001'`, [project,line])
    for (const type of ['weldingJournal','checklist','zni','layeredVikEdges','layeredVikLayers','layeredPvkEdges','layeredPvkLayers']) {
      await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
        select $1,'SAFARI-'||$1||'-'||lpad(n::text,2,'0'),'safari.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',2
        from generate_series(1,30) n`, [type])
    }
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d cross join weld_joints w
      where d.title like 'SAFARI-%' and w.project_title=$1 and w.line=$2 and w.joint in ('F001','F002')`, [project,line])
  })
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value))
    return result.value
  }
  let session = ''
  const observations: unknown[] = []
  try {
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
    session = '/session/' + created.sessionId
    const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
    const wait = (script: string) => expect.poll(() => execute(script), { timeout: 30_000 }).toBe(true)
    const element = async (selector: string, text?: string) => {
      let reference: Record<string,string> | null = null
      await expect.poll(async () => {
        reference = await execute(`return [...document.querySelectorAll(arguments[0])].find(e=>
          (arguments[1]===null||e.textContent.trim()===arguments[1]||e.getAttribute('aria-label')===arguments[1])&&e.getClientRects().length)||null`, selector, text ?? null)
        return Boolean(reference)
      }, { timeout: 30_000 }).toBe(true)
      return Object.values(reference!)[0]
    }
    const click = async (selector: string, text?: string) => command(session + '/element/' + await element(selector,text) + '/click', {})
    const type = async (selector: string, value: string) => {
      const id = await element(selector)
      await command(session + '/element/' + id + '/clear', {})
      await command(session + '/element/' + id + '/value', { text: value, value: [...value] })
    }
    const key = async (value: string) => {
      const active = await command(session + '/element/active')
      await command(session + '/element/' + Object.values(active)[0] + '/value', { text: value, value: [value] })
    }
    const bodyContains = (text: string) => wait(`return document.body.innerText.includes(${JSON.stringify(text)})`)
    const goto = async (path: string) => {
      await command(session + '/url', { url: 'http://127.0.0.1:3100' + path })
      await execute(`window.gridAuditErrors=[];window.addEventListener('error',e=>window.gridAuditErrors.push(e.message));
        window.addEventListener('unhandledrejection',e=>window.gridAuditErrors.push(String(e.reason)))`)
    }
    const inspect = async (name: string, selector: string, minRows = 1) => {
      await wait(`return document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.ag-row[row-id]').length>=${minRows}`)
      const state = await execute(`const root=document.querySelector(arguments[0]);return {rows:root.querySelectorAll('.ag-row[row-id]').length,
        columns:root.querySelectorAll('.ag-header-cell').length,hidden:document.hidden,focused:document.hasFocus(),
        errors:window.gridAuditErrors||[],domNodes:document.querySelectorAll('*').length,
        requests:performance.getEntriesByType('resource').filter(e=>e.name.includes('/_serverFn/')).length}`, selector)
      expect(state.hidden).toBe(false)
      expect(state.errors).toEqual([])
      expect(state.rows).toBeLessThan(100)
      observations.push({ name, ...state })
    }
    await command(session + '/window/rect', { x:0, y:0, width:1600, height:1050 })
    await prepareSafariMeasurementWindow(command, session, 300_000)

    await goto('/line-program')
    await type('input[aria-label="Поиск программы линий"]', line)
    await inspect('program lines','[data-program-grid="lines"]')
    await click('button', `Расчёт линии ${line}`)
    await inspect('program stamps','[data-program-grid="stamps"]')
    await click('button', 'Клеймо SFA')
    await inspect('nested stamp joints','[data-program-grid="joints"]')
    await click('button', 'Открыть назначения линии ' + line)
    await inspect('assignment dialog','[data-program-grid="assignments"]')
    await click('input[aria-label="Выбрать F001"]')
    await key('\uE00C')
    await wait('return !document.querySelector("[data-program-grid=assignments]")')
    await click('button', 'Открыть назначения линии ' + line)
    await inspect('reopened assignments','[data-program-grid="assignments"]')
    await click('button','Вернуться к просмотру')
    await wait('return !document.querySelector("[data-program-grid=assignments]")')

    await goto('/lnk')
    await wait('return document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"')
    await inspect('LNK report','.journal-grid-frame')

    await goto('/psto')
    await wait('return document.querySelector(".journal-grid-frame")?.getAttribute("aria-busy")==="false"')
    await inspect('PSTO report','.journal-grid-frame')
    await click('header button','Программа ПСТО')
    await inspect('PSTO program','[role="grid"][aria-label="Линии программы ПСТО"]')
    await click('button','Исключения')
    await inspect('PSTO exceptions','[role="grid"][aria-label="Исключения ПСТО"]')
    await click('button','Добавить исключение')
    await inspect('PSTO chain picker','[role="grid"][aria-label="Выбор цепочки для исключения ПСТО"]')
    await key('\uE00C')

    await goto('/statistics')
    await click('button','Сварщики')
    await inspect('welder statistics','[data-statistics-grid="welders"]')
    await click('button','Подробности сварщика SFA')
    await bodyContains('Динамика по дням')
    await inspect('welder cards and chart','[data-statistics-grid="welders"]')
    await click('button','Полинейная сводка')
    await inspect('line statistics','[data-statistics-grid="lines"]')
    await click('[data-statistics-grid="lines"] .ag-header-cell[col-id="line"] .ag-header-cell-filter-button')
    await wait('return !!document.querySelector(".read-only-grid-popup .ag-filter")')
    await key('\uE00C')
    await wait('return document.activeElement?.getAttribute("col-id")==="line"')

    await goto('/documents')
    for (const label of ['ЖСР','Чек-лист','ЗНИ','Послойный ВИК','Послойный ПВК','Заявка ЛНК','Заключения ЛНК','Заявка ПСТО','Заключение ПСТО','Заявка ТВМТ','Заключение ТВМТ']) {
      await click('button',label)
      await inspect('document registry '+label,'[data-document-history-grid]')
      await click('[data-document-history-grid] .ag-header-cell[col-id="title"] .ag-header-cell-filter-button')
      await wait(`return !!document.querySelector('[role="dialog"][aria-label^="Фильтр: "]')`)
      await key('\uE00C')
    }

    await goto('/journal')
    await click('button','Импорт')
    await bodyContains('Импорт данных')
    const headers = getReportImportTemplateFields('weldingJournal').map(field => field.label)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      headers,
      ...Array.from({length:200},(_,i)=>{
        const values: Record<string,string> = { 'Проект':project,'Шифр':'SAFARI','Линия':line,'Стык':'F'+(1000+i),'Дата сварки':i===199?'31.02.2026':'20.10.2026' }
        return headers.map(header=>values[header]??'')
      }),
    ]),'Импорт')
    const file = info.outputPath('safari-import.xlsx')
    await writeFile(file,XLSX.write(book,{type:'buffer',bookType:'xlsx'}))
    const upload = await command(session + '/element', { using:'css selector',value:'[role="dialog"] input[type="file"]' })
    await command(session + '/element/' + Object.values(upload)[0] + '/value', { text:file,value:[...file] })
    await bodyContains('найдено: 200')
    await click('button','Все')
    await inspect('import preview','[data-import-preview-grid]')
    await click('button','Только строки с ошибками · 1')
    await bodyContains('Показано: 1')
    await inspect('import error filter','[data-import-preview-grid]')
    await writeFile(info.outputPath('installed-safari-grid-families.json'),JSON.stringify({version:created.capabilities.browserVersion,observations},null,2))
    console.log('SAFARI_GRID_FAMILIES',JSON.stringify(observations))
  } catch (error) {
    if(session) {
      await writeFile(info.outputPath('safari-grids-failure.png'),Buffer.from(await command(session+'/screenshot'),'base64'))
      await writeFile(info.outputPath('safari-grids-failure.json'),JSON.stringify({observations,state:await command(session+'/execute/sync',{
        script:'return {url:location.href,hidden:document.hidden,text:document.body.innerText,html:document.body.outerHTML}',args:[]})},null,2))
    }
    throw error
  } finally {
    if(session) await command(session,undefined,'DELETE')
    await withE2eDatabase(db=>db.query("delete from generated_documents where title like 'SAFARI-%'"))
    await cleanupLineProgramProjects([project])
  }
})
