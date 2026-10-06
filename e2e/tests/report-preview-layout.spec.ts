import { expect, test } from '@playwright/test'
import { buildPrintableReportHtml } from '../../src/lib/printable-report'
import { getPrintableReportPage } from '../../src/lib/printable-report-page'

test('statistics pagination keeps the parent project visible without duplicating totals', async ({ page }) => {
  const sliced = getPrintableReportPage({ title: 'Statistics', tables: [{ title: 'Projects', columns: ['Проект / материал'],
    rows: [['Проект <А>'], ...Array.from({ length: 101 }, (_, i) => [`М${i + 1}`])],
    rowKinds: ['group', ...Array<'detail'>(101).fill('detail')],
  }] }, 1)
  await page.setContent(buildPrintableReportHtml(sliced.report, { embedded: true }))
  await expect(page.getByText('Продолжение группы: Проект <А>.', { exact: true })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('tbody tr').first()).toHaveClass('table-row-detail')
  await expect(page.locator('tbody tr').first()).toHaveText('М100')
})

test('report metrics wrap within automatic card height and stay proportionate to the table', async ({ page }) => {
  const html = buildPrintableReportHtml({ title: 'Программа линий — сводка по линиям',
    metrics: [
      { label: 'Линий', value: '14' },
      { label: 'Физических стыков', value: '70', detail: 'Без повторов по клеймам' },
      { label: 'РК - УЗК к назначению', value: '4' },
      { label: 'ПВК к назначению', value: '4' },
      { label: 'Без расчёта', value: '4', detail: 'Линии с неполной настройкой не включены в итоги потребности' },
    ],
    tables: [{ title: 'Линии', columns: ['Проект', 'Шифр', 'Линия', 'Клейм', 'Стыков', 'РК - УЗК · зачтено / нужно', 'ПВК · зачтено / нужно', 'К назначению', 'Лишнее', 'Можно снять', 'Примечание'],
      rows: Array.from({ length: 12 }, (_, i) => ['Демо — 50 стыков', 'DEMO-50-2026', 'DEMO-L' + (i + 1), 1, 5, '3 / 3', '1 / 1', 0, 1, 0, 'РК - УЗК 30% · ПВК 10%']) }],
  }, { embedded: true })
  for (const width of [1480, 1000, 680]) {
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(html)
    for (const media of ['screen', 'print'] as const) {
      await page.emulateMedia({ media })
      const layout = await page.locator('.metrics').evaluate(metrics => {
        const cards = [...metrics.querySelectorAll<HTMLElement>('.metric')]
        const overflows = cards.flatMap(card => [...card.children].filter(child => {
          const outer = card.getBoundingClientRect(), inner = child.getBoundingClientRect()
          return inner.right > outer.right - 3 || inner.bottom > outer.bottom - 3 || inner.left < outer.left
        }))
        return { overflows: overflows.length, ratio: parseFloat(getComputedStyle(cards[0].querySelector('.metric-value')!).fontSize) / parseFloat(getComputedStyle(document.querySelector('table')!).fontSize),
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth }
      })
      expect(layout.overflows).toBe(0)
      expect(layout.ratio).toBeLessThan(2)
      expect(layout.pageOverflow).toBe(false)
      if (media === 'screen') {
        expect(await page.getByRole('columnheader', { name: 'Клейм', exact: true }).evaluate(el => {
          const range = document.createRange(); range.selectNodeContents(el)
          return range.getClientRects().length
        })).toBe(1)
      }
    }
    await page.emulateMedia({ media: 'screen' })
    await page.screenshot({ path: `outputs/report-metrics-${width}.png` })
  }
})

test('wide reports scroll within the sheet and fit the printable page', async ({ page }) => {
  await page.setContent(buildPrintableReportHtml({ title: 'Системная версия', tables: [{
    title: '', columns: Array.from({ length: 30 }, (_, i) => `Столбец ${i + 1}`),
    rows: [Array.from({ length: 30 }, () => 'ОченьДлинноеНеразрывноеЗначение')],
  }] }, { embedded: true }))
  expect(await page.locator('.table-wrap').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.emulateMedia({ media: 'print' })
  expect(await page.locator('.table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  expect(await page.locator('thead').evaluate(el => getComputedStyle(el).display)).toBe('table-header-group')
})
