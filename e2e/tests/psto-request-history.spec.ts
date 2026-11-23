import { requireDb } from '@/db'
import { rebuildSystemDocumentIndexInTransaction } from '@/server/system-document-index'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName } from '../rpc'
import { WORKFLOW_REGISTRY_PAGE_SIZE } from '../../src/server/weld-contracts'

const project = 'E2E request-only PSTO history'
const size = WORKFLOW_REGISTRY_PAGE_SIZE

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
})

test('history searches beyond its first batch and keeps unperformed primary/repeat requests', async ({ page }, info) => {
  const rows = await withLineProgramFixture(async db => {
    const result = await db.query(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,psto_required,psto_request,psto_request_date)
      select $1,'HISTORY','HISTORY-L','F89'||lpad(n::text,5,'0'),'2026-09-01','С17','действующий','актуальная',
        case when n=$2+2 then null when n=$2+3 then 'отменен' else 'да' end,
        case when n in ($2+2,$2+4) then null else 'HISTORY-REQ-'||lpad(n::text,5,'0') end,
        case when n in ($2+2,$2+4) then null else '2026-09-02'::date end
      from generate_series(1,$2::int+4) n returning id,joint,psto_request`, [project, size])
    const repeat = result.rows[size + 1]
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date)
      values($1,2,'HISTORY-REPEAT-ONLY','2026-09-03')`, [repeat.id])
    return result.rows as Array<{ id: number; joint: string; psto_request: string | null }>
  })
  // Direct SQL fixtures bypass the normal document creation workflow. Populate
  // the disposable registry before checking its independent document pages.
  await requireDb().transaction(tx => rebuildSystemDocumentIndexInTransaction(tx, 'pstoRequest'))
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const name = rpcName(request.url())
    if (name.startsWith('listPstoWorkflowRows_')) calls.push(name)
  })
  const loaded = (search = '', limit = size) => page.waitForResponse(response => {
    if (!rpcName(response.url()).startsWith('listPstoWorkflowRows_')) return false
    const data = (deserializeRpcPayload(response.request().postData()!) as { data: { scope: string; search?: string; limit?: number } }).data
    return data.scope === 'resultRegistry' && (data.search ?? '') === search && data.limit === limit
  }).then(async response => (await deserializeRpcResponse(await response.text()) as { result: Array<{ id: number }> }).result)

  await page.goto('/psto')
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  const initial = loaded()
  await page.getByRole('button', { name: 'История ПСТО и ТВМТ', exact: true }).click()
  const batch = await initial
  expect(batch).toHaveLength(size)
  const history = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'История ПСТО и ТВМТ', exact: true }) })
  await expect(history.getByText(`Стыков в области: ${size}`, { exact: true })).toBeVisible()
  const outside = rows.find(row => row.psto_request && !batch.some(item => item.id === row.id))!
  expect(outside).toBeTruthy()
  const search = history.getByPlaceholder('Стык, линия или документ')
  const foundOutside = loaded(outside.psto_request!)
  await search.fill(outside.psto_request!)
  expect((await foundOutside).map(row => row.id)).toEqual([outside.id])
  await expect(history.getByText(outside.psto_request!, { exact: true }).last()).toBeVisible()
  await expect(history.getByRole('textbox', { name: 'Наименование заявки только этого стыка', exact: true })).toHaveCount(0)

  await search.clear()
  await expect(history.getByText(`Стыков в области: ${size}`, { exact: true })).toBeVisible()
  const more = loaded('', size * 2)
  await history.getByRole('button', { name: 'Загрузить ещё стыки', exact: true }).click()
  const all = await more
  expect(all.map(row => row.id).sort((a, b) => a - b)).toEqual(rows.slice(0, -1).map(row => row.id).sort((a, b) => a - b))
  await expect(history.getByText(`Стыков в области: ${size + 3}`, { exact: true })).toBeVisible()

  const repeat = loaded('HISTORY-REPEAT-ONLY')
  await search.fill('HISTORY-REPEAT-ONLY')
  expect((await repeat).map(row => row.id)).toEqual([rows[size + 1].id])
  await expect(history.getByRole('tab', { name: 'Повтор #2', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(history.getByText('HISTORY-REPEAT-ONLY', { exact: true }).last()).toBeVisible()
  await history.screenshot({ path: info.outputPath('request-without-result.png') })
  expect(calls.length).toBeLessThanOrEqual(6)
  expect(errors).toEqual([])
  // The Documents tab searches the full document registry, independently of
  // the last joint search (which currently contains only the repeat request).
  const documentReads: Array<{ startRow: number; endRow: number; search?: string }> = []
  page.on('request', request => {
    if (rpcName(request.url()).startsWith('listWorkflowDocumentHistoryGrid_')) documentReads.push((deserializeRpcPayload(request.postData()!) as { data: { startRow: number; endRow: number; search?: string } }).data)
  })
  await history.getByRole('tab', { name: 'Документы', exact: true }).click()
  const documents = history.getByRole('tabpanel', { name: 'Документы', exact: true })
  await expect(documents.getByRole('button', { name: 'Следующая страница документов' })).toBeEnabled()
  await documents.getByPlaceholder('Поиск документов').fill(outside.psto_request!)
  await expect(documents.getByRole('complementary').getByRole('button', { name: new RegExp(outside.psto_request!) })).toBeVisible()
  await documents.getByRole('complementary').getByRole('button', { name: new RegExp(outside.psto_request!) }).click()
  await expect(documents.getByRole('region', { name: 'Полный состав документа' })).toContainText(outside.joint)
  expect(documentReads.length).toBeGreaterThan(0)
  expect(documentReads.length).toBeLessThanOrEqual(2)
  expect(documentReads.every(request => request.endRow - request.startRow === 50)).toBe(true)
  expect(errors).toEqual([])
  // Viewing history must not manufacture a result or a date of execution.
  const facts = await withE2eDatabase(async db => (await db.query(`select count(*)::int as executed from weld_joints
    where project_title=$1 and (psto_date is not null or heat_treatment_diagram is not null or psto_result in ('проведено','да'))`, [project])).rows[0])
  expect(facts.executed).toBe(0)
})
