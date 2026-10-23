import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E LNK grid comparison'
test.beforeAll(async () => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
    connection_type,officiality,revision_actuality,has_vik,psto_required,d1,t1,wdi,material_1,material_2,responsible)
    select $1,'COMPARE','COMPARE-'||n,'F'||(950000+n),'2026-09-01','С17','действующий','актуальная','да','да',215,10,10,
      'Материал с длинным обозначением','Материал с длинным обозначением','Ответственный за выполнение сварки'
    from generate_series(1,74) n`, [project]))
})
test.afterAll(() => cleanupLineProgramProjects([project]))

for (const [route, report] of [['/lnk', 'lnk'], ['/psto', 'heatTreatment']] as const) {
  test(`${report}: comparable scroll, resize, requests and appearance`, async ({ page }, info) => {
    const calls: string[] = [], errors: string[] = []
    page.on('request', request => { const name = rpcName(request.url()); if (name) calls.push(name) })
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(report => localStorage.setItem(`welding-report-view:v1:${report}`, JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys: [], customHiddenFieldKeys: [], collapsedSections: [], savedViews: [],
    })), report)
    await page.goto(route)
    await page.getByRole('searchbox').fill(project)
    const grid = page.locator(`[data-weld-report-grid="${report}"]`)
    await expect(grid).toBeVisible()
    await expect(page.getByText('Найдено: 74', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const target = grid.locator('.ag-grid-viewport')
    await target.hover()
    await page.mouse.wheel(0, 800)
    await page.waitForLoadState('networkidle')
    const before = calls.length
    await page.evaluate(() => {
      const measure = { frames: [] as number[], longTasks: [] as number[], active: true, last: performance.now() }
      const observer = new PerformanceObserver(entries => { if (measure.active) measure.longTasks.push(...entries.getEntries().map(entry => entry.duration)) })
      observer.observe({ type: 'longtask' })
      const frame = (now: number) => { if (measure.active) { measure.frames.push(now - measure.last); measure.last = now; requestAnimationFrame(frame) } }
      requestAnimationFrame(frame)
      Object.assign(window, { comparisonMeasure: { measure, observer } })
    })
    for (let i = 0; i < 36; i++) {
      await page.mouse.wheel(i < 18 ? 0 : 90, i < 18 ? 100 : 0)
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    }
    const measurement = await page.evaluate(() => {
      const { measure, observer } = (window as unknown as { comparisonMeasure: { measure: { frames: number[]; longTasks: number[]; active: boolean }; observer: PerformanceObserver } }).comparisonMeasure
      measure.active = false; observer.disconnect()
      const frames = measure.frames.slice(1).sort((a, b) => a - b)
      return { mode: 'AG Grid', p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1), longTasks: measure.longTasks,
        rows: document.querySelectorAll('.ag-grid-scrolling-rows .ag-row').length,
        cells: document.querySelectorAll('.ag-grid-scrolling-rows .ag-cell').length }
    })
    expect(calls.slice(before)).toEqual([])
    expect(errors).toEqual([])
    expect(measurement.p95).toBeLessThan(35)
    expect(measurement.rows).toBeLessThan(60)
    await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.ag-grid-viewport')?.scrollTo(0, 0) })
    await page.screenshot({ path: info.outputPath(`${report}-wide.png`) })
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.screenshot({ path: info.outputPath(`${report}-narrow.png`) })
    console.info(`Comparison ${report}:`, JSON.stringify({ ...measurement, calls: calls.slice(before) }))
    await info.attach('comparison.json', { body: JSON.stringify(measurement), contentType: 'application/json' })
  })
}
