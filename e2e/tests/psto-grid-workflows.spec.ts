import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { captureProgramChainStates } from '../../src/lib/line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '../../src/lib/system-index-settings'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import { revealPstoColumn } from './psto-grid-helpers'
import { rpcName } from '../rpc'

const PROJECT = 'E2E PSTO grid workflows'
const fields = ['line', 'joint', 'wdi', 'pstoResult', 'tvmtResult', 'pstoRequest', 'pstoRequestDate']
const cases = [
  ['PGRID-REPAIR', 'S800001', 'repair'], ['PGRID-REPAIR', 'S800001R1', 'repair'], ['PGRID-REPAIR', 'S800001R2', 'good'],
  ['PGRID-REPEAT', 'S800002', 'repeat'],
  ['PGRID-WAIT', 'S800003', 'waiting'], ['PGRID-WAIT', 'S800004', 'bad'],
  ['PGRID-CANCEL', 'S800005', 'cancelled'],
  ['PGRID-ERROR', 'S800006', 'error'],
] as const

test.beforeAll(async () => {
  await withLineProgramFixture(async db => {
    const rows: WeldRow[] = []
    for (const [line, joint, state] of cases) {
      const pending = state === 'waiting'
      const cancelled = state === 'cancelled' || state === 'error'
      // PSTO intentionally includes only welded joints. Pending here means the
      // prerequisite pre-heat-treatment control, not an unwelded joint.
      const weldDate = '2026-09-01'
      const inserted = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi,connection_type,d1,t1,officiality,revision_actuality,
        has_vik,vik_request,vik_result,psto_required,psto_request,psto_request_date,psto_date,heat_treatment_diagram,psto_result,tvmt_request,tvmt_request_date,tvmt_conclusion_date,tvmt_conclusion,tvmt_result,psto_cancellation_date,psto_control_basis)
        values($1,'PGRID',$2,$3,$4,10,'С17',254,10,'действующий','актуальная','да','ВИК', $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
      [PROJECT, line, joint, weldDate, state === 'repair' ? 'ремонт' : pending ? null : 'годен', cancelled ? 'отменен' : 'да',
        pending ? null : `ПСТО-${joint}`, pending ? null : '2026-09-02', pending ? null : '2026-09-03', pending ? null : `ДИАГ-${joint}`,
        state === 'error' ? 'ошибка' : pending ? null : 'проведено', pending ? null : `ТВМТ-${joint}`, pending ? null : '2026-09-04', pending ? null : '2026-09-05', pending ? null : `ЗАКЛ-${joint}`,
        pending ? null : ['bad', 'repeat', 'cancelled'].includes(state) ? 'не годен' : 'годен', cancelled ? '2026-09-10' : null, cancelled ? 'E2E отмена' : null])
      const id = inserted.rows[0].id as number
      rows.push({ id, projectTitle: PROJECT, subtitleCode: 'PGRID', line, joint, weldDate, officiality: 'действующий' })
      if (state === 'repeat') await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,heat_treatment_diagram,psto_result,tvmt_request,tvmt_request_date,tvmt_conclusion_date,tvmt_conclusion,tvmt_result)
        values($1,2,'ПСТО-ТЕКУЩАЯ','2026-09-06','2026-09-07','ДИАГ-ТЕКУЩАЯ','проведено','ТВМТ-ТЕКУЩАЯ','2026-09-08','2026-09-09','ЗАКЛ-ТЕКУЩЕЕ','годен')`, [id])
    }
    for (const state of captureProgramChainStates(rows, DEFAULT_SYSTEM_INDEX_SETTINGS).values()) {
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side,replaced_by_coil,replacement_coil_ids)
        values($1,$2,$3,$4,$5,$6,$7,$8)`, [state.weldJointId,state.kind,state.physicalRootId,state.sourceRowId,state.coilParentId,state.coilSide,state.replacedByCoil,state.replacementCoilIds ?? []])
    }
  })
})
test.afterAll(async () => {
  await withLineProgramFixture(db => db.query(`delete from weld_joint_program_states s using weld_joints w
    where s.weld_joint_id=w.id and w.project_title=$1`, [PROJECT]))
  await cleanupLineProgramProjects([PROJECT])
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ fields, hidden }) => {
    localStorage.setItem('psto-ag-grid:v1', JSON.stringify({ columns: fields.map(colId => ({ colId, pinned: colId === 'line' || colId === 'joint' ? 'left' : null, width: colId === 'line' ? 200 : colId === 'joint' ? 140 : colId === 'wdi' ? 90 : 200 })) }))
    localStorage.setItem('welding-report-view:v1:heatTreatment', JSON.stringify({ activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
  }, { fields, hidden: WELD_FIELDS.filter(field => !fields.includes(field.key)).map(field => field.key) })
})
async function open(page: Page, search = PROJECT) {
  await page.goto('/psto')
  await page.getByRole('searchbox').fill(search)
  await expect(page.getByText(`Найдено: ${search === PROJECT ? 8 : 1}`, { exact: true })).toBeVisible()
  await expect(page.locator('[data-psto-grid] .ag-row:not(.ag-row-group)')).toHaveCount(search === PROJECT ? 8 : 1)
}
async function groupLines(page: Page) {
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
}
const group = (page: Page, line: string) => page.locator('.ag-row-group').filter({ has: page.getByRole('button', { name: new RegExp(`^(Развернуть|Свернуть) группу ${line}$`) }) })

test('ПСТО: физические группы, текущий повтор, ошибка и ожидание с отдельным браком', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await open(page)
  await groupLines(page)
  const repair = group(page, 'PGRID-REPAIR')
  await expect(repair.locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(repair.locator('[data-group-summary="pstoResult"]')).toHaveText('проведено')
  await expect(repair.locator('[data-group-summary="tvmtResult"]')).toHaveText('годен')
  await repair.getByRole('checkbox').click()
  await expect(repair.getByRole('checkbox')).toBeChecked()
  await expect(page.getByLabel('Статистика выделения')).toContainText('Выбрано: 3')
  await expect(group(page, 'PGRID-REPEAT').locator('[data-group-summary="tvmtResult"]')).toHaveText('годен')
  await expect(group(page, 'PGRID-CANCEL').locator('[data-group-summary="pstoResult"]')).toHaveText('проведено · назначение отменено')
  await expect(group(page, 'PGRID-CANCEL').locator('[data-group-summary="tvmtResult"]')).toHaveText('не годен')
  // Cancellation changes the row label, but must not erase a primary-cycle
  // error before the DTO reaches the physical group summary.
  await expect(group(page, 'PGRID-ERROR').locator('[data-group-summary="pstoResult"]')).toContainText('ошибка')
  await expect(group(page, 'PGRID-WAIT').locator('[data-group-summary="tvmtResult"]')).toContainText('ожидает заявку НК до ТО')
  await expect(group(page, 'PGRID-WAIT').locator('[data-group-summary="tvmtResult"] .journal-group-rejected')).toHaveText('не годен: 1')
  await page.screenshot({ path: info.outputPath('psto-stage-groups.png') })
  expect(errors).toEqual([])
})

test('ПСТО: фильтр текущего результата выбирает записи, а группам сохраняет физический корень', async ({ page }) => {
  await open(page)
  await groupLines(page)
  await page.locator('.ag-header-cell[col-id="tvmtResult"] .ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Результат ТВМТ' })
  await filter.getByRole('checkbox', { name: /^годен\s/ }).check()
  await page.keyboard.press('Escape')
  await expect(group(page, 'PGRID-REPEAT').locator('[data-group-summary="tvmtResult"]')).toHaveText('годен')
  await expect(group(page, 'PGRID-WAIT')).toHaveCount(0)
  await page.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button').click()
  await page.getByRole('dialog', { name: 'Фильтр: Стык' }).getByRole('checkbox', { name: /^S800001R2\s/ }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
  const repair = group(page, 'PGRID-REPAIR')
  await expect(repair.locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(repair.locator('[data-group-summary="wdi"]')).toHaveText('10')
  await expect(repair.locator('[data-group-summary="pstoResult"]')).toHaveText('неполная цепочка')
  await expect(repair.locator('[data-group-summary="tvmtResult"]')).toHaveText('неполная цепочка')
})

test('ПСТО: текущая версия и Excel повторяют видимые колонки и текущий цикл без групп', async ({ page }) => {
  await open(page, 'S800002')
  await expect(page.locator('.ag-row [col-id="tvmtResult"]')).toHaveText('годен')
  await revealPstoColumn(page, 'finalStatus')
  const finalStatus = (await page.locator('.ag-row [col-id="finalStatus"]').innerText()).trim()
  await groupLines(page)
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const expectedColumns = [...fields, 'weldDate', 'finalStatus'].map(key => WELD_FIELDS.find(field => field.key === key)!.label)
  const expectedRow = ['PGRID-REPEAT', 'S800002', 10, 'проведено', 'годен', 'ПСТО-ТЕКУЩАЯ', '06.09.2026', '01.09.2026', finalStatus]
  await expect(preview.frameLocator('iframe').locator('thead th')).toHaveText(expectedColumns)
  await expect(preview.frameLocator('iframe').locator('tbody tr')).toHaveCount(1)
  await expect(preview.frameLocator('iframe').locator('tbody td')).toHaveText(expectedRow.map(String))
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await downloading
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
  expect(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })).toEqual([expectedColumns, expectedRow])
  await page.keyboard.press('Escape')
  await expect(group(page, 'PGRID-REPEAT')).toBeVisible()
})

test('ПСТО: ссылка текущего цикла открывает его документ, а история остаётся отдельным действием', async ({ page }) => {
  await open(page, 'S800002')
  await revealPstoColumn(page, 'pstoRequest')
  await page.getByRole('button', { name: 'ПСТО-ТЕКУЩАЯ', exact: true }).click()
  const document = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  await expect(document).toBeVisible()
  // No template is installed for this synthetic report. A missing template is
  // explained inside the same native preview rather than blocking the link.
  await expect(document.getByRole('alert')).toHaveText('Шаблон системного документа не загружен.')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'S800002', exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'История циклов ПСТО/ТВМТ', exact: true }).click()
  const history = page.getByRole('dialog')
  const request = history.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Заявка ПСТО', exact: true }) })
  await expect(history.getByRole('tab', { name: 'Повтор #2', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(request.getByRole('textbox', { name: 'Наименование заявки', exact: true })).toHaveValue('ПСТО-ТЕКУЩАЯ')
  await history.getByRole('tab', { name: 'Основной цикл', exact: true }).click()
  await expect(request.getByRole('textbox', { name: 'Наименование заявки', exact: true })).toHaveValue('ПСТО-S800002')
})

test('ПСТО: скрытие всех сохраняет обязательные поля, группы и текущий экспорт', async ({ page }) => {
  await open(page)
  await groupLines(page)
  // Wait for the requested server grouping before measuring appearance-only traffic.
  await expect(group(page, 'PGRID-REPAIR')).toBeVisible()
  const calls: string[] = []
  await page.waitForLoadState('networkidle')
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Настройка вида ПСТО и ТВМТ' })
  await panel.getByRole('button', { name: 'Показать все', exact: true }).click()
  await panel.getByRole('button', { name: 'Скрыть все', exact: true }).click()
  await panel.getByRole('button', { name: 'Закрыть настройки вида' }).click()
  await expect(group(page, 'PGRID-REPAIR').locator('[col-id="line"]')).toContainText('PGRID-REPAIR')
  expect(calls.filter(name => /listFiltered|listHeatTreatmentReportPage|readJournalGrid/.test(name))).toEqual([])
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true }).frameLocator('iframe')
  await expect(preview.locator('thead th')).toHaveText(['Линия', 'Стык', 'WDI', 'Дата сварки', 'Итоговый статус'])
  await expect(preview.locator('tbody tr')).toHaveCount(8)
})
