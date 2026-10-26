import { expect, test } from '@playwright/test'
import pg from 'pg'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { readReportOutputSnapshot, visitReportOutput } from '../../src/server/weld-read'
import { captureReportExcel } from '../report-excel-capture'
import { rpcName } from '../rpc'

const project = 'E2E output snapshot'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function fixture() {
  await withLineProgramFixture(async db => {
    const { rows: [row] } = await db.query(`insert into weld_joints(project_title,line,joint,isometry,connection_type,
      weld_date,officiality,revision_actuality,psto_required,has_vik) values($1,'SNAP','SNAP-BEFORE','before','С17','2026-09-01','действующий','актуальная','да','да') returning id`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date)
      values($1,'ВИК','before','2026-09-02')`, [row.id])
  })
}

test('complete download keeps one database snapshot across batches and sees later changes on the next download', async () => {
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,line,joint,isometry,connection_type,weld_date,officiality,revision_actuality,has_vik)
      select $1,'BATCH','BATCH-'||lpad(n::text,4,'0'),'before','С17','2026-09-01','действующий','актуальная','да'
      from generate_series(1,2001) n`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date)
      select id,'ВИК','before','2026-09-02' from weld_joints where project_title=$1 and joint='BATCH-2001'`, [project])
  })
  const input = { report: 'lnk' as const, fieldKeys: ['joint', 'isometry', 'preVikRequest'],
    columnFilters: { search: project }, sort: { fieldKey: 'joint' as const, direction: 'asc' as const } }
  const batches: Array<Array<Array<string | number>>> = []
  await visitReportOutput(input, async content => {
    batches.push(content.report.tables?.[0]?.rows ?? [])
    if (batches.length === 1) await withLineProgramFixture(async db => {
      await db.query(`update weld_joints set isometry='after' where project_title=$1 and joint='BATCH-2001'`, [project])
      await db.query(`update pre_heat_treatment_controls set request_name='after'
        where weld_joint_id in(select id from weld_joints where project_title=$1 and joint='BATCH-2001')`, [project])
    })
  })
  expect(batches.map(batch => batch.length)).toEqual([1000, 1000, 1])
  expect(batches[2][0]).toEqual(['BATCH-2001', 'before', 'before'])
  const fresh = await readReportOutputSnapshot({ ...input, columnFilters: { search: 'BATCH-2001' } })
  expect(fresh.report.tables![0].rows[0]).toEqual(['BATCH-2001', 'after', 'after'])
  const controller = new AbortController()
  let cancelledBatches = 0
  await expect(visitReportOutput(input, async () => { cancelledBatches++; controller.abort() }, controller.signal)).rejects.toThrow()
  expect(cancelledBatches).toBe(1)
  expect((await readReportOutputSnapshot({ ...input, columnFilters: { search: 'BATCH-2001' } })).sourceRows).toBe(1)
})

test('a special preview finds matching rows beyond the source preview boundary', async () => {
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,line,joint,connection_type,weld_date,officiality,revision_actuality,
      has_vik,vik_result,has_rk,rk_request,rk_request_date)
      select $1,'TAIL','TAIL-'||lpad(n::text,4,'0'),'С17','2026-09-01','действующий','актуальная',
        'да','годен',case when n=3001 then 'да' else 'нет' end,
        case when n=3001 then 'TAIL-REQUEST' else null end,case when n=3001 then date '2026-09-02' else null end
      from generate_series(1,3001) n`, [project])
  })
  const snapshot = await readReportOutputSnapshot({ report: 'lnk', kind: 'waitingNk' })
  expect(snapshot.truncated).toBe(false)
  expect(snapshot.report.tables!.flatMap(table => table.rows.flat())).toContain('TAIL-3001')
})
async function change() {
  await withLineProgramFixture(async db => {
    await db.query('update weld_joints set isometry=$2, joint=$3 where project_title=$1', [project, 'after', 'SNAP-AFTER'])
    await db.query(`update pre_heat_treatment_controls set request_name='after'
      where weld_joint_id in (select id from weld_joints where project_title=$1)`, [project])
  })
}

for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
  test(`${report}: output facts and relations share a snapshot while another save commits`, async () => {
    await fixture()
    const input = { report, fieldKeys: ['joint', 'isometry', 'preVikRequest'], columnFilters: { search: project } }
    await readReportOutputSnapshot(input)
    const original = pg.Client.prototype.query
    let committed = false, reads = 0
    try {
      pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
        const statement = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string }).text ?? ''
        if (statement.startsWith('select')) reads++
        if (committed || !statement.includes('from "weld_joints"') || !statement.includes('"connection_type"')) {
          return (original as (...values: unknown[]) => unknown).apply(this, args)
        }
        committed = true
        // Delay delivery of the facts until a concurrent writer commits newer
        // relations. Both promise and Pool callback query paths are covered.
        const callback = args.at(-1)
        if (typeof callback === 'function') {
          args[args.length - 1] = (error: Error | null, result: unknown) => {
            if (error) { callback(error); return }
            void change().then(() => callback(null, result), failure => callback(failure))
          }
          return (original as (...values: unknown[]) => unknown).apply(this, args)
        }
        return Promise.resolve((original as (...values: unknown[]) => unknown).apply(this, args)).then(async result => {
          await change(); return result
        })
      } as typeof original
      const old = await readReportOutputSnapshot(input)
      pg.Client.prototype.query = original
      expect(committed).toBe(true)
      expect(old.report.tables![0].rows).toHaveLength(1)
      expect(old.report.tables![0].rows[0]).toEqual(['SNAP-BEFORE', 'before', 'before'])
      expect(Number.isFinite(Date.parse(old.generatedAt))).toBe(true)
      expect(reads).toBeLessThanOrEqual(30)
      const fresh = await readReportOutputSnapshot(input)
      expect(fresh.report.tables![0].rows[0]).toEqual(['SNAP-AFTER', 'after', 'after'])
      expect(Date.parse(fresh.generatedAt)).toBeGreaterThan(Date.parse(old.generatedAt))
    } finally { pg.Client.prototype.query = original }
  })

  test(`${report}: background refresh keeps preview and print frozen; Excel reads fresh data and reopening refreshes preview`, async ({ page }) => {
    await fixture()
    const calls: string[] = []
    page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
    await page.goto(report === 'weldingJournal' ? '/journal' : report === 'lnk' ? '/lnk' : '/psto')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    const grid = page.locator(report === 'weldingJournal' ? '[data-welding-journal-grid]' : report === 'lnk' ? '[data-lnk-grid]' : '[data-psto-grid]')
    await expect(grid.getByText('SNAP-BEFORE', { exact: true })).toBeVisible()
    await expect(grid.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
    const open = async () => {
      await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
      await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
    }
    await open()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    const body = preview.frameLocator('iframe').locator('tbody')
    await expect(body).toContainText('SNAP-BEFORE')
    const time = await preview.locator('time').getAttribute('datetime')
    const snapshotLabel = await page.evaluate(value => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value!)), time)
    await expect(preview.frameLocator('iframe').locator('.meta')).toContainText(snapshotLabel)
    const countOutputs = () => calls.filter(name => name.startsWith('readReportOutputSnapshot')).length
    expect(countOutputs()).toBe(1)
    await change()
    // The normal return-to-window flow detects and recalculates the new revision.
    // ReportBackground deliberately freezes its rendering while a modal is open;
    // only after closing should the refreshed table become visible.
    const refreshed = page.waitForResponse(response => response.url().includes('/_serverFn/') &&
      rpcName(response.url()).startsWith('refreshDispatcherTaskSnapshot') && response.ok())
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await (await refreshed).finished()
    await expect(preview).toBeVisible()
    await expect(body).toContainText('SNAP-BEFORE')
    await expect(body).not.toContainText('SNAP-AFTER')
    await expect(preview.locator('time')).toHaveAttribute('datetime', time!)
    const book = await captureReportExcel(page, preview)
    const values = Object.values(book.Sheets).flatMap(sheet => Object.entries(sheet).filter(([key]) => !key.startsWith('!')).map(([, cell]) => cell.v))
    expect(values).toContain('SNAP-AFTER'); expect(values).not.toContain('SNAP-BEFORE')
    await preview.locator('iframe').evaluate((element: HTMLIFrameElement) => {
      element.contentWindow!.print = () => { document.body.dataset.snapshotPrint = element.contentDocument!.body.textContent ?? '' }
    })
    await preview.getByRole('button', { name: 'Печать / Сохранить PDF', exact: true }).click()
    expect(await page.locator('body').getAttribute('data-snapshot-print')).toContain('SNAP-BEFORE')
    expect(await page.locator('body').getAttribute('data-snapshot-print')).not.toContain('SNAP-AFTER')
    expect(countOutputs()).toBe(1)
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    await expect(grid.getByText('SNAP-AFTER', { exact: true })).toBeVisible()
    await expect(grid.locator('.journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
    await open()
    await expect(body).toContainText('SNAP-AFTER')
    await expect(body).not.toContainText('SNAP-BEFORE')
    expect(countOutputs()).toBe(2)
    expect(Date.parse((await preview.locator('time').getAttribute('datetime'))!)).toBeGreaterThan(Date.parse(time!))
  })
}
