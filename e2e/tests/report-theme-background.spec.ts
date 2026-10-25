import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E opaque report themes'
const documentPrefix = 'OPAQUE-THEME-'

test.beforeAll(async () => withLineProgramFixture(async db => {
  await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
    connection_type,has_vik,psto_required) select $1,'THEME','THEME-'||n,'F'||n,'2026-10-01','действующий','актуальная',
    'С17','да','да' from generate_series(1,48) n`, [project])
  await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
    select 'weldingJournal',$1||n,'theme.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1
    from generate_series(1,48) n`, [documentPrefix])
}))
test.afterAll(async () => {
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(db => db.query('delete from generated_documents where title like $1', [documentPrefix + '%']))
})

for (const route of ['/journal', '/lnk', '/psto', '/documents']) {
  test(`${route}: loaded rows hide the scroll placeholder in every theme`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(route)
    const grid = page.locator(route === '/documents' ? '[data-document-history-grid]' : '[data-weld-report-grid]')
    if (route === '/documents') await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(documentPrefix)
    else await grid.getByRole('searchbox').fill(project)
    await expect(grid.getByText('Найдено: 48', { exact: true })).toBeVisible()
    const viewport = grid.locator('.ag-grid-viewport')
    const settings = page.getByRole('dialog', { name: /^Настройка вида/ })
    for (const theme of ['Нейтральная', 'Классическая', 'Светлая']) {
      for (const stripes of [false, true]) {
        await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
        await settings.getByRole('tab', { name: 'Темы', exact: true }).click()
        await settings.getByRole('radio', { name: new RegExp(`^${theme}`) }).click()
        await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
        await settings.getByRole('switch', { name: 'Чередование строк', exact: true }).setChecked(stripes)
        if (route !== '/documents') await settings.getByRole('switch', { name: /Жёлтая заливка/ }).uncheck()
        await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
        await page.mouse.move(0, 0)
        await page.evaluate(() => scrollTo(0, 137))
        await expect.poll(() => viewport.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe('none')
        await expect(grid.locator('.journal-loading-cell')).toHaveCount(0)
        // Compare settled pixels: theme/reveal transitions can still change
        // text colors after the rows have loaded. Leave scroll timelines alone.
        await viewport.evaluate(async element => {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          await Promise.all(element.getAnimations({ subtree: true })
            .filter(animation => animation.timeline === document.timeline
              && animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {})))
        })
        const clip = await viewport.evaluate(el => {
          const box = el.getBoundingClientRect()
          const rows = [...el.querySelectorAll('.ag-grid-scrolling-rows .ag-row:not(.ag-row-group)')]
            .map(row => row.getBoundingClientRect())
            .filter(row => row.top >= Math.max(box.top, 0) && row.bottom <= Math.min(box.bottom, innerHeight))
            .sort((a, b) => a.top - b.top).slice(0, 4)
          if (rows.length < 4) throw Error('Need four visible loaded rows')
          return { x: box.x + 120, y: rows[0].y + 1, width: Math.min(700, box.width - 140), height: rows.at(-1)!.bottom - rows[0].top - 2 }
        })
        const withPlaceholder = await page.screenshot({ clip })
        if (theme === 'Нейтральная' && !stripes) await page.screenshot({ path: info.outputPath('neutral-loaded-rows.png') })
        // Compare real painted pixels with/without the underlying scroll tile.
        // Loaded rows must look identical; this catches translucent themes even
        // when their DOM contents and loading flags are entirely correct.
        await viewport.evaluate(el => (el as HTMLElement).style.setProperty('background-image', 'none', 'important'))
        const withoutPlaceholder = await page.screenshot({ clip })
        await viewport.evaluate(el => (el as HTMLElement).style.removeProperty('background-image'))
        if (!withPlaceholder.equals(withoutPlaceholder)) {
          await info.attach(`${theme}-${stripes}-with-placeholder`, { body: withPlaceholder, contentType: 'image/png' })
          await info.attach(`${theme}-${stripes}-without-placeholder`, { body: withoutPlaceholder, contentType: 'image/png' })
        }
        expect(withPlaceholder.equals(withoutPlaceholder), `${theme}, stripes=${stripes}: placeholder must not show through loaded rows`).toBe(true)
      }
    }
  })
}
