import { expect, test, type Request, type Response } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName } from '../rpc'
import type { LnkWorkflowRowsRequest } from '../../src/server/weld-contracts'
import { createSmoothnessProbe } from '../smoothness-probe'

const project = 'E2E LNK result registry empty loaded page'
const line = 'LNK-EMPTY-LOADED-PAGE-20261113'
const targetJoint = 'F880501'
const baselineLabels = process.env.E2E_LNK_RESULT_LABELS_BASELINE === '1'

test.afterEach(() => cleanupLineProgramProjects([project]))

function registryRequest(request: Request): LnkWorkflowRowsRequest | undefined {
  if (!rpcName(request.url()).startsWith('listLnkWorkflowRows_')) return undefined
  const body = request.postData()
  return body ? (deserializeRpcPayload(body) as { data: LnkWorkflowRowsRequest }).data : undefined
}

type ResultRow = { id: number; joint: string; rkResult: string; uzkResult: string }
async function resultRows(response: Response) {
  expect(response.ok()).toBe(true)
  const payload = await deserializeRpcResponse(await response.text()) as { result?: ResultRow[]; error?: unknown }
  expect(payload.error).toBeUndefined()
  expect(Array.isArray(payload.result)).toBe(true)
  return payload.result!
}

test('a locally empty method/result filter keeps access to the next registry portion', async ({ page }, info) => {
  test.setTimeout(120000)
  const probe = process.env.LNK_LAYOUT_MEASURE === '1' ? await createSmoothnessProbe(page, info) : undefined
  const ids = await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number; joint: string }>(`insert into weld_joints(
        project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,
        connection_type,material_group,welding_method,d1,d2,t1,t2,wdi,lnk_created_at,
        has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,
        has_rk,rk_result,rk_request,rk_request_date,rk_conclusion,rk_conclusion_date,
        has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,final_status)
      select $1,'ELP',$2,'F'||(880000+n)::text,null,'актуальная',date '2026-09-01',
        'С17','M01','РД',108,108,4,4,0.42,timestamptz '2026-09-03T09:00:00Z',
        'да','годен','ELP-VIK','2026-09-01','ELP-VIK-C','2026-09-02',
        'да','ремонт','ELP-RK','2026-09-02','ELP-RK-C','2026-09-03',
        'да',case when n=501 then 'ремонт' else 'годен' end,'ELP-UZK','2026-09-02','ELP-UZK-C','2026-09-03','не годен'
      from generate_series(1,501) n returning id,joint`, [project, line])
    return rows.sort((a, b) => a.joint.localeCompare(b.joint)).map(row => row.id)
  })
  expect(ids).toHaveLength(501)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Все результаты ЛНК', exact: true })
  await expect(dialog).toBeVisible()
  const search = dialog.getByPlaceholder('Стык, линия, заявка или заключение')
  const method = dialog.getByLabel('Вид контроля в реестре')
  const loadMore = dialog.getByRole('button', { name: 'Загрузить ещё результаты', exact: true })
  const nextRead = (limit: number, resultFilter?: string) => page.waitForResponse(response => {
    const data = registryRequest(response.request())
    return data?.scope === 'resultRegistry' && data.rowIds === null && data.search === line
      && data.limit === limit && data.resultFilter === resultFilter
  })

  // Server search isolates our 501 rows even on the owned 200k background.
  // Equal lnkCreatedAt and fixed-width joint numbers place the repair at 501.
  const firstRead = nextRead(500)
  await search.fill(line)
  const firstRows = await resultRows(await firstRead)
  expect(firstRows.map(row => row.id)).toEqual(ids.slice(0, 500))
  await expect(dialog.getByText(baselineLabels ? 'Стыков в области: 500' : 'Загружено стыков: 500', { exact: true })).toBeVisible()
  if (!baselineLabels) await expect(search).toHaveAttribute('title', 'Поиск и фильтр результата отбирают стыки во всём реестре.')
  if (!baselineLabels) await expect(method).toHaveAttribute('aria-description', 'Вид контроля применяется к загруженной части.')
  await method.selectOption('uzkRequest')
  await expect(method).toHaveValue('uzkRequest')
  await expect(loadMore).toBeVisible()
  if (probe) {
    for (const width of [1600, 900]) {
      await page.setViewportSize({ width, height: 1000 })
      await probe.scroll(`lnk-registry-${width}`, dialog.locator('aside [data-index]').first())
    }
    await probe.finish()
    await page.setViewportSize({ width: 1600, height: 1000 })
  }

  // The result predicate matches all 501 via RK=repair. UZK=good keeps UZK
  // available in the first portion, so the method-reset effect cannot clear it.
  // The local UZK + repair intersection is empty until the next portion loads.
  const filteredRead = nextRead(500, 'ремонт')
  await dialog.getByRole('group', { name: 'Фильтр результатов', exact: true })
    .getByRole('button', { name: 'ремонт', exact: true }).click()
  const response = await filteredRead
  const filteredRows = await resultRows(response)
  expect(filteredRows.map(row => row.id)).toEqual(ids.slice(0, 500))
  expect(filteredRows.every(row => row.rkResult === 'ремонт' && row.uzkResult === 'годен')).toBe(true)
  await expect(method).toHaveValue('uzkRequest')
  await expect(dialog.getByText(baselineLabels ? 'Найдено: 0' : 'Результатов в загруженной части: 0', { exact: true })).toBeVisible()
  await expect(dialog.getByText(baselineLabels ? 'Стыков в области: 500' : 'Загружено стыков: 500', { exact: true })).toBeVisible()
  await expect(dialog.getByText(baselineLabels ? 'По заданным условиям результаты не найдены.' : 'В загруженной части нет подходящих результатов. Загрузите ещё или уточните поиск.', { exact: true })).toBeVisible()
  await writeFile(info.outputPath('empty-loaded-portion.json'), JSON.stringify({
    fixture: { project, line, count: 501, targetId: ids[500], targetJoint },
    request: registryRequest(response.request()), selectedMethod: await method.inputValue(),
    loadedRows: filteredRows.map(({ id, joint, rkResult, uzkResult }) => ({ id, joint, rkResult, uzkResult })),
    loadMoreVisible: await loadMore.isVisible(),
  }, null, 2))
  await page.screenshot({ path: info.outputPath('empty-loaded-portion.png') })
  await page.setViewportSize({ width: 900, height: 1000 })
  await expect(search).toBeInViewport()
  await expect(loadMore).toBeInViewport()
  await page.screenshot({ path: info.outputPath('empty-loaded-portion-900.png') })

  // Acceptance: an empty local intersection must not remove the control that
  // loads existing results beyond the first portion. Keep the filter intact.
  await expect(loadMore).toBeVisible({ timeout: 5000 })
  const moreRead = nextRead(1000, 'ремонт')
  await loadMore.click()
  const allRows = await resultRows(await moreRead)
  expect(allRows.map(row => row.id)).toEqual(ids)
  expect(allRows.at(-1)).toMatchObject({ id: ids[500], joint: targetJoint, uzkResult: 'ремонт' })
  await expect(method).toHaveValue('uzkRequest')
  await expect(dialog.getByText(baselineLabels ? 'Найдено: 1' : 'Результатов в загруженной части: 1', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: new RegExp(`^${line} · ${targetJoint}(?:\\s|$)`) })).toBeVisible()
  await expect(loadMore).toBeHidden()
  const geometry = await dialog.getByRole('button', { name: new RegExp(`^${line} · ${targetJoint}(?:\\s|$)`) }).evaluate(element => {
    const rect = (node: Element) => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    const ancestors = []; let parent = element.parentElement
    while (parent && parent.tagName !== 'ASIDE') { ancestors.push({ tag: parent.tagName, className: parent.className, ...rect(parent) }); parent = parent.parentElement }
    return { row: rect(element), aside: rect(element.closest('aside')!), ancestors, centerReachesRow: hit === element || element.contains(hit) }
  })
  await writeFile(info.outputPath('narrow-list-geometry.json'), JSON.stringify({ baselineLabels, geometry }, null, 2))
  await page.screenshot({ path: info.outputPath('loaded-result-900.png') })
  expect(geometry.centerReachesRow, 'The selected result must not be clipped by its card').toBe(true)
  for (const viewport of [{ width: 900, height: 700 }, { width: 720, height: 600 }, { width: 1600, height: 1000 }]) {
    await page.setViewportSize(viewport)
    const entry = dialog.getByRole('button', { name: new RegExp(`^${line} · ${targetJoint}(?:\\s|$)`) })
    await entry.scrollIntoViewIfNeeded()
    await entry.click({ timeout: 3000 })
    const card = dialog.locator('main')
    // The registry opens in view mode; each result block now owns its editor
    // and save action instead of exposing a permanently editable global footer.
    if (!baselineLabels) {
      const edit = card.getByRole('button', { name: 'Редактировать', exact: true })
      if (await edit.isVisible()) await edit.click()
      await expect(card.getByRole('button', { name: 'Свернуть редактирование', exact: true })).toBeVisible()
    }
    const remove = card.getByRole('button', { name: 'Удалить результат', exact: true })
    await remove.scrollIntoViewIfNeeded()
    await expect(remove).toBeInViewport()
    const save = (baselineLabels ? dialog : card).getByRole('button', { name: 'Сохранить изменения', exact: true })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeInViewport()
    await search.scrollIntoViewIfNeeded()
    await search.click()
    await expect(search).toBeFocused()
    await expect(method).toHaveValue('uzkRequest')
    await page.screenshot({ path: info.outputPath(`loaded-result-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: info.outputPath('loaded-result-1600.png') })
  expect(errors).toEqual([])
})
