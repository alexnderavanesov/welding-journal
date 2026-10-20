import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E sticky continuous scroll'
test.use({ trace: 'off', video: 'off' })
test.afterEach(() => cleanupLineProgramProjects([project]))
async function seedLine() {
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'STICKY','STICKY-LINE','II','A',100,10) returning id`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,has_vik,vik_result)
      select $1,$2,'STICKY','STICKY-LINE','F'||n,'2026-09-01','действующий','актуальная','С17','STICKY-A','да','годен' from generate_series(1,300) n`, [program.id, project])
  })
}
test('joint header remains visible through forward/reverse document scroll and fractional geometry', async ({ page }, info) => {
  await seedLine()
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill('STICKY-LINE')
  await page.getByRole('button', { name: 'Расчёт линии STICKY-LINE', exact: true }).click()
  await page.getByRole('button', { name: 'Клеймо STICKY-A', exact: true }).click()
  const grid = page.locator('[data-testid="stamp-joints-container"] [data-program-grid="joints"]')
  await expect(grid).toHaveAttribute('data-program-row-count', '300')
  await expect(page.locator('[data-program-motion]')).toHaveCount(0)
  const samples = await grid.evaluate(async root => {
    const samples: Array<Record<string, number | boolean>> = []
    const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    for (const zoom of [1, 0.9, 1.1]) {
      document.body.style.zoom = String(zoom)
      await settle()
      window.scrollBy(0, root.getBoundingClientRect().top + 600)
      await settle()
      for (let i = 0; i < 70; i++) {
        window.scrollBy(0, (i < 40 ? 1 : -1) * (i % 3 ? 17.5 : 111.25))
        await settle()
        const header = root.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')!
        const box = header.getBoundingClientRect()
        const control = header.querySelector('.ag-header-cell')!
        const cell = control.getBoundingClientRect()
        const hit = document.elementFromPoint(Math.max(1, cell.x + Math.min(30, cell.width / 2)), box.top + box.height / 2)
        samples.push({ zoom, top: box.top, bottom: box.bottom, rootTop: root.getBoundingClientRect().top,
          rootBottom: root.getBoundingClientRect().bottom, pinned: header.classList.contains('program-stuck-control'),
          visible: box.top >= 0 && box.bottom <= innerHeight && !!hit && header.contains(hit) })
      }
    }
    document.body.style.zoom = ''
    return samples
  })
  await info.attach('sticky-scroll-samples.json', { body: JSON.stringify(samples), contentType: 'application/json' })
  expect(samples.filter(sample => !sample.visible)).toEqual([])
})

test('expanded line keeps its parent header until the incoming columns arrive, in both directions', async ({ page }, info) => {
  await seedLine()
  const errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) requests.push(request.url()) })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill('STICKY-LINE')
  await page.getByRole('button', { name: 'Расчёт линии STICKY-LINE', exact: true }).click()
  await page.getByRole('button', { name: 'Клеймо STICKY-A', exact: true }).click()
  await expect(page.locator('[data-program-grid="joints"]')).toHaveAttribute('data-program-row-count', '300')
  await expect(page.locator('[data-program-motion]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  const before = requests.length
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator('.program-stuck-control')).toHaveCount(0)
  await expect(page.locator('.program-sticky-frame')).toBeHidden()
  // Normal and pinned headers share the workspace's thin gray edge.
  await expect(page.getByTestId('program-line-filters')).toHaveCSS('border-bottom-width', '0px')
  for (const kind of ['stamps', 'joints']) {
    const header = page.locator(`[data-program-grid="${kind}"] .ag-grid-pinned-top-rows`).first()
    expect(await header.evaluate(element => {
      const edge = getComputedStyle(element, '::after')
      return { height: edge.height, color: edge.backgroundColor, pointer: edge.pointerEvents }
    })).toEqual({ height: '1px', color: 'rgb(203, 213, 225)', pointer: 'none' })
  }
  await page.locator('[data-program-grid="stamps"] .ag-grid-pinned-top-rows').first().screenshot({ path: '/private/tmp/line-program-context-border-20261020/natural-stamp-header.png' })
  // The user's screenshots start here: the line heading is near the top,
  // but its stamp columns have not arrived. There must still be a header.
  await page.getByTestId('line-program-detail').evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 70))
  await expect(page.locator('[data-program-grid="lines"] .program-stuck-control')).toHaveCount(1)
  const pinnedHeader = page.locator('[data-program-grid="lines"] .program-stuck-control')
  expect(await pinnedHeader.evaluate(element => {
    const edge = getComputedStyle(element, '::after')
    return { height: edge.height, top: edge.top, color: edge.backgroundColor, pointer: edge.pointerEvents }
  })).toEqual({ height: '1px', top: '0px', color: 'rgb(203, 213, 225)', pointer: 'none' })
  expect(await page.locator('[data-program-grid="lines"] .ag-root-wrapper').first().evaluate(element => {
    const sides = getComputedStyle(element)
    const top = getComputedStyle(document.querySelector('.program-sticky-frame')!)
    return [sides.borderLeftWidth, sides.borderRightWidth].every(width => width === top.height)
      && [sides.borderLeftColor, sides.borderRightColor].every(color => color === top.backgroundColor)
  })).toBe(true)
  await pinnedHeader.screenshot({ path: '/private/tmp/line-program-scroll-width-20261020/pinned-header.png' })
  await page.screenshot({ path: info.outputPath('expanded-line-heading.png') })
  const samples: Array<Record<string, unknown>> = []
  for (const motion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion: motion })
    for (const kind of ['stamps', 'joints']) {
      const grid = page.locator(`[data-program-grid="${kind}"]`).first()
      samples.push(...await grid.evaluate(async (root, motion) => {
        const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        const result: Array<Record<string, unknown>> = []
        const header = root.querySelector<HTMLElement>('.ag-grid-pinned-top-rows')!
        const naturalTop = () => (header.previousElementSibling?.classList.contains('program-sticky-spacer') ? header.previousElementSibling : header)!.getBoundingClientRect().top
        for (const target of [140, 92, 76, 58, 40, 37, 36, 35, 20, -40, 20, 35, 36, 37, 40, 58, 76, 92, 140]) {
          window.scrollBy(0, naturalTop() - target)
          await settle()
          const current = [...document.querySelectorAll<HTMLElement>('.program-stuck-control')]
          const active = current[0], box = active?.getBoundingClientRect()
          const cell = active?.querySelector('.ag-header-cell')?.getBoundingClientRect()
          const hit = box && cell ? document.elementFromPoint(cell.left + 24, box.top + box.height / 2) : null
          // Device-pixel rounding and header/spacer borders can differ by a
          // fraction of a pixel. Either owner is valid within 1px of the edge;
          // every sample must still have exactly one visible, usable header.
          const context = document.querySelector<HTMLElement>('.program-sticky-context')!
          const contextStyle = getComputedStyle(context)
          const frame = document.querySelector<HTMLElement>('.program-sticky-frame')!
          const frameStyle = getComputedStyle(frame), frameBounds = frame.getBoundingClientRect()
          const overviewBounds = document.querySelector('[data-program-grid="lines"]')!.getBoundingClientRect()
          const frameLeft = Math.max(0, overviewBounds.left), frameRight = Math.min(innerWidth, overviewBounds.right)
          const contextFramed = context.hidden || contextStyle.borderTopWidth === '1px' && contextStyle.borderTopColor === 'rgb(203, 213, 225)'
            && contextStyle.borderLeftWidth === '0px' && contextStyle.borderRightWidth === '0px' && contextStyle.borderBottomWidth === '0px'
          // The full-width edge must remain visible even while the context
          // title hides during a handoff back to the overview header.
          const frameVisible = !frame.hidden && frame.parentElement === context.parentElement
            && frameStyle.backgroundColor === 'rgb(203, 213, 225)' && frameStyle.pointerEvents === 'none'
            && frameBounds.top === 0 && frameBounds.height === 1
            && Math.abs(frameBounds.left - frameLeft) < 1 && Math.abs(frameBounds.right - frameRight) < 1
          const actualTop = naturalTop()
          const expected = Math.abs(actualTop - 36) <= 1 ? null : actualTop < 36 ? root.dataset.programGrid : root.dataset.programGrid === 'joints' ? 'stamps' : 'lines'
          result.push({ motion, kind: root.dataset.programGrid, target, actualTop, expected, actual: active?.closest<HTMLElement>('[data-program-grid]')?.dataset.programGrid,
            count: current.length, contextFramed, frameVisible, visible: !!box && box.top >= 0 && !!hit && !!active?.contains(hit) })
        }
        return result
      }, motion))
    }
  }
  await info.attach('header-handoff-samples.json', { body: JSON.stringify(samples), contentType: 'application/json' })
  expect(samples.filter(sample => sample.count !== 1 || !sample.visible || !sample.contextFramed || !sample.frameVisible || sample.expected !== null && sample.actual !== sample.expected)).toEqual([])
  await page.locator('[data-program-grid="joints"]').evaluate(root => {
    const header = root.querySelector('.ag-grid-pinned-top-rows')!
    const natural = header.previousElementSibling?.classList.contains('program-sticky-spacer') ? header.previousElementSibling : header
    window.scrollBy(0, natural!.getBoundingClientRect().top - 20)
  })
  await expect(page.locator('.program-sticky-context')).toContainText('STICKY-A')
  const contextBounds = (await page.locator('.program-sticky-context').boundingBox())!
  const frameBounds = (await page.locator('.program-sticky-frame').boundingBox())!
  const headerBounds = (await page.locator('[data-program-grid="joints"] .program-stuck-control').boundingBox())!
  await page.screenshot({ path: '/private/tmp/line-program-context-border-20261020/joint-header.png', clip: {
    x: frameBounds.x, y: frameBounds.y, width: frameBounds.width, height: headerBounds.y + headerBounds.height - contextBounds.y,
  } })
  await page.screenshot({ path: info.outputPath('pinned-joint-columns.png') })
  expect(requests.slice(before)).toEqual([])
  expect(errors).toEqual([])
})
