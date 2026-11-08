import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcPayload, rpcName } from '../rpc'
import { openDocumentGridFilter } from '../document-grid'

const project = 'E2E document method count reuse'
const prefix = 'METHOD-COUNT-REUSE'

test.beforeAll(async () => {
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(db => db.query(`insert into weld_joints
    (project_title, subtitle_code, line, joint, weld_date, officiality, revision_actuality,
     has_rk, rk_conclusion, rk_conclusion_date, rk_result, has_uzk, uzk_conclusion, uzk_conclusion_date, uzk_result)
    values
    ($1,'MC','MC-A','MC1','2026-11-01','действующий','актуальная','да',$2||'-RK-1','2026-11-02','годен',null,null,null,null),
    ($1,'MC','MC-A','MC2','2026-11-01','действующий','актуальная',null,null,null,null,'да',$2||'-UZK-1','2026-11-02','годен'),
    ($1,'MC','MC-B','MC3','2026-11-01','действующий','актуальная',null,null,null,null,'да',$2||'-UZK-2','2026-11-02','годен')`, [project, prefix]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterAll(async () => { await cleanupLineProgramProjects([project]) })

test('LNK conclusion tabs reuse method counts while registry search and other filters change their scope', async ({ page }) => {
  const countReads: unknown[] = []
  page.on('request', request => {
    if (!request.url().includes('/_serverFn/') || !rpcName(request.url()).startsWith('listSystemDocumentHistoryFilterOptions')) return
    const serialized = request.postData() ?? new URL(request.url()).searchParams.get('payload')
    if (!serialized) return
    const { data } = deserializeRpcPayload(serialized) as { data: { fieldKey: string; type: string } }
    if (data.fieldKey === 'method' && data.type === 'lnkConclusion') countReads.push(data)
  })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  const grid = page.locator('[data-document-history-grid="system:lnkConclusion:lnk"]')
  const tabs = page.getByRole('tablist', { name: 'Вид заключения ЛНК' })
  const tab = (label: string) => tabs.getByRole('tab', { name: new RegExp(`^${label}(?:\\s|$)`) })
  const ready = async (count: number) => {
    await expect(grid.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible()
    await expect(grid.locator('.document-grid-frame')).not.toHaveAttribute('data-journal-updating', '')
    await page.waitForLoadState('networkidle')
  }
  await tab('Все').click()
  await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(prefix)
  await ready(3)
  await expect(tab('РК')).toHaveText(/РК\s*1/)
  await expect(tab('УЗК')).toHaveText(/УЗК\s*2/)
  const readsBeforeTabs = countReads.length
  expect(readsBeforeTabs).toBeGreaterThan(0)
  for (const [method, count, title] of [['РК', 1, '-RK-1'], ['УЗК', 2, '-UZK-1'], ['РК', 1, '-RK-1'], ['Все', 3, '-RK-1']] as const) {
    await tab(method).click()
    await ready(count)
    await expect(grid.getByRole('button', { name: `${prefix}${title}`, exact: true })).toBeVisible()
    await expect(tab('РК')).toHaveText(/РК\s*1/)
    await expect(tab('УЗК')).toHaveText(/УЗК\s*2/)
    expect(countReads).toHaveLength(readsBeforeTabs)
  }
  // A genuinely different facet scope must still read fresh counts.
  await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(`${prefix}-UZK`)
  await ready(2)
  await expect(tab('РК')).toHaveText(/РК\s*0/)
  await expect(tab('УЗК')).toHaveText(/УЗК\s*2/)
  expect(countReads).toHaveLength(readsBeforeTabs + 1)
  await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(prefix)
  await ready(3)
  const beforeLine = countReads.length
  const filter = await openDocumentGridFilter(page, 'line', 'Линия')
  await filter.getByRole('checkbox', { name: /MC-A/ }).check()
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await ready(2)
  await expect(tab('РК')).toHaveText(/РК\s*1/)
  await expect(tab('УЗК')).toHaveText(/УЗК\s*1/)
  expect(countReads).toHaveLength(beforeLine + 1)
})
