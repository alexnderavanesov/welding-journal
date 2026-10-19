import { expect, test, type Page } from '@playwright/test'
import { rpcName } from '../rpc'
import { captureProgramChainStates } from '../../src/lib/line-program-chain-state'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '../../src/lib/system-index-settings'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import type { WeldRow } from '../../src/lib/dispatcher-types'

const PROJECT = 'E2E group summaries'
let savedOther: string | undefined
const cases = [
  ['SUMMARY-REPAIR', [['S1', 'годен', 5], ['S2', 'ремонт', 8], ['S2R1', 'ремонт', 99], ['S2R2', 'годен', 99]]],
  ['SUMMARY-COIL', [['S1', 'годен', 5], ['S2', 'ремонт', 8], ['S2R1', 'ремонт', 99], ['S2R2', 'ремонт', 99], ['S2R3', 'вырез', 99], ['S2R3W1', 'вырез', 99], ['S2Y1', 'годен', 7], ['S2Y2', 'годен', 9]]],
  ['SUMMARY-WELD', [['S1', 'годен', 5], ['S2', 'weld', 8], ['S3', 'ремонт', 10], ['S4', 'nk', 12]]],
  ['SUMMARY-REQUEST', [['S1', 'годен', 5], ['S2', 'request', 8], ['S3', 'ремонт', 10], ['S4', 'nk', 12]]],
  ['SUMMARY-NK', [['S1', 'годен', 5], ['S2', 'nk', 8], ['S3', 'ремонт', 10]]],
  ['SUMMARY-ERROR', [['S1', 'error', 5], ['S2', 'weld', 8]]],
] as const

test.beforeAll(async () => {
  await withLineProgramFixture(async db => {
    savedOther = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query("insert into app_settings(key,value) values('other',$1) on conflict(key) do update set value=excluded.value", [JSON.stringify({ wdiCalculationMode: 'manual' })])
    const rows: WeldRow[] = []
    for (const [line, joints] of cases) for (const [i, [joint, result, wdi]] of joints.entries()) {
      const weldDate = result === 'weld' ? null : `2026-09-${String(i + 1).padStart(2, '0')}`
      // VIK is assigned automatically. Use a factual RK result without RK assignment
      // to exercise the real error state rather than an automatically repaired fixture.
      const inserted = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi,has_vik,vik_result,vik_request,rk_result,officiality,revision_actuality,connection_type)
        values($1,'GROUP',$2,$3,$4,$5,$6,$7,$8,$9,'действующий','актуальная','С17') returning id`,
      [PROJECT, line, joint, weldDate, wdi, 'да',
        result === 'error' ? 'годен' : ['годен', 'ремонт', 'вырез'].includes(result) ? result : null,
        result === 'request' || result === 'weld' ? null : `ВИК ${line} ${joint}`, result === 'error' ? 'годен' : null])
      rows.push({ id: inserted.rows[0].id, projectTitle: PROJECT, subtitleCode: 'GROUP', line, joint, weldDate, officiality: 'действующий' })
    }
    for (const state of captureProgramChainStates(rows, DEFAULT_SYSTEM_INDEX_SETTINGS).values()) {
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side,replaced_by_coil,replacement_coil_ids)
        values($1,$2,$3,$4,$5,$6,$7,$8)`, [state.weldJointId, state.kind, state.physicalRootId, state.sourceRowId, state.coilParentId, state.coilSide, state.replacedByCoil, state.replacementCoilIds ?? []])
    }
  })
})
test.afterAll(async () => {
  await cleanupLineProgramProjects([PROJECT])
  await withLineProgramFixture(async db => {
    if (savedOther === undefined) await db.query("delete from app_settings where key='other'")
    else await db.query("update app_settings set value=$1 where key='other'", [savedOther])
  })
})
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('welding-journal-ag-grid:v1', JSON.stringify({
    columns: ['line', 'joint', 'projectTitle', 'subtitleCode', 'wdi', 'weldDate', 'finalStatus'].map(colId => ({ colId, width: colId === 'line' ? 220 : colId === 'projectTitle' ? 200 : colId === 'weldDate' ? 170 : colId === 'finalStatus' ? 180 : 100, pinned: colId === 'line' || colId === 'joint' ? 'left' : colId === 'finalStatus' ? 'right' : null })),
  })))
})
async function open(page: Page, search = PROJECT) {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(search)
  await expect(page.getByText(`Загружено: ${search === PROJECT ? 25 : 1} из ${search === PROJECT ? 25 : 1}`, { exact: true })).toBeVisible()
  await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сгруппировать загруженные по «Линия»', exact: true }).click()
}
const group = (page: Page, line: string) => page.locator('.ag-row-group').filter({ has: page.getByRole('button', { name: new RegExp(`^(Развернуть|Свернуть) группу ${line}$`) }) })

test('physical totals, dates and chain results stay in their columns; error takes priority', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await open(page)
  const expectations = [
    ['SUMMARY-REPAIR', '2', '13', 'годен'], ['SUMMARY-COIL', '3', '21', 'годен'],
    ['SUMMARY-WELD', '4', '35', 'ожидает сварку'], ['SUMMARY-REQUEST', '4', '35', 'ожидает заявку'],
    ['SUMMARY-NK', '3', '23', 'ожидает НК'], ['SUMMARY-ERROR', '2', '13', 'ошибка'],
  ]
  for (const [line, count, wdi, status] of expectations) {
    const target = group(page, line)
    await expect(target.locator('[data-group-summary="joint"]')).toHaveText(count)
    await expect(target.locator('[data-group-summary="wdi"]')).toHaveText(wdi)
    await expect(target.locator('[data-group-summary="finalStatus"]')).toContainText(status)
    await expect(target.locator('[data-group-summary="projectTitle"]')).toHaveText(PROJECT)
    await expect(target.locator('[data-group-summary="subtitleCode"]')).toHaveText('GROUP')
  }
  await expect(group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="weldDate"]')).toHaveText('01.09.2026 — 04.09.2026')
  for (const line of ['SUMMARY-WELD', 'SUMMARY-REQUEST', 'SUMMARY-NK']) await expect(group(page, line).locator('.journal-group-rejected')).toHaveText('не годен: 1')
  await expect(group(page, 'SUMMARY-REPAIR').locator('.journal-group-rejected')).toHaveCount(0)
  const resize = page.locator('.ag-header-cell[col-id="wdi"] .ag-header-cell-resize')
  const box = (await resize.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 20, { steps: 10 }); await page.mouse.up()
  const header = (await page.locator('.ag-header-cell[col-id="wdi"]').boundingBox())!
  const cell = (await group(page, 'SUMMARY-REPAIR').locator('[col-id="wdi"]').boundingBox())!
  expect(Math.abs(header.x - cell.x)).toBeLessThan(1)
  expect(Math.abs(header.width - cell.width)).toBeLessThan(1)
  const alignment = await group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="wdi"]').evaluate(el => ({
    textOffset: el.querySelector('span')!.getBoundingClientRect().left - el.getBoundingClientRect().left,
    alignment: getComputedStyle(el).justifyContent,
  }))
  expect(alignment.alignment).toBe('flex-start')
  expect(alignment.textOffset).toBeLessThan(1)
  await page.screenshot({ path: info.outputPath('group-summaries.png') })
  expect(errors).toEqual([])
})

test('nested totals deduplicate physical connections; selection, keyboard and repeated toggles send no RPC', async ({ page }) => {
  const calls: string[] = []
  page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
  await open(page)
  const target = group(page, 'SUMMARY-REPAIR')
  await page.waitForLoadState('networkidle')
  const before = calls.length
  for (let i = 0; i < 10; i++) {
    await target.getByRole('button', { name: 'Развернуть группу SUMMARY-REPAIR' }).click()
    await expect(target.getByRole('button', { name: 'Свернуть группу SUMMARY-REPAIR' })).toBeVisible()
    await target.locator('[col-id="line"]').press('F2')
    await expect(target.getByRole('button', { name: 'Развернуть группу SUMMARY-REPAIR' })).toBeVisible()
  }
  await target.getByRole('checkbox').check()
  await expect(page.getByText('Выбрано: 4', { exact: true })).toBeVisible()
  await expect(target.locator('[data-group-summary="joint"]')).toHaveText('2')
  await page.locator('.ag-header-cell[col-id="projectTitle"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Сгруппировать загруженные по «Проект»', exact: true }).click()
  await page.getByRole('button', { name: 'Группировка: Проект', exact: true }).press('Alt+ArrowLeft')
  const root = page.locator('.ag-row-group.ag-row-level-0')
  await expect(root.locator('[data-group-summary="joint"]')).toHaveText('18')
  await expect(root.locator('[data-group-summary="wdi"]')).toHaveText('140')
  await expect(root.locator('[data-group-summary="finalStatus"]')).toContainText('ошибка')
  await expect(root.getByRole('checkbox')).toBeChecked({ indeterminate: true })
  await root.locator('[col-id="line"]').press('Enter')
  await expect(target.getByRole('checkbox')).toBeChecked()
  await page.waitForLoadState('networkidle')
  expect(calls.slice(before)).toEqual([])
})

test('filtering to the last repair keeps physical WDI but does not claim a complete chain', async ({ page }) => {
  await open(page)
  await page.locator('.ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  await page.getByRole('dialog', { name: 'Фильтр: Линия' }).getByRole('checkbox', { name: /SUMMARY-REPAIR/ }).check()
  await page.keyboard.press('Escape')
  await page.locator('.ag-header-cell[col-id="joint"] .ag-header-cell-filter-button').click()
  await page.getByRole('dialog', { name: 'Фильтр: Стык' }).getByRole('checkbox', { name: /^S2R2/ }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Загружено: 1 из 1', { exact: true })).toBeVisible()
  await expect(group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="wdi"]')).toHaveText('8')
  await expect(group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="finalStatus"]')).toHaveText('неполная цепочка')
})

test('rejected filter selects joint records regardless of the previous group result', async ({ page }) => {
  await open(page)
  await expect(group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="finalStatus"]')).toHaveText('годен')
  const filter = page.getByRole('dialog', { name: 'Фильтр: Итоговый статус' })
  await page.locator('.ag-header-cell[col-id="finalStatus"] .ag-header-cell-filter-button').click()
  await filter.getByRole('checkbox', { name: /^не годен\s+10$/ }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Загружено: 10 из 10', { exact: true })).toBeVisible()
  for (const line of ['SUMMARY-REPAIR', 'SUMMARY-COIL', 'SUMMARY-WELD', 'SUMMARY-REQUEST', 'SUMMARY-NK']) {
    const target = group(page, line)
    await expect(target.locator('[data-group-summary="finalStatus"]')).toHaveText(line === 'SUMMARY-COIL' ? 'заменены катушкой' : 'не годен')
    await target.getByRole('button', { name: `Развернуть группу ${line}` }).click()
  }
  // Ten rejected journal records remain, including the old cut-out connection.
  // Its zero physical count must never make its historical records disappear.
  const leaves = page.locator('.ag-row:not(.ag-row-group) [col-id="finalStatus"]')
  await expect(leaves).toHaveCount(10)
  for (const cell of await leaves.all()) await expect(cell).toHaveText('не годен')
  await expect(group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="joint"]')).toHaveText('1')
  await expect(group(page, 'SUMMARY-COIL').locator('[data-group-summary="joint"]')).toHaveText('0')
  await page.locator('.ag-header-cell[col-id="finalStatus"] .ag-header-cell-filter-button').click()
  await filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Загружено: 25 из 25', { exact: true })).toBeVisible()
  await expect(group(page, 'SUMMARY-REPAIR').locator('[data-group-summary="finalStatus"]')).toHaveText('годен')
})

test('groups remain named and expandable when the view hides all data columns', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Настройка вида журнала' })
  for (const checkbox of await panel.getByRole('checkbox', { name: /^Раздел:/ }).all()) await checkbox.uncheck()
  await panel.getByRole('button', { name: 'Закрыть настройки вида' }).click()
  const target = group(page, 'SUMMARY-REPAIR')
  await expect(target.locator('[col-id="__groupLabel"]')).toContainText('SUMMARY-REPAIR')
  await target.getByRole('button', { name: 'Развернуть группу SUMMARY-REPAIR' }).click()
  await expect(target.getByRole('button', { name: 'Свернуть группу SUMMARY-REPAIR' })).toBeVisible()
  await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await panel.getByRole('button', { name: 'Показать все', exact: true }).click()
  await panel.getByRole('button', { name: 'Закрыть настройки вида' }).click()
  await expect(page.locator('.ag-header-cell[col-id="__groupLabel"]')).toHaveCount(0)
  await expect(target.locator('[col-id="line"]')).toContainText('SUMMARY-REPAIR')
  await expect(target.locator('[data-group-summary="joint"]')).toHaveText('2')
})
