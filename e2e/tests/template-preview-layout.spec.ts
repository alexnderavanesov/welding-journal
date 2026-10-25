import { expect, test } from '@playwright/test'
import { templatePreviewWorkbook, templateSizingWorkbook } from '../../src/test/fixtures/template-preview-workbook'
import { readHistoryDocumentWorkbook } from '../../src/lib/history-document-preview'
import { buildPreviewFrameHtml, PREVIEW_FRAME_SANDBOX } from '../../src/lib/document-preview-frame'

test('sheet sizing: hidden columns do not stretch headers, visible text grows rows, empty tails are trimmed', async ({ page }) => {
  const book = await readHistoryDocumentWorkbook(await templateSizingWorkbook())
  await page.setContent(book.page(0, 0, 0, 'Sizing'))
  await expect(page.getByText(/Скрытый длинный/)).toHaveCount(0)
  const sizes = await page.evaluate(() => ({ rows: [...document.querySelectorAll('tr')].map(row => row.getBoundingClientRect().height),
    width: document.querySelector('table')!.getBoundingClientRect().width }))
  expect(sizes.rows).toHaveLength(3)
  expect(sizes.rows[0]).toBeLessThan(50); expect(sizes.rows[1]).toBeLessThan(50)
  expect(sizes.rows[2]).toBeGreaterThan(40); expect(sizes.rows[2]).toBeLessThan(150)
  expect(sizes.width).toBeLessThan(310)
  const merged = page.locator('[data-cell-address="A1"]')
  await expect(merged).toHaveCSS('border-bottom-width', '1px')
  await expect(merged).toHaveCSS('border-right-color', 'rgb(0, 0, 0)')
})

test('preview frame delivers native input but blocks document scripts and network requests', async ({ page }) => {
  const blockedRequests: string[] = []
  await page.route('https://preview-blocked.invalid/**', route => { blockedRequests.push(route.request().url()); return route.abort() })
  await page.setContent(`<iframe sandbox="${PREVIEW_FRAME_SANDBOX}" style="width:800px;height:600px"></iframe>`)
  await page.locator('iframe').evaluate((element, html) => { (element as HTMLIFrameElement).srcdoc = html }, buildPreviewFrameHtml(`<!doctype html><html><head>
    <script>parent.document.body.dataset.documentScript='executed'</script>
    <script src="https://preview-blocked.invalid/script.js"></script></head><body>
    <div style="height:3000px" onwheel="parent.document.body.dataset.documentScript='executed'">Document</div>
    <img src="https://preview-blocked.invalid/image.png"></body></html>`))
  await expect(page.frameLocator('iframe').getByText('Document', { exact: true })).toBeVisible()
  await page.locator('iframe').evaluate(element => {
    const doc = (element as HTMLIFrameElement).contentDocument!
    doc.addEventListener('wheel', event => { doc.body.dataset.wheel = String(event.ctrlKey); event.preventDefault() }, { passive: false })
  })
  await page.mouse.move(300, 300)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100)
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-wheel', 'true')
  await page.keyboard.up('Control')
  expect(await page.locator('body').getAttribute('data-document-script')).toBeNull()
  expect(blockedRequests).toEqual([])
})

test('VIK template labels use blank cells without narrow wrapping or overlapping occupied values', async ({ page }, info) => {
  const workbook = await readHistoryDocumentWorkbook(await templatePreviewWorkbook())
  await page.setContent(workbook.page(0, 0, 0, 'Акт ВИК'))
  const metrics = await page.evaluate(() => {
    const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON()
    const first = document.querySelector('[data-cell-address="A1"] .excel-overflow') as HTMLElement
    return { label: bounds('[data-cell-address="A1"] .excel-overflow'), number: bounds('[data-cell-address="F1"]'),
      joint: bounds('[data-cell-address="A2"] .excel-overflow'), result: bounds('[data-cell-address="J2"]'),
      labelFits: first.scrollWidth <= first.clientWidth, table: bounds('table') }
  })
  expect(metrics.table.width).toBeCloseTo(800, 0)
  expect(metrics.label.width).toBeGreaterThan(390)
  expect(metrics.label.height).toBeLessThan(45)
  expect(metrics.labelFits).toBe(true)
  expect(metrics.label.right).toBeLessThanOrEqual(metrics.number.left)
  expect(metrics.joint.height).toBeLessThan(25)
  expect(metrics.joint.right).toBeLessThanOrEqual(metrics.result.left)
  await expect(page.getByText('Годен', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('vik-template-preview.png') })
})
