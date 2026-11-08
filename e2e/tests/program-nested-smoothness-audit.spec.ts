import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createSmoothnessProbe } from '../smoothness-probe'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const enabled = !!process.env.SMOOTHNESS_LABEL && process.env.SMOOTHNESS_NESTED === '1'
const project = 'E2E nested smoothness 2026-11-05'
const line = 'SM-NESTED-1000'
const stamps = Array.from({ length: 10 }, (_, index) => `N8${String(index).padStart(2, '0')}`)
type IntervalAudit = { active: Map<number, number>; ticks10: number }

test.skip(!enabled, 'Explicit isolated nested-grid performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 15000 })

// Read geometry only before/after a gesture, never inside its frame sampler.
async function readingPosition(page: Page, grid: Locator, top: number) {
  await page.evaluate(top => window.scrollTo({ top, left: 0, behavior: 'instant' }), top)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(top, 0)
  await page.waitForTimeout(300)
  return grid.evaluate(element => {
    const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
    const header = element.querySelector<HTMLElement>('.ag-header-cell[col-id="joint"]')!
    return { pageY: window.scrollY, gridTop: element.getBoundingClientRect().top + window.scrollY,
      gridScrollTop: viewport.scrollTop, columnWidth: header.getBoundingClientRect().width,
      renderedRows: element.querySelectorAll('.ag-row').length }
  })
}

test('one versus ten expanded stamp branches: scrolling, resizing and idle after closing', async ({ page }, info) => {
  test.setTimeout(300000)
  let stampIds: number[] = []
  const observations: object[] = []
  let reference: Awaited<ReturnType<typeof readingPosition>> | undefined
  await page.addInitScript(() => {
    const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window)
    const state: IntervalAudit = { active: new Map(), ticks10: 0 }
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const wrapped = timeout === 10 && typeof handler === 'function'
        ? (...params: unknown[]) => { state.ticks10++; return handler(...params) } : handler
      const id = set(wrapped, timeout, ...args)
      state.active.set(id, timeout ?? 0)
      return id
    }) as typeof window.setInterval
    window.clearInterval = id => { if (typeof id === 'number') state.active.delete(id); clear(id) }
    Object.assign(window, { nestedGridIntervalAudit: state })
  })
  const probe = await createSmoothnessProbe(page, info)
  const profiler = process.env.NESTED_CPU_PROFILE === '1' && info.project.name === 'chromium'
    ? await page.context().newCDPSession(page) : null
  await profiler?.send('Profiler.enable')
  try {
    // This helper verifies the disposable local target and invalidates derived
    // caches atomically. No shared smoothness fixture or working data is changed.
    stampIds = await withLineProgramFixture(async db => {
      expect((await db.query('select id from line_programs where project_title=$1', [project])).rowCount).toBe(0)
      expect((await db.query('select id from welder_stamps where naks_stamp=any($1::text[])', [stamps])).rowCount).toBe(0)
      const { rows: [program] } = await db.query(`insert into line_programs
        (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        values ($1,'SM-NESTED',$2,'II','Б(а)',10,10) returning id`, [project, line])
      const welders = await db.query<{ id: number }>(`insert into welder_stamps
        (naks_stamp,internal_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,
        thickness_from,thickness_to,valid_from,valid_to,naks_permits,dls_permits)
        select stamp,'SM-NESTED-'||stamp,'Сварщик вложенного замера '||stamp,'РД','М01','10','1000',
        '1','50','2026-01-01','2027-12-31','[]','[]' from unnest($1::text[]) stamp returning id`, [stamps])
      await db.query(`insert into weld_joints
        (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,
        revision_actuality,welding_method,material_group,d1,d2,t1,t2,wdi,category,group_name,
        weld_control_percent,pvk_control_percent,stamp_1_k,stamp_1_z,stamp_1_o,
        stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,has_vik,vik_request,vik_request_date,
        vik_result,vik_conclusion,vik_conclusion_date,psto_required)
        select $1,$2,'SM-NESTED',$3,'F'||lpad(n::text,4,'0'),'2026-10-01','С17','действующий',
        'актуальная','РД','М01',108,108,4,4,0.42,'II','Б(а)',10,10,
        stamp,stamp,stamp,stamp,stamp,stamp,'да','SM-NESTED-V','2026-10-01',
        'годен','SM-NESTED-C','2026-10-02','нет'
        from generate_series(1,1000) n
        cross join lateral (select ($4::text[])[1+(n-1)/100] as stamp) selected_stamp`,
      [program.id, project, line, stamps])
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
        select id,'primary',id from weld_joints where line_program_id=$1`, [program.id])
      const counts = await db.query<{ stamp: string; count: number }>(`select stamp_1_k as stamp,count(*)::int as count
        from weld_joints where line_program_id=$1 group by stamp_1_k order by stamp_1_k`, [program.id])
      expect(counts.rows).toEqual(stamps.map(stamp => ({ stamp, count: 100 })))
      return welders.rows.map(row => row.id)
    })

    for (const branches of [1, 10]) {
      // A full navigation clears retained detail instances and interval state;
      // the one-branch case must not contain nine previously mounted branches.
      await page.goto('/line-program')
      await page.getByLabel('Поиск программы линий', { exact: true }).fill(line)
      await page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true }).click()
      for (const stamp of stamps.slice(0, branches)) {
        const disclosure = page.getByRole('button', { name: `Клеймо ${stamp}`, exact: true })
        // Expanded details can put the next master outside a virtual window.
        // The remaining closed masters fit together at the table's tail.
        if (stamp !== stamps[0]) await expect(async () => {
          await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
          await expect(disclosure).toBeInViewport({ timeout: 500 })
        }).toPass({ timeout: 15000 })
        else await expect(disclosure).toBeVisible()
        await disclosure.click()
        const branch = page.locator(`[data-testid="stamp-joints-container"][data-stamp="${stamp}"] [data-program-grid="joints"]`)
        await expect(branch).toHaveAttribute('data-program-row-count', '100', { timeout: 60000 })
        await expect(branch.locator('.ag-row').first()).toBeVisible()
        await expect(page.locator('.program-detail-motion[data-program-motion]')).toHaveCount(0)
      }
      await expect(page.locator('[data-program-grid="joints"]:visible')).toHaveCount(branches)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(350)
      const grid = page.locator(`[data-testid="stamp-joints-container"][data-stamp="${stamps[0]}"] [data-program-grid="joints"]`)
      const top = reference?.pageY ?? await grid.evaluate(element => element.getBoundingClientRect().top + window.scrollY + 600)

      for (let round = 0; round < 3; round++) {
        for (const gesture of ['scroll', 'resize'] as const) {
          const position = await readingPosition(page, grid, top)
          reference ??= position
          expect(Math.abs(position.gridTop - reference.gridTop), 'Same first branch position in both profiles').toBeLessThan(2)
          expect(Math.abs(position.gridScrollTop - reference.gridScrollTop), 'Same virtual reading position').toBeLessThan(2)
          expect(Math.abs(position.columnWidth - reference.columnWidth), 'Same initial joint-column width').toBeLessThan(2)
          const name = `nested:${branches}-branches:${gesture}:${round}`
          observations.push({ name, position, mountedJointGrids: await page.locator('[data-program-grid="joints"]').count() })
          const profile = profiler && branches === 10 && gesture === 'scroll' && round === 1
          if (profile) await profiler.send('Profiler.start')
          if (gesture === 'scroll') await probe.scroll(name, grid.locator('.ag-grid-viewport').first())
          else await probe.resize(name, grid, 'joint')
          if (profile) await writeFile(info.outputPath('nested-scroll.cpuprofile'), JSON.stringify((await profiler.send('Profiler.stop')).profile))
        }
      }

      // No settle between the last native wheel and closing. A deferred AG
      // scroll callback may encounter its retained detail already hidden.
      await page.locator('[data-program-grid="stamps"]').evaluate(element => {
        window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 100, behavior: 'instant' })
      })
      const firstDisclosure = page.getByRole('button', { name: `Клеймо ${stamps[0]}`, exact: true })
      await expect(firstDisclosure).toBeInViewport()
      await page.waitForTimeout(300)
      const viewport = await grid.locator('.ag-grid-viewport').first().boundingBox()
      expect(viewport).not.toBeNull()
      await page.mouse.move(viewport!.x + Math.min(250, viewport!.width / 2), Math.max(120, viewport!.y + 150))
      await page.mouse.wheel(0, 32)
      await firstDisclosure.click()
      await expect(firstDisclosure).toHaveAttribute('aria-expanded', 'false')
      for (let round = 0; round < 3; round++) {
        await probe.measure(`nested:${branches}-branches:closed-idle:${round}`, async () => {
          const started = await page.evaluate(() => {
            (window as unknown as { nestedGridIntervalAudit: IntervalAudit }).nestedGridIntervalAudit.ticks10 = 0
            return performance.now()
          })
          await page.waitForTimeout(2000)
          const idle = await page.evaluate(started => {
            const state = (window as unknown as { nestedGridIntervalAudit: IntervalAudit }).nestedGridIntervalAudit
            return { observationMs: performance.now() - started, ticks10: state.ticks10,
              active10: [...state.active.values()].filter(delay => delay === 10).length,
              partners: [...document.querySelectorAll<HTMLElement>('[data-program-grid="joints"] .ag-body-vertical-scroll-viewport')].map(element => ({
                context: element.closest<HTMLElement>('[data-program-grid]')?.dataset.programGridContext,
                measurable: element.checkVisibility({ checkVisibilityCSS: true }),
                scrollTop: element.scrollTop, clientHeight: element.clientHeight,
              })) }
          }, started)
          observations.push({ branches, closedStamp: stamps[0], round, idle })
          if (process.env.SMOOTHNESS_ASSERT_IDLE === '1') expect(idle.active10).toBe(0)
        })
      }
    }
  } finally {
    try {
      await writeFile(info.outputPath('nested-grid-observations.json'), JSON.stringify({
        label: process.env.SMOOTHNESS_LABEL, project, line, stamps, jointsPerStamp: 100, observations,
      }, null, 2))
      await probe.finish()
    } finally {
      try { await page.close() } finally {
        // A collision/failed transaction must not delete pre-existing records.
        if (stampIds.length) {
          await cleanupLineProgramProjects([project])
          await withLineProgramFixture(db => db.query('delete from welder_stamps where id=any($1::int[])', [stampIds]))
        }
      }
    }
  }
})
