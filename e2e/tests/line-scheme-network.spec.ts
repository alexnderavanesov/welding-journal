import { expect, test, type Page, type Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { cleanupLineSchemeProjects } from '../line-scheme-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'
import { rpcName } from '../rpc'
import { auditSqlCount } from '../audit-sql'

const shortName = (url: string) => rpcName(url).replace(/_createServerFn_handler$/, '')
const schemeRpc = (name: string) => /^(getLineScheme|openLineScheme|keepLineSchemeLease|saveLineScheme|changeLineScheme|updateLineScheme)/.test(name)
type Call = { name: string; url: string; at: number }
function watch(page: Page) {
  const calls: Call[] = [], pending = new Set<Request>()
  let last = 0
  page.on('request', request => {
    const url = new URL(request.url())
    const name = url.pathname.includes('/_serverFn/') ? shortName(request.url())
      : url.pathname.startsWith('/api/') ? `${request.method()} ${url.pathname}` : null
    if (!name) return
    calls.push({ name, url: request.url(), at: Date.now() }); pending.add(request); last = Date.now()
  })
  const finished = (request: Request) => { pending.delete(request) }
  page.on('requestfinished', finished); page.on('requestfailed', finished)
  return { calls, settle: () => expect.poll(() => !pending.size && Date.now() - last >= 250, { timeout: 15_000 }).toBe(true) }
}
const count = (calls: Call[]) => Object.fromEntries([...new Set(calls.map(call => call.name))].map(name => [name, calls.filter(call => call.name === name).length]))
const withoutLease = (calls: Record<string, number>) => Object.fromEntries(Object.entries(calls).filter(([name]) => name !== 'keepLineSchemeLease'))
function expectBoundedRegistryReconnect(calls: Record<string, number>) {
  // The registry remains mounted underneath the drawing. Its existing router
  // reconnect policy refreshes data older than 30 seconds once per window.
  // This is separate from the drawing's points and infinite joint-list queries.
  expect(Object.keys(withoutLease(calls)).filter(name => name !== 'getLineSchemes')).toEqual([])
  expect(calls.getLineSchemes ?? 0).toBeLessThanOrEqual(1)
}
function expectOnlyAccountRefresh(calls: Record<string, number>, maximum: number) {
  expect(Object.keys(calls).filter(name => !['refreshAccountActivity', 'getCurrentAccount'].includes(name))).toEqual([])
  expect(Object.values(calls).reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(maximum)
}
async function sqlSnapshot() {
  if (!process.env.AUDIT_SQL_COUNTS_FILE) return undefined
  await auditSqlCount()
  return JSON.parse(await readFile(process.env.AUDIT_SQL_COUNTS_FILE, 'utf8')) as { statements: number; rpcStatements: Record<string, number> }
}

let fixtureProject: string | undefined
test.afterEach(async ({ context }) => {
  if (!fixtureProject) return
  const project = fixtureProject; fixtureProject = undefined
  // Close observers/lease timers even when setup or a measured phase failed.
  try { await Promise.all(context.pages().map(page => page.close())) }
  finally { await cleanupLineSchemeProjects([project]) }
})

test('ordinary PDF: bounded RPC/SQL during idle, gestures, focus, geometry saves and lost-response retry', async ({ page, context }, info) => {
  test.skip(info.project.name === 'webkit', 'Chrome is the primary request/performance target; existing workflow tests cover WebKit.')
  test.setTimeout(180_000)
  const baseline = process.env.E2E_SCHEME_NETWORK_BASELINE === '1'
  const project = `SCHEME-NET-${randomUUID()}`, line = 'NET-250', owner = watch(page)
  fixtureProject = project
  const lineId = await withLineProgramFixture(async db => {
    const id = (await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values($1,'NET',$2,'unassigned') returning id", [project, line])).rows[0].id as number
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,vik_result,psto_required)
      select $1,$2,'NET',$3,'S'||n,'действующий','актуальная','С17','2026-11-01','Да','годен','Нет' from generate_series(1,250) n`, [id, project, line])
    await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1", [id])
    return id
  })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-schemes'); await filterSchemeProject(page, project)
  const pdf = await PDFDocument.create()
  for (let sheet = 0; sheet < 3; sheet++) {
    const leaf = pdf.addPage([1191, 842])
    for (let n = 0; n < 60; n++) leaf.drawLine({ start: { x: 40 + n * 15, y: 80 }, end: { x: 100 + n * 15, y: 720 }, thickness: .5 })
  }
  let uploads = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/line-scheme-file')) uploads++ })
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await chooser).setFiles({ name: 'Ordinary network.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
  await page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const drawing = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
  await expect(drawing.locator('canvas[data-pdf-rendered="preview"]')).toBeVisible()
  await owner.settle(); expect(uploads).toBe(1)
  await drawing.getByRole('button', { name: 'Закрыть схему', exact: true }).click(); await owner.settle()
  const fixture = await withE2eDatabase(async db => {
    const revisionId = (await db.query('select active_revision_id from line_scheme_bundles where line_program_id=$1', [lineId])).rows[0].active_revision_id as string
    await db.query(`insert into line_scheme_physicals(seed_node_id,last_label,last_line_program_id)
      select id,joint,$1 from weld_joints where line_program_id=$1 order by id limit 20`, [lineId])
    await db.query('insert into line_scheme_members(weld_joint_id,physical_id) select seed_node_id,id from line_scheme_physicals where last_line_program_id=$1', [lineId])
    const points = (await db.query<{ id: string }>(`insert into line_scheme_points(id,revision_id,physical_id,page,x,y)
      select md5($1||id::text)::uuid::text,$1,id,1,.12+(rn%5)*.17,.18+(rn/5)*.16
      from (select id,(row_number() over(order by id)-1)::integer rn from line_scheme_physicals where last_line_program_id=$2) p returning id`, [revisionId, lineId])).rows.map(p => p.id)
    const [from, to] = points.slice(0, 2).sort(), dimensionId = randomUUID()
    await db.query('insert into line_scheme_dimensions(id,revision_id,from_point_id,to_point_id,page,distance_mm,offset_x,offset_y) values($1,$2,$3,$4,1,1250,0,-.06)', [dimensionId, revisionId, from, to])
    return { revisionId, dimensionId }
  })
  const viewerPage = await context.newPage(), viewer = watch(viewerPage)
  const metrics: { phase: string; ms: number; owner: Record<string, number>; viewer: Record<string, number>; commonOwner: Record<string, number>; commonViewer: Record<string, number>; leaseOffsets: number[]; sql?: Record<string, number>; totalServerSql?: number }[] = []
  const phase = async (name: string, run: () => Promise<void>) => {
    await owner.settle(); await viewer.settle()
    const beforeSql = await sqlSnapshot(), from = owner.calls.length, viewerFrom = viewer.calls.length, started = Date.now()
    await run(); await owner.settle(); await viewer.settle()
    const elapsed = Date.now() - started, afterSql = await sqlSnapshot(), calls = [...owner.calls.slice(from), ...viewer.calls.slice(viewerFrom)]
    const rpcCalls = calls.filter(c => c.url.includes('/_serverFn/'))
    const sql = beforeSql && afterSql ? Object.fromEntries([...new Set(rpcCalls.map(c => c.name))].map(rpc => {
      const url = calls.find(c => c.name === rpc)!.url, id = new URL(url).pathname.split('/').at(-1)!
      return [rpc, (afterSql.rpcStatements[id] ?? 0) - (beforeSql.rpcStatements[id] ?? 0)]
    })) : undefined
    const own = owner.calls.slice(from), other = viewer.calls.slice(viewerFrom)
    const result = { phase: name, ms: elapsed, owner: count(own.filter(c => schemeRpc(c.name))), viewer: count(other.filter(c => schemeRpc(c.name))),
      commonOwner: count(own.filter(c => !schemeRpc(c.name))), commonViewer: count(other.filter(c => !schemeRpc(c.name))),
      leaseOffsets: own.filter(c => c.name === 'keepLineSchemeLease').map(c => c.at - started), sql,
      totalServerSql: beforeSql && afterSql ? afterSql.statements - beforeSql.statements : undefined }
    metrics.push(result)
    if (sql) for (const [rpc, statements] of Object.entries(sql)) expect(statements / calls.filter(c => c.name === rpc).length, `${name}: SQL per ${rpc}`).toBeLessThan(80)
    return result
  }
  const ready = async () => { await expect(drawing.getByRole('button', { name: 'Обновить состояния', exact: true })).toBeEnabled(); await owner.settle() }
  const save = async () => { await drawing.getByRole('button', { name: /^Сохранить/ }).click(); await expect(drawing.getByRole('button', { name: /^Сохранить/ })).toBeDisabled(); await ready() }
  const marker = drawing.getByRole('button', { name: 'Стык S1', exact: true })
  const drag = async () => {
    const box = (await marker.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2 + 12, { steps: 4 }); await page.mouse.up()
    await expect(drawing.getByRole('button', { name: /^Сохранить/ })).toBeEnabled()
  }
  try {
    const opening = await phase('open', async () => {
      await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Ordinary network', exact: true }).click()
      await expect(drawing.locator('[data-scheme-point]')).toHaveCount(20); await ready()
    })
    expect(withoutLease(opening.owner)).toEqual({ openLineScheme: 1, getLineSchemeJoints: 1, getLineSchemePoints: 1 })
    await viewerPage.goto('/line-schemes'); await filterSchemeProject(viewerPage, project)
    await viewerPage.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Ordinary network', exact: true }).click()
    const viewerDrawing = viewerPage.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
    await expect(viewerDrawing.locator('[data-scheme-point]')).toHaveCount(20)
    await expect(viewerDrawing.getByRole('button', { name: 'Проверить доступ', exact: true })).toBeVisible()
    await page.bringToFront()
    const idle = await phase('idle35s', () => page.waitForTimeout(35_000))
    // A 35-second observation can straddle two 30-second timer boundaries.
    // Both are valid; two rapid renewals or any viewer polling are not.
    expect(withoutLease(idle.owner)).toEqual({}); expect(idle.viewer).toEqual({})
    expect(idle.owner.keepLineSchemeLease).toBeGreaterThanOrEqual(1); expect(idle.owner.keepLineSchemeLease).toBeLessThanOrEqual(2)
    if (idle.leaseOffsets.length === 2) expect(idle.leaseOffsets[1] - idle.leaseOffsets[0]).toBeGreaterThan(28_000)
    expectOnlyAccountRefresh(idle.commonOwner, 1); expectOnlyAccountRefresh(idle.commonViewer, 1)
    const gestures = await phase('zoom-pan-hover', async () => {
      const stage = drawing.getByLabel('Чертёж PDF', { exact: true }), box = (await stage.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.keyboard.down('Control'); for (let n = 0; n < 8; n++) await page.mouse.wheel(0, -15); await page.keyboard.up('Control')
      for (let n = 0; n < 8; n++) await page.mouse.wheel(10, 15)
      await stage.click({ position: { x: 60, y: 60 } }); await page.mouse.down(); await page.mouse.move(box.x + 95, box.y + 95, { steps: 5 }); await page.mouse.up()
      await drawing.getByRole('button', { name: 'Весь лист', exact: true }).click()
      await marker.hover(); await expect(page.getByRole('tooltip', { name: 'Сведения о стыке S1', exact: true })).toBeVisible()
      await drawing.locator('[data-scheme-dimension]').hover()
    })
    expect(withoutLease(gestures.owner)).toEqual({}); expect(gestures.viewer).toEqual({})
    expectOnlyAccountRefresh(gestures.commonOwner, 1); expectOnlyAccountRefresh(gestures.commonViewer, 1)
    const focus = await phase('focus-reconnect', async () => {
      await viewerPage.bringToFront(); await page.bringToFront()
      await context.setOffline(true); await context.setOffline(false)
      await page.evaluate(() => { for (let n = 0; n < 3; n++) { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) } })
    })
    expectBoundedRegistryReconnect(focus.owner); expectBoundedRegistryReconnect(focus.viewer)
    // Six deliberately emitted focus/visibility events, plus genuine tab
    // switches. Account checks are reported separately, never hidden as noise.
    // At most the two genuine tab events and one combined synthetic burst.
    for (const [calls, authLimit] of [[focus.commonOwner, baseline ? 12 : 3], [focus.commonViewer, 4]] as const) {
      // The global settings snapshot also becomes stale after 30 seconds;
      // one refresh on reconnect preserves project-setting freshness.
      expect(calls.listAppSettingsSnapshot ?? 0).toBeLessThanOrEqual(1)
      expectOnlyAccountRefresh(Object.fromEntries(Object.entries(calls).filter(([name]) => name !== 'listAppSettingsSnapshot')), authLimit)
    }
    const list = drawing.getByLabel('Список физических стыков', { exact: true })
    const load = await phase('load250Joints', async () => {
      await expect.poll(async () => { await list.evaluate(el => { el.scrollTop = el.scrollHeight }); return drawing.getByRole('button', { name: 'S250', exact: true }).isVisible() }, { timeout: 30_000 }).toBe(true)
      await list.evaluate(el => { el.scrollTop = 0 }); await ready()
    })
    expect(withoutLease(load.owner)).toEqual({ getLineSchemeJoints: 4 })
    await drag()
    const moved = await phase('moveSave', save)
    expect(withoutLease(moved.owner)).toEqual({ saveLineSchemePoints: 1, getLineSchemePoints: 1, ...(baseline ? { getLineSchemeJoints: 5 } : {}) })
    await drawing.locator('[data-scheme-dimension]').click({ button: 'right' })
    await page.getByTestId('context-action-menu').getByRole('button', { name: 'Цвет', exact: true }).click()
    await page.getByRole('button', { name: 'красный', exact: true }).click()
    const styled = await phase('dimensionStyleSave', save)
    expect(withoutLease(styled.owner)).toEqual({ saveLineSchemePoints: 1, getLineSchemePoints: 1, ...(baseline ? { getLineSchemeJoints: 5 } : {}) })
    await list.evaluate(el => { el.scrollTop = 800 })
    await drawing.getByRole('button', { name: 'S21', exact: true }).click()
    await drawing.locator('[data-scheme-point-layer="1"]').click({ position: { x: 300, y: 360 } })
    const placement = await phase('newPlacementSave', save)
    expect(withoutLease(placement.owner)).toEqual({ saveLineSchemePoints: 1, getLineSchemePoints: 1, getLineSchemeJoints: 5 })
    await expect(drawing.locator('[data-scheme-point]')).toHaveCount(21)
    let loseResponse = true
    await page.route('**/_serverFn/**', async route => {
      if (loseResponse && shortName(route.request().url()) === 'saveLineSchemePoints') {
        loseResponse = false; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('connectionfailed')
      } else await route.continue()
    })
    await drag()
    const beforeVersion = await withE2eDatabase(async db => (await db.query('select version from line_scheme_revisions where id=$1', [fixture.revisionId])).rows[0].version as number)
    const fault = await phase('lostSaveResponse', async () => {
      await drawing.getByRole('button', { name: /^Сохранить/ }).click()
      await expect(drawing.getByRole('button', { name: 'Повторить операцию', exact: true })).toBeVisible()
      await page.waitForTimeout(1500)
    })
    expect(withoutLease(fault.owner)).toEqual({ saveLineSchemePoints: 1 })
    const retried = await phase('explicitRetry', async () => { await drawing.getByRole('button', { name: 'Повторить операцию', exact: true }).click(); await expect(drawing.getByRole('button', { name: 'Повторить операцию', exact: true })).not.toBeVisible(); await ready() })
    expect(withoutLease(retried.owner)).toEqual({ saveLineSchemePoints: 1, openLineScheme: 1, getLineSchemePoints: 1, getLineSchemeJoints: 5 })
    expect(await withE2eDatabase(async db => (await db.query('select version from line_scheme_revisions where id=$1', [fixture.revisionId])).rows[0].version)).toBe(beforeVersion + 1)
    await drawing.getByRole('button', { name: 'Закрыть схему', exact: true }).click()
    await viewerDrawing.getByRole('button', { name: 'Закрыть схему', exact: true }).click()
    await owner.settle(); await viewer.settle()
    const closed = await phase('closed', () => page.waitForTimeout(1500))
    expect(closed.owner).toEqual({}); expect(closed.viewer).toEqual({})
    expectOnlyAccountRefresh(closed.commonOwner, 1); expectOnlyAccountRefresh(closed.commonViewer, 1)
    await expect.poll(() => page.workers().length).toBe(0); await expect.poll(() => viewerPage.workers().length).toBe(0)
    expect(errors).toEqual([])
  } finally {
    await viewerPage.close(); await context.setOffline(false)
    await info.attach('scheme-network.json', { body: JSON.stringify({ baseline, joints: 250, visiblePoints: 20, pdfPages: 3, uploads,
      sqlScope: 'sql: per observed /_serverFn RPC including transaction/auth queries; totalServerSql also includes API and autonomous server work; no fixture SQL', metrics }, null, 2), contentType: 'application/json' })
    console.log(`SCHEME_NETWORK ${JSON.stringify({ baseline, metrics })}`)
  }
})
