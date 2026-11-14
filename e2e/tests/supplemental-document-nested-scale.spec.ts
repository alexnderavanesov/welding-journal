import { expect, test, type Locator, type Page, type Request, type Response } from '@playwright/test'
import { copyFile, writeFile } from 'node:fs/promises'
import { EXTRA_DOCUMENT_PROJECT, seedExtraDocumentBackground, growExtraDocumentRegistries } from '../supplemental-documents-scale-fixture'
import { openDocumentGridColumnMenu } from '../document-grid'
import { createSmoothnessProbe } from '../smoothness-probe'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName } from '../rpc'
import { isDocumentHistoryGroupRow, type DocumentHistoryGridRequest, type DocumentHistoryGridResult } from '../../src/lib/document-history-grid'

test.skip(process.env.SUPPLEMENTAL_DOCUMENT_NESTED_SCALE !== '1', 'Standalone four-registry nested groups on the owned 200k fixture')
test.use({ trace: 'off', video: 'off', actionTimeout: 30000 })

type GridRequest = DocumentHistoryGridRequest & { types?: string[] }
type DocumentRow = { id: number; title: string }
function gridRequest(request: Request): GridRequest | null {
  if (!rpcName(request.url()).includes('GeneratedDocumentHistoryGrid')) return null
  const body = request.postData() ?? new URL(request.url()).searchParams.get('payload')
  return body ? (deserializeRpcPayload(body) as { data: GridRequest }).data : null
}
const isBlock = (request: GridRequest) => !request.idsOnly && !request.cells && !request.countRoutes && !request.selectionOnly
const key = (value: string) => JSON.stringify(['value', value])
const columns = ['project', 'subtitle']
const parentRoute = [key(EXTRA_DOCUMENT_PROJECT)]
const leafRoute = [...parentRoute, key('XDS')]

async function result(response: Response) {
  expect(response.ok()).toBe(true)
  const payload = await deserializeRpcResponse(await response.text()) as { result?: DocumentHistoryGridResult<DocumentRow>; error?: unknown }
  expect(payload.error).toBeUndefined()
  expect(payload.result).toBeDefined()
  return payload.result!
}
async function settled(page: Page, grid: Locator, count: number) {
  await expect(grid.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible({ timeout: 60000 })
  await expect(grid.locator('.document-grid-frame')).not.toHaveAttribute('data-journal-updating', '')
  await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
  await expect(grid.locator('[role="alert"]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

test('four additional registries: expanded two-level groups, exact deep blocks and selection after collapse at 1k/5k', async ({ browser }, info) => {
  test.setTimeout(1200000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS_FILE).toBeTruthy()
  await seedExtraDocumentBackground()
  const observations: unknown[] = [], manifests: unknown[] = []
  let previous = 0
  for (const count of [1000, 5000] as const) {
    const fixture = await growExtraDocumentRegistries(previous, count)
    previous = count
    manifests.push({ countPerRegistry: count, expected: fixture.expected, actual: fixture.actual })
    await writeFile(info.outputPath('nested-fixture-manifests.json'), JSON.stringify(manifests, null, 2))
    const context = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL,
      viewport: { width: 1600, height: 1000 } })
    const page = await context.newPage(), probe = await createSmoothnessProbe(page, info)
    const requests: GridRequest[] = []
    page.on('request', request => { const data = gridRequest(request); if (data) requests.push(data) })
    try {
      for (const profile of fixture.profiles) {
        const grid = page.locator(`[data-document-history-grid="generated:${profile.types.join('+')}"]`)
        const first = grid.locator(`.ag-row[row-id="document:${profile.rows[0].id}"]`)
        const last = grid.locator(`.ag-row[row-id="document:${profile.rows.at(-1)!.id}"]`)
        const parent = grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: EXTRA_DOCUMENT_PROJECT })
        const child = grid.locator('.ag-full-width-row.ag-row-group').filter({
          has: page.getByRole('checkbox', { name: 'Выбрать все документы группы XDS', exact: true }),
        })
        const childCheckbox = child.getByRole('checkbox', { name: 'Выбрать все документы группы XDS', exact: true })
        const parentCheckbox = parent.getByRole('checkbox', { name: `Выбрать все документы группы ${EXTRA_DOCUMENT_PROJECT}`, exact: true })
        const expectedIds = profile.rows.map(row => row.id).sort((a, b) => a - b)
        const expectedCards = (rows: typeof profile.rows) => rows.map(({ id, title }) => ({ id, title }))
        const assertCards = (payload: DocumentHistoryGridResult<DocumentRow>, rows: typeof profile.rows) => {
          expect(payload.rowCount).toBe(count)
          expect(payload.total).toBe(count)
          expect(payload.rows.every(row => !isDocumentHistoryGroupRow(row))).toBe(true)
          expect(payload.rows.map(({ id, title }) => ({ id, title }))).toEqual(expectedCards(rows))
          observations.push({ count, profile: profile.id, phase: 'asserted-leaf-block',
            rowCount: payload.rowCount, total: payload.total, cards: payload.rows.map(({ id, title }) => ({ id, title })) })
        }
        const nextRead = (route: string[], start: number, idsOnly = false) => page.waitForResponse(response => {
          const data = gridRequest(response.request())
          return Boolean(data && JSON.stringify(data.types) === JSON.stringify(profile.types)
            && JSON.stringify(data.rowGroupCols) === JSON.stringify(columns)
            && JSON.stringify(data.groupKeys) === JSON.stringify(route)
            && (idsOnly ? data.idsOnly : isBlock(data) && data.startRow === start))
        })
        const selectedIds = () => page.evaluate(types => {
          const suffix = `welding-journal:documents:session:v1:generated:${types.join('+')}`
          const storageKey = Object.keys(sessionStorage).find(value => value.endsWith(suffix))
          if (!storageKey) return []
          const state = JSON.parse(sessionStorage.getItem(storageKey)!) as { selectedDocumentIds?: Array<string | number> }
          return (state.selectedDocumentIds ?? []).map(Number).sort((a, b) => a - b)
        }, [...profile.types])
        const sample = (name: string, run: () => Promise<unknown>) => probe.measure(`${profile.id}:${name}`, run)
        const assertVirtualized = async (phase: string) => {
          const mountedIds = await grid.locator('.ag-row[row-id^="document:"]').evaluateAll(rows =>
            rows.map(row => Number(row.getAttribute('row-id')!.slice('document:'.length))))
          expect(mountedIds.length).toBeGreaterThan(0)
          expect(mountedIds.length).toBeLessThanOrEqual(100)
          expect(new Set(mountedIds).size).toBe(mountedIds.length)
          expect(mountedIds.every(id => expectedIds.includes(id))).toBe(true)
          observations.push({ count, profile: profile.id, phase, mountedIds })
        }
        const top = async () => {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
          await expect(parent).toBeVisible()
        }
        const end = async () => {
          await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
          await expect(last.locator('[col-id="title"] button')).toHaveText(profile.rows.at(-1)!.title, { timeout: 60000 })
          await settled(page, grid, count)
        }
        await sample('open-and-group', async () => {
          await page.goto('/documents')
          await page.getByRole('button', { name: profile.label, exact: true }).click()
          await settled(page, grid, count)
          await openDocumentGridColumnMenu(page, 'title')
          await page.getByRole('menuitem', { name: 'По возрастанию', exact: true }).click()
          await settled(page, grid, count)
          for (const [field, label] of [['project', 'Проект'], ['subtitle', 'Шифр']]) {
            await openDocumentGridColumnMenu(page, field)
            await page.getByRole('menuitem', { name: `Сгруппировать по «${label}»`, exact: true }).click()
            await settled(page, grid, count)
          }
          await expect(parentCheckbox).toHaveAttribute('title', `Все документы группы: ${count}, включая незагруженные`)
        })
        await sample('expand-parent', async () => {
          const read = nextRead(parentRoute, 0)
          await parent.focus(); await parent.press('Enter')
          const payload = await result(await read)
          expect(payload.total).toBe(count)
          expect(payload.rowCount).toBe(1)
          expect(payload.rows).toHaveLength(1)
          expect(payload.rows[0]).toMatchObject({ __group: true, groupKey: key('XDS'), groupLabel: 'XDS', childCount: count })
          observations.push({ count, profile: profile.id, phase: 'asserted-child-group', groups: payload.rows })
          await expect(childCheckbox).toHaveAttribute('title', `Все документы группы: ${count}, включая незагруженные`)
          await settled(page, grid, count)
        })
        await sample('expand-child', async () => {
          const read = nextRead(leafRoute, 0)
          await child.focus(); await child.press('Enter')
          assertCards(await result(await read), profile.rows.slice(0, 100))
          await expect(first.locator('[col-id="title"] button')).toHaveText(profile.rows[0].title)
          await settled(page, grid, count)
        })
        await assertVirtualized('expanded-first-block')
        await probe.scroll(`${profile.id}:expanded-vertical`, grid)
        await probe.scroll(`${profile.id}:expanded-horizontal`, grid, true)
        await probe.resize(`${profile.id}:expanded-resize`, grid, 'title')
        await top()
        await sample('select-full-child-group', async () => {
          await expect(childCheckbox).not.toHaveAttribute('aria-busy', 'true')
          const read = nextRead(leafRoute, 0, true)
          await childCheckbox.click()
          const payload = await result(await read)
          expect(payload.ids?.map(Number).sort((a, b) => a - b)).toEqual(expectedIds)
          observations.push({ count, profile: profile.id, phase: 'asserted-full-group-membership', ids: payload.ids })
          await expect(childCheckbox).toBeChecked()
          await expect(grid.getByText(`Выбрано: ${count}`, { exact: true })).toBeVisible()
          await expect.poll(selectedIds).toEqual(expectedIds)
          await expect(first.getByRole('checkbox')).toBeChecked()
        })
        await sample('expanded-deep-block', async () => {
          const read = nextRead(leafRoute, count - 100)
          await end()
          assertCards(await result(await read), profile.rows.slice(-100))
          await expect(last.getByRole('checkbox')).toBeChecked()
        })
        await assertVirtualized('expanded-last-block')
        await page.screenshot({ path: info.outputPath(`${profile.id}-${count}-expanded-end.png`) })
        await top()
        await expect(first).toBeVisible()
        const oldLeaf = await first.elementHandle()
        expect(oldLeaf).not.toBeNull()
        try {
          await sample('collapse-reopen-child', async () => {
            await child.focus(); await child.press('Enter')
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            expect(await oldLeaf!.evaluate(element => element.isConnected)).toBe(false)
            await expect(grid.locator('.ag-row[row-id^="document:"]')).toHaveCount(0)
            await expect(child).toBeFocused()
            await expect.poll(selectedIds).toEqual(expectedIds)
            await child.press('Enter')
            await settled(page, grid, count)
            await expect(first.getByRole('checkbox')).toBeChecked()
          })
        } finally { await oldLeaf?.dispose() }
        await sample('deselect-collapse-reopen-parent', async () => {
          await first.getByRole('checkbox').click()
          await expect(first.getByRole('checkbox')).not.toBeChecked()
          const remaining = expectedIds.filter(id => id !== profile.rows[0].id)
          await expect(grid.getByText(`Выбрано: ${count - 1}`, { exact: true })).toBeVisible()
          await expect(parentCheckbox).toHaveJSProperty('indeterminate', true)
          await parent.focus(); await parent.press('Enter')
          await expect(child).toHaveCount(0)
          await expect(grid.locator('.ag-row[row-id^="document:"]')).toHaveCount(0)
          await expect(parent).toBeFocused()
          await expect.poll(selectedIds).toEqual(remaining)
          await parent.press('Enter')
          await expect(child).toBeVisible()
          // Preservation of the nested expansion itself is not a new product
          // requirement; selection must survive whichever expansion is kept.
          if (await child.getAttribute('aria-expanded') !== 'true') {
            await child.focus(); await child.press('Enter')
          }
          await settled(page, grid, count)
          await expect(first.getByRole('checkbox')).not.toBeChecked()
          await expect.poll(selectedIds).toEqual(remaining)
          await end()
          await expect(last.getByRole('checkbox')).toBeChecked()
          await expect(grid.getByText(`Выбрано: ${count - 1}`, { exact: true })).toBeVisible()
        })
        await assertVirtualized('reopened-selection')
        observations.push({ count, profile: profile.id, expectedDocuments: count, selectedIds: await selectedIds() })
        await writeFile(info.outputPath('nested-observations.json'), JSON.stringify(observations, null, 2))
      }
      const blocks = requests.filter(isBlock)
      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks.every(request => request.endRow - request.startRow <= 100)).toBe(true)
      await writeFile(info.outputPath(`nested-requests-${count}.json`), JSON.stringify(requests, null, 2))
    } finally {
      await writeFile(info.outputPath('nested-observations.json'), JSON.stringify(observations, null, 2))
      await probe.finish()
      await copyFile(info.outputPath('smoothness.json'), info.outputPath(`nested-smoothness-${count}.json`))
      await context.close()
    }
  }
})
