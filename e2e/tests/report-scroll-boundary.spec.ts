import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { checkInstalledSafariFooter, closeInstalledSafariFooter } from '../report-scroll-safari'

const project = 'E2E short grouped scroll'
test.beforeAll(async () => withLineProgramFixture(async db => {
  await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
    connection_type,has_vik,psto_required) select $1,'SHORT','LINE-'||n,'F'||n,'2026-10-01','действующий','актуальная',
    'С17','да','да' from generate_series(1,8) n`, [project])
  await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
    select id,'primary',id from weld_joints where project_title=$1`, [project])
  await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
    select 'weldingJournal','SCROLL-DOC-'||n,'scroll.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1
    from generate_series(1,6) n`)
  await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
    select d.id,w.id from generated_documents d join weld_joints w on d.title='SCROLL-DOC-'||substring(w.joint from 2)
    where w.project_title=$1`, [project])
}))
test.afterAll(async () => {
  try { await closeInstalledSafariFooter() } finally { await cleanupLineProgramProjects([project]) }
})

for (const [report, route] of [['weldingJournal', '/journal'], ['lnk', '/lnk'], ['heatTreatment', '/psto'], ['documents', '/documents']] as const) {
  test(`${report}: short grouped table keeps its page extent and footer stable at scroll boundaries`, async ({ page }, info) => {
    const footerSelector = report === 'documents' ? '.document-grid-footer' : '[data-journal-footer]'
    const count = report === 'documents' ? 6 : 8
    await page.addInitScript(({ hidden, report }) => {
      if (report === 'documents') return
      localStorage.setItem(`welding-report-view:v1:${report}`, JSON.stringify({ activePreset: 'custom',
        hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [] }))
    }, { report, hidden: WELD_FIELDS.filter(field => !['line', 'joint', 'wdi', 'weldDate', 'finalStatus'].includes(field.key)).map(field => field.key) })
    await page.goto(route)
    if (report !== 'documents') await page.getByRole('searchbox').fill(project)
    await expect(page.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible()
    await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Сгруппировать по/ }).click()
    // Count records, excluding the similarly named document group renderer.
    const groupCount = () => page.locator('.ag-row.ag-row-group[row-id]').evaluateAll(rows => new Set(rows.map(row => row.getAttribute('row-id'))).size)
    await expect.poll(groupCount).toBe(count)
    await page.waitForLoadState('networkidle')
    await expect.poll(() => page.locator('.ag-grid-viewport').evaluate(element => element.scrollHeight - element.clientHeight)).toBe(0)
    if (process.env.REPORT_SCROLL_SAFARI === '1') {
      test.setTimeout(240_000)
      await checkInstalledSafariFooter(page, info, report, count, project)
      return
    }
    // Headless wheel input does not produce macOS elastic overscroll. Reproduce
    // its reported page offset and corresponding track rect without changing
    // the real scroll extent, then inspect the application's actual layout.
    const elastic = await page.evaluate(async footerSelector => {
      scrollTo(0, 0)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const track = document.querySelector<HTMLElement>('.journal-page-track')!
      const stage = document.querySelector<HTMLElement>('.journal-page-stage')!
      const geometry = [track, track.closest<HTMLElement>('[data-scroll-top-boundary]')!]
        .map(element => ({ element, rect: element.getBoundingClientRect.bind(element) }))
      const descriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')!
      const base = scrollY, samples: { height: number; stage: number; bottom: number }[] = []
      let delta = 0
      Object.defineProperty(window, 'scrollY', { configurable: true, get: () => base + delta })
      for (const { element, rect } of geometry) element.getBoundingClientRect = () => {
        const value = rect(); return new DOMRect(value.x, value.y - delta, value.width, value.height)
      }
      try {
        for (const offset of [0, -15, -65, -20, 0, 15, 65, 20, 0]) {
          delta = offset
          window.dispatchEvent(new Event('scroll'))
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          samples.push({ height: document.documentElement.scrollHeight, stage: stage.getBoundingClientRect().height,
            bottom: document.querySelector(footerSelector)!.getBoundingClientRect().bottom })
        }
      } finally {
        Object.defineProperty(window, 'scrollY', descriptor)
        for (const { element } of geometry) delete (element as any).getBoundingClientRect
        window.dispatchEvent(new Event('scroll'))
      }
      return samples
    }, footerSelector)
    await info.attach('elastic-layout', { body: JSON.stringify(elastic), contentType: 'application/json' })
    for (const sample of elastic) expect(sample).toEqual(elastic[0])
    await page.evaluate(footerSelector => {
      scrollTo(0, 0)
      const state = { running: true, frames: [] as { y: number; height: number; bottom: number; stage: number }[] }
      ;(window as any).footerProbe = state
      const tick = () => {
        state.frames.push({ y: scrollY, height: document.documentElement.scrollHeight,
          bottom: document.querySelector(footerSelector)!.getBoundingClientRect().bottom,
          stage: document.querySelector('.journal-page-stage')!.getBoundingClientRect().height })
        if (state.running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, footerSelector)
    await page.mouse.move(700, 500)
    for (const direction of [1, -1, 1, -1]) {
      for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, direction * 35); await page.waitForTimeout(20) }
    }
    await page.waitForTimeout(150)
    const frames = await page.evaluate(() => {
      const state = (window as any).footerProbe; state.running = false
      return state.frames as { y: number; height: number; bottom: number; stage: number }[]
    })
    await info.attach('footer-frames', { body: JSON.stringify(frames), contentType: 'application/json' })
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
    console.info('SHORT_GROUP_FOOTER', JSON.stringify({ report, frames: frames.length,
      pageHeightChange: spread(frames.map(frame => frame.height)), footerMovement: spread(frames.map(frame => frame.bottom)) }))
    expect(spread(frames.map(frame => frame.height)), 'Scrolling must not create extra page height').toBeLessThanOrEqual(1)
    expect(spread(frames.map(frame => frame.bottom)), 'The footer must stay at the viewport edge').toBeLessThanOrEqual(1)
    await expect.poll(groupCount).toBe(count)
    await expect(page.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible()
    // Exercise the heading transition too, not just a page with no scroll room.
    // The document moves before RAF; a deferred stage resize used to let the
    // footer jump or leave the viewport for one frame on each wheel event.
    await page.locator('.ag-row.ag-row-group').first().click({ button: 'right' })
    await page.getByTestId('context-action-menu').getByRole('button', { name: 'Развернуть все', exact: true }).click()
    await expect(page.locator('.ag-row:not(.ag-row-group)[row-id]').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => scrollTo(0, 500))
    await page.waitForTimeout(100)
    await page.evaluate(footerSelector => {
      const state = { running: true, frames: [] as { y: number; bottom: number }[], scrollFrames: [] as number[] }
      ;(window as any).footerProbe = state
      // The compositor can display this position before the application's
      // bubbling scroll handler resizes the stage. RAF alone misses that gap.
      const beforeResize = () => state.scrollFrames.push(document.querySelector(footerSelector)!.getBoundingClientRect().bottom)
      window.addEventListener('scroll', beforeResize, { capture: true, passive: true })
      ;(state as any).stop = () => { state.running = false; window.removeEventListener('scroll', beforeResize, true) }
      const tick = () => {
        state.frames.push({ y: scrollY, bottom: document.querySelector(footerSelector)!.getBoundingClientRect().bottom })
        if (state.running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, footerSelector)
    for (const direction of [-1, 1]) for (let step = 0; step < 40; step++) {
      await page.mouse.wheel(0, direction * 20)
      await page.waitForTimeout(20)
    }
    const headingProbe = await page.evaluate(() => { const s = (window as any).footerProbe; s.stop(); return { frames: s.frames as { y: number; bottom: number }[], scrollFrames: s.scrollFrames as number[] } })
    const heading = headingProbe.frames
    await info.attach('heading-footer-frames', { body: JSON.stringify(heading), contentType: 'application/json' })
    console.info('HEADING_FOOTER', JSON.stringify({ report, movement: spread(heading.map(frame => frame.bottom)), travel: spread(heading.map(frame => frame.y)) }))
    expect(spread(heading.map(frame => frame.y)), 'The heading scenario must actually scroll').toBeGreaterThan(30)
    expect(spread(heading.map(frame => frame.bottom)), 'The footer must keep its position while the heading moves').toBeLessThanOrEqual(1)
    expect(headingProbe.scrollFrames.length).toBeGreaterThan(2)
    expect(spread(headingProbe.scrollFrames), 'The footer must stay fixed before the JS stage resize too').toBeLessThanOrEqual(1)
    for (const width of [1100, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => page.evaluate(footerSelector => {
        const panel = document.querySelector(footerSelector)!.getBoundingClientRect()
        const track = document.querySelector('.journal-page-track')!.getBoundingClientRect()
        return Math.max(Math.abs(panel.left - track.left), Math.abs(panel.width - track.width))
      }, footerSelector)).toBeLessThanOrEqual(1)
    }
    // A tall heading in a short window must not be covered by the footer.
    await page.setViewportSize({ width: 1100, height: 300 })
    await page.evaluate(() => scrollTo(0, 0))
    await expect(page.locator('.journal-page-stage')).not.toHaveAttribute('data-journal-docked-footer', '')
    await expect.poll(() => page.evaluate(footerSelector => document.querySelector(footerSelector)!.getBoundingClientRect().top
      - document.querySelector('.journal-page-track')!.getBoundingClientRect().top, footerSelector)).toBeGreaterThan(100)
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(footerSelector => document.querySelector(footerSelector)!.getBoundingClientRect().bottom - innerHeight,
      footerSelector)).toBeLessThanOrEqual(1)
  })
}
