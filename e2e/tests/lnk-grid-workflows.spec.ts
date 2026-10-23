import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { captureProgramChainStates } from '../../src/lib/line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '../../src/lib/system-index-settings'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import { lnkRow, revealLnkColumn } from './lnk-grid-helpers'
import { rpcName } from '../rpc'

const project = 'E2E LNK grid workflows'
const fields = ['line', 'joint', 'wdi', 'vikResult', 'rkResult', 'uzkResult', 'pvkResult',
  'preVikResult', 'preRkResult', 'preUzkResult', 'prePvkResult', 'vikRequest', 'preVikRequest', 'lnkNote', 'weldDate', 'finalStatus']
const cases = [
  ['LG-REPAIR', 'S810001', 'repair'], ['LG-REPAIR', 'S810001R1', 'good'],
  ['LG-WAIT', 'S810002', 'bad'], ['LG-WAIT', 'S810003', 'waiting'],
  ['LG-STAGES', 'S810004', 'stages'], ['LG-ERROR', 'S810005', 'error'],
  ['LG-CANCEL', 'S810006', 'cancelled'],
] as const

test.beforeAll(async () => {
  await withLineProgramFixture(async db => {
    const rows: WeldRow[] = []
    for (const [line, joint, state] of cases) {
      const id = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi,
        connection_type,d1,t1,officiality,revision_actuality,has_vik,has_rk,has_uzk,has_pvk,psto_required,
        vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
        rk_request,rk_request_date,rk_result,rk_conclusion,rk_conclusion_date,uzk_result,pvk_result)
        values($1,'LGRID',$2,$3,'2026-09-01',$4,'С17',254,10,'действующий','актуальная',$5,'да','да','да','да',
          $6,'2026-09-02',$7,$8,'2026-09-03',$9,'2026-09-02',$10,$11,$12,'годен','годен') returning id`,
      [project,line,joint,joint.endsWith('R1') ? 99 : 10,state === 'cancelled' ? 'отменен' : 'да',
        `MAIN-${joint}`,state === 'error' ? 'ошибка' : 'годен',`VIK-${joint}`,`RK-${joint}`,
        state === 'repair' ? 'ремонт' : state === 'bad' ? 'вырез' : state === 'waiting' ? null : 'годен',
        state === 'waiting' ? null : `RK-C-${joint}`,state === 'waiting' ? null : '2026-09-03'])).rows[0].id as number
      rows.push({ id, projectTitle: project, subtitleCode: 'LGRID', line, joint, weldDate: '2026-09-01', officiality: 'действующий' })
      for (const method of ['ВИК','РК','УЗК','ПВК']) await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,
        request_name,request_date,result,conclusion_name,conclusion_date)
        values($1,$2,$3,'2026-09-01',$4,$5,'2026-09-01')`, [id,method,`PRE-${method}-${joint}`,
          state === 'stages' && method === 'РК' ? 'ремонт' : 'годен',`PRE-C-${method}-${joint}`])
    }
    for (const state of captureProgramChainStates(rows, DEFAULT_SYSTEM_INDEX_SETTINGS).values()) await db.query(`insert into weld_joint_program_states(
      weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side,replaced_by_coil,replacement_coil_ids)
      values($1,$2,$3,$4,$5,$6,$7,$8)`,[state.weldJointId,state.kind,state.physicalRootId,state.sourceRowId,state.coilParentId,state.coilSide,state.replacedByCoil,state.replacementCoilIds ?? []])
  })
})
test.afterAll(async () => {
  await withLineProgramFixture(db => db.query(`delete from weld_joint_program_states s using weld_joints w where s.weld_joint_id=w.id and w.project_title=$1`,[project]))
  await cleanupLineProgramProjects([project])
})
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ fields, hidden }) => {
    localStorage.setItem('lnk-ag-grid:v1', JSON.stringify({ columns: fields.map(colId => ({ colId, pinned: ['line','joint'].includes(colId) ? 'left' : null, width: colId === 'line' ? 200 : 160 })) }))
    localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({ activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
  }, { fields, hidden: WELD_FIELDS.filter(field => !fields.includes(field.key)).map(field => field.key) })
})
async function open(page: Page, search = project) {
  await page.goto('/lnk')
  await page.getByRole('searchbox').fill(search)
  await expect(page.getByText(`Найдено: ${search === project ? 7 : 1}`, { exact: true })).toBeVisible()
  await expect(page.locator('[data-lnk-grid] .journal-grid-frame')).toHaveAttribute('aria-busy','false')
}
async function groupLines(page: Page) {
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
}
const group = (page: Page, line: string) => page.locator('.ag-row-group').filter({ has: page.getByRole('button', { name: new RegExp(`^(Развернуть|Свернуть) группу ${line}$`) }) })

test('ЛНК: физические итоги методов и этапов, история, ожидание и отдельный брак', async ({ page }, info) => {
  await open(page)
  await groupLines(page)
  await expect(group(page,'LG-REPAIR').locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(group(page,'LG-REPAIR').locator('[data-group-summary="wdi"]')).toHaveText('10')
  await group(page,'LG-REPAIR').getByRole('checkbox').click()
  await expect(group(page,'LG-REPAIR').getByRole('checkbox')).toBeChecked()
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 2')
  for (const field of ['vikResult','rkResult','uzkResult','pvkResult','preVikResult','preRkResult','preUzkResult','prePvkResult']) {
    await revealLnkColumn(page,field)
    await expect(group(page,'LG-REPAIR').locator(`[data-group-summary="${field}"]`)).toHaveText('годен')
  }
  await revealLnkColumn(page,'rkResult')
  await expect(group(page,'LG-WAIT').locator('[data-group-summary="rkResult"]')).toContainText('ожидает НК')
  await expect(group(page,'LG-WAIT').locator('[data-group-summary="rkResult"] .journal-group-rejected')).toHaveText('не годен: 1')
  await expect(group(page,'LG-STAGES').locator('[data-group-summary="rkResult"]')).toHaveText('годен')
  await revealLnkColumn(page,'preRkResult')
  await expect(group(page,'LG-STAGES').locator('[data-group-summary="preRkResult"]')).toHaveText('не годен')
  await revealLnkColumn(page,'vikResult')
  await expect(group(page,'LG-ERROR').locator('[data-group-summary="vikResult"]')).toContainText('ошибка')
  await expect(group(page,'LG-CANCEL').locator('[data-group-summary="vikResult"]')).toHaveText('годен · назначение отменено')
  await page.screenshot({ path: info.outputPath('lnk-method-groups.png') })
})

test('ЛНК: фильтр выбирает записи, сохраняет скрытый физический корень и показывает неполноту', async ({ page }) => {
  await open(page,'S810001R1')
  await groupLines(page)
  const repair = group(page,'LG-REPAIR')
  await expect(repair.locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(repair.locator('[data-group-summary="wdi"]')).toHaveText('10')
  await revealLnkColumn(page,'rkResult')
  await expect(repair.locator('[data-group-summary="rkResult"]')).toHaveText('неполная цепочка')
  await page.locator('.ag-header-cell[col-id="rkResult"] .ag-header-cell-filter-button').click()
  await page.getByRole('dialog',{ name: 'Фильтр: Результат РК' }).getByRole('checkbox',{ name: /^годен\s/ }).check()
  await page.keyboard.press('Escape')
  await expect(repair.locator('[data-group-summary="rkResult"]')).toHaveText('неполная цепочка')
})

test('ЛНК: текущая версия и Excel используют видимые поля, порядок и независимые этапы без групп', async ({ page }) => {
  await open(page,'S810004')
  await revealLnkColumn(page, 'finalStatus')
  const status = (await lnkRow(page, 'S810004').locator('[col-id="finalStatus"]').innerText()).trim()
  await groupLines(page)
  await page.locator('header').getByRole('button',{ name:'Показать',exact:true }).click()
  await page.getByRole('button',{ name:'Текущая версия',exact:true }).click()
  const preview=page.getByRole('dialog',{name:'Предпросмотр отчёта',exact:true})
  const columns=fields.map(key=>WELD_FIELDS.find(field=>field.key===key)!.label)
  const values=['LG-STAGES','S810004',10,'годен','годен','годен','годен','годен','ремонт','годен','годен','MAIN-S810004','PRE-ВИК-S810004','','01.09.2026',status]
  await expect(preview.frameLocator('iframe').locator('thead th')).toHaveText(columns)
  await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(1)
  await expect(preview.frameLocator('iframe').locator('tbody td')).toHaveText(values.map(String))
  const downloading=page.waitForEvent('download')
  await preview.getByRole('button',{name:'Скачать Excel',exact:true}).click()
  const download=await downloading
  expect(await download.failure()).toBeNull()
  const workbook=XLSX.read(await readFile((await download.path())!),{type:'buffer'})
  expect(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:''})).toEqual([columns,values])
})

test('ЛНК: точные ссылки заявок основного и предварительного этапа открывают предпросмотр', async ({ page }) => {
  await open(page,'S810004')
  for (const [field,name] of [['vikRequest','MAIN-S810004'],['preVikRequest','PRE-ВИК-S810004']]) {
    await revealLnkColumn(page,field)
    await lnkRow(page,'S810004').getByRole('button',{name,exact:true}).click()
    const preview=page.getByRole('dialog',{name:'Предпросмотр документа',exact:true})
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('alert')).toHaveText('Шаблон системного документа не загружен.')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
  }
})

test('ЛНК: скрытие всех оставляет обязательные поля и доступные группы', async ({ page }) => {
  await open(page)
  await groupLines(page)
  await page.getByRole('button',{name:'Настроить вид',exact:true}).click()
  const panel=page.getByRole('dialog',{name:'Настройка вида ЛНК'})
  await panel.getByRole('button',{name:'Показать все',exact:true}).click()
  await panel.getByRole('button',{name:'Скрыть все',exact:true}).click()
  await panel.getByRole('button',{name:'Закрыть настройки вида'}).click()
  await expect(group(page,'LG-REPAIR').locator('[col-id="line"]')).toContainText('LG-REPAIR')
  const fields = await page.locator('[data-lnk-grid] .ag-header-cell[col-id]').evaluateAll(headers => headers.map(header => header.getAttribute('col-id')).filter(id => !id?.startsWith('ag-')).sort())
  expect(fields).toEqual(['line','joint','wdi','weldDate','finalStatus','__actions'].sort())
})

test('ЛНК: тема и личный вид независимы от журнала и ПСТО при переходах', async ({ page }) => {
  await open(page)
  await page.getByRole('button',{name:'Настроить вид',exact:true}).click()
  await page.getByRole('tab',{name:'Темы',exact:true}).click()
  await page.getByRole('radio',{name:/Нейтральная/}).click()
  await page.getByRole('tab',{name:'Мои виды',exact:true}).click()
  await page.getByLabel('Название вида').fill('ЛНК отдельный вид')
  await page.getByRole('button',{name:'Сохранить',exact:true}).click()
  await page.keyboard.press('Escape')
  for(const [label,report] of [['Сварочный журнал','weldingJournal'],['ПСТО и ТВМТ','heatTreatment']]){
    await page.getByRole('button',{name:label,exact:true}).click()
    await expect(page.locator(`[data-weld-report-grid="${report}"] .journal-theme-quartz`)).toBeVisible()
    await page.getByRole('button',{name:'Настроить вид',exact:true}).click()
    await page.getByRole('tab',{name:'Мои виды',exact:true}).click()
    await expect(page.getByRole('button',{name:/^ЛНК отдельный вид Фильтров/})).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  await page.getByRole('button',{name:'ЛНК',exact:true}).click()
  await expect(page.locator('[data-lnk-grid] .journal-theme-balham')).toBeVisible()
  await page.getByRole('button',{name:'Настроить вид',exact:true}).click()
  await page.getByRole('tab',{name:'Мои виды',exact:true}).click()
  await expect(page.getByRole('button',{name:/^ЛНК отдельный вид Фильтров/})).toBeVisible()
})
