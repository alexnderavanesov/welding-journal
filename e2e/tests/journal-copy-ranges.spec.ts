import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { rpcName } from '../rpc'

const PROJECT = 'E2E journal multi-range copy'
test.beforeAll(() => withLineProgramFixture(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint)
  select $1,'COPY','COPY-LINE','C'||lpad(n::text,3,'0') from generate_series(1,350) n`, [PROJECT])))
test.afterAll(() => cleanupLineProgramProjects([PROJECT]))
test.beforeEach(async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard permission is tested in Chrome; deferred-item cancellation also has unit coverage.')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(hidden => localStorage.setItem('welding-report-view:v1:weldingJournal', JSON.stringify({
    activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [],
  })), WELD_FIELDS.filter(field => !['joint', 'line', 'subtitleCode'].includes(field.key)).map(field => field.key))
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(PROJECT)
  await expect(page.getByText('Найдено: 350', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'C001', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
})
async function select(page: Page, ranges: { first: number; last: number; columns: string[] }[]) {
  await page.evaluate(ranges => {
    const root = document.querySelector('.ag-root-wrapper')!
    const key = Object.keys(root).find(key => key.startsWith('__reactFiber'))!
    let fiber = (root as any)[key]
    while (fiber && !fiber.stateNode?.api?.addCellRange) fiber = fiber.return
    if (!fiber) throw new Error('Missing grid API')
    const api = fiber.stateNode.api
    api.setFocusedCell(0, 'joint'); api.clearCellSelection()
    for (const range of ranges) api.addCellRange({ rowStartIndex: range.first, rowEndIndex: range.last, columns: range.columns })
  }, ranges)
}
async function copied(page: Page) {
  return page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'))
}

test('separate ranges retain their own headers, including unloaded rows', async ({ page }) => {
  await select(page, [{ first: 95, last: 105, columns: ['joint'] }, { first: 120, last: 121, columns: ['subtitleCode'] }])
  await expect(page.getByText('Количество: 13', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => copied(page)).toBe('Стык\n' + Array.from({ length: 11 }, (_, i) => `C${String(i + 96).padStart(3, '0')}`).join('\n') + '\nШифр\nCOPY\nCOPY')
})
test('compatible overlapping ranges copy each row once in first-selection order', async ({ page }) => {
  await select(page, [{ first: 2, last: 3, columns: ['joint'] }, { first: 0, last: 4, columns: ['joint'] }])
  await expect(page.getByText('Количество: 5', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => copied(page)).toBe('Стык\nC003\nC004\nC001\nC002\nC005')
})
test('same rows with different columns merge in displayed column order', async ({ page }) => {
  await select(page, [{ first: 0, last: 1, columns: ['subtitleCode'] }, { first: 0, last: 1, columns: ['joint'] }])
  await expect(page.getByText('Количество: 4', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => copied(page)).toBe('Стык\tШифр\nC001\tCOPY\nC002\tCOPY')
})
test('changing the filter cancels pending copy without replacing the clipboard', async ({ page }) => {
  let started = false, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.evaluate(() => navigator.clipboard.writeText('KEEP-CLIPBOARD'))
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('copyJournalGridRange_')) { started = true; await gate }
    await route.continue().catch(() => {}) // The intentional abort may win the race.
  })
  try {
    await select(page, [{ first: 0, last: 349, columns: ['joint'] }])
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => started).toBe(true)
    await page.getByRole('searchbox').fill(`${PROJECT} missing`)
    await expect(page.getByText('Найдено: 0', { exact: true })).toBeVisible()
    release()
    await page.waitForLoadState('networkidle')
    expect(await copied(page)).toBe('KEEP-CLIPBOARD')
    await expect(page.getByText('Копируем…', { exact: true })).toHaveCount(0)
  } finally { release() }
})
