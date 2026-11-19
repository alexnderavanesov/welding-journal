import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { createSmoothnessProbe } from '../smoothness-probe'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'
import { isAccountRefreshRpc, rpcName } from '../rpc'

// The registry/filter/archive already have changed-table-smoothness coverage.
// This adds the missing moderate PDF workflow; no extreme-density fixture.
test.skip(!process.env.SMOOTHNESS_LABEL || process.env.E2E_SCHEME_SMOOTHNESS !== '1', 'Explicit local PDF performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 15_000 })
const trackProject = schemeFixtureCleanup(test)

async function fixture(page: Page, info: TestInfo, texts: boolean) {
  const project = `E2E PDF smooth ${randomUUID()}`, line = texts ? 'TEXT-20' : 'PDF-60'
  trackProject(info, project)
  const lineId = await withLineProgramFixture(async db => {
    const id = (await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values($1,'SM',$2,'unassigned') returning id", [project, line])).rows[0].id as number
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,vik_result,psto_required)
      select $1,$2,'SM',$3,'P'||n,'действующий','актуальная','С17','2026-11-01','Да','годен','Нет' from generate_series(1,100) n`, [id, project, line])
    await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1", [id])
    return id
  })
  const pdf = await PDFDocument.create()
  for (let sheet = 0; sheet < 2; sheet++) {
    const leaf = pdf.addPage([1191, 842])
    for (let n = 0; n < 120; n++) leaf.drawLine({ start: { x: 40 + n * 9, y: 80 }, end: { x: 70 + n * 9, y: 760 }, thickness: .35 })
  }
  await page.goto('/line-schemes'); await filterSchemeProject(page, project)
  const row = page.getByRole('row').filter({ hasText: project }), chooser = page.waitForEvent('filechooser')
  await row.getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await chooser).setFiles({ name: 'Smoothness.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
  await page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const drawing = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
  await expect(drawing.locator('[data-scheme-point-layer="1"]')).toBeVisible()
  await drawing.getByRole('button', { name: 'Закрыть схему', exact: true }).click()
  await expect.poll(() => page.workers().length).toBe(0)
  await page.waitForLoadState('networkidle')
  await withE2eDatabase(async db => {
    const revision = (await db.query('select active_revision_id from line_scheme_bundles where line_program_id=$1', [lineId])).rows[0].active_revision_id as string
    await db.query('insert into line_scheme_physicals(seed_node_id,last_label,last_line_program_id) select id,joint,$1 from weld_joints where line_program_id=$1 order by id limit 60', [lineId])
    await db.query('insert into line_scheme_members(weld_joint_id,physical_id) select seed_node_id,id from line_scheme_physicals where last_line_program_id=$1', [lineId])
    await db.query(`insert into line_scheme_points(id,revision_id,physical_id,page,x,y)
      select md5('smooth-point-'||$3||rn)::uuid::text,$1,id,1,.08+(rn%10)*.09,.55+(rn/10)*.07
      from (select id,(row_number() over(order by id)-1)::integer rn from line_scheme_physicals where last_line_program_id=$2) p`, [revision, lineId, line])
    await db.query(`insert into line_scheme_dimensions(id,revision_id,from_point_id,to_point_id,page,distance_mm,offset_x,offset_y)
      select md5('smooth-dimension-'||$2||rn)::uuid::text,$1,least(id,next),greatest(id,next),1,1000,0,-.012
      from (select id,lead(id) over(order by physical_id) next,row_number() over(order by physical_id) rn from line_scheme_points where revision_id=$1) p where rn%2=1`, [revision, line])
    await db.query(`insert into line_scheme_annotations(id,revision_id,page,x,y,shape,label,color,size,stroke_width,rotation)
      select md5('smooth-symbol-'||$2||n)::uuid::text,$1,1,.08+(n%10)*.09,.08+(n/10)*.1,
      case n%3 when 0 then 'triangle' when 1 then 'line' else 'dot' end,'Опора '||n,'#0284c7',24,2,0 from generate_series(0,19) n`, [revision, line])
    if (texts) await db.query(`insert into line_scheme_annotations(id,revision_id,page,x,y,shape,label,color,size,stroke_width,rotation,leader_x,leader_y,text_width,text_height)
      select md5('smooth-text-'||n)::uuid::text,$1,1,.14+(n%5)*.18,.25+(n/5)*.09,'text','Примечание '||(n+1),'#111827',24,1,90,
      .1+(n%5)*.18,.25+(n/5)*.09,96,34 from generate_series(0,19) n`, [revision])
  })
  // Setup is unmeasured. Reload clears the earlier empty annotation response.
  await page.reload(); await filterSchemeProject(page, project)
  return { drawing, open: () => row.getByRole('button', { name: 'Smoothness', exact: true }).click() }
}

for (const texts of [false, true]) test(texts ? 'PDF current-only: 20 text notes, zoom and resize' : 'PDF comparable: 60 points, 20 symbols, 30 dimensions, zoom and pan', async ({ page }, info) => {
  test.skip(info.project.name === 'webkit', 'Primary Chrome measurements; functional PDF workflows cover WebKit separately.')
  test.skip(texts && process.env.E2E_SCHEME_SMOOTHNESS_TEXT !== '1', 'Unpaired current-only text profile; never enable on HEAD without text support.')
  test.setTimeout(180_000)
  const { drawing, open } = await fixture(page, info, texts), probe = await createSmoothnessProbe(page, info)
  const rpc: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) rpc.push(rpcName(request.url()).replace(/_createServerFn_handler$/, '')) })
  const prefix = texts ? 'pdf:current-only:text20' : 'pdf:comparable'
  const bounded = async () => {
    await expect(drawing.locator('[data-scheme-point]')).toHaveCount(60)
    await expect(drawing.locator('[data-scheme-annotation]')).toHaveCount(texts ? 40 : 20)
    await expect(drawing.locator('[data-scheme-dimension]')).toHaveCount(30)
    expect(await drawing.locator('*').count()).toBeLessThan(6000)
    await expect(drawing.locator('canvas[data-pdf-rendered="preview"]')).toHaveCount(1)
    expect(await drawing.locator('canvas[data-pdf-rendered="detail"]').count()).toBeLessThanOrEqual(1)
  }
  const local = async (name: string, run: () => Promise<void>) => {
    const from = rpc.length
    await probe.measure(`${prefix}:${name}`, run)
    const calls = rpc.slice(from)
    // A gesture may straddle the existing lease/account timer. No drawing
    // reads, saves or recalculations are permitted by the gesture itself.
    expect(calls.filter(name => name !== 'keepLineSchemeLease' && !isAccountRefreshRpc(name))).toEqual([])
    expect(calls.filter(name => name === 'keepLineSchemeLease').length).toBeLessThanOrEqual(1)
    expect(calls.filter(isAccountRefreshRpc).length).toBeLessThanOrEqual(1)
    await bounded()
  }
  try {
    await probe.measure(`${prefix}:open`, async () => {
      await open(); await expect(drawing.locator('[data-scheme-point-layer="1"]')).toBeVisible()
      await expect(drawing.getByRole('button', { name: 'Обновить состояния', exact: true })).toBeEnabled()
      await bounded()
    })
    await page.waitForLoadState('networkidle')
    const stage = drawing.getByLabel('Чертёж PDF', { exact: true }), sheet = drawing.locator('.line-scheme-pdf-sheet')
    for (let round = 0; round < 3; round++) {
      await drawing.getByRole('button', { name: 'Весь лист', exact: true }).click()
      const area = (await stage.boundingBox())!, width = (await sheet.boundingBox())!.width
      await page.mouse.move(area.x + area.width * .5, area.y + area.height * .5)
      await local(`zoom:${round}`, async () => {
        await page.keyboard.down('Control')
        try { for (let n = 0; n < 12; n++) await page.mouse.wheel(0, -10) }
        finally { await page.keyboard.up('Control') }
        await expect.poll(async () => (await sheet.boundingBox())!.width / width).toBeGreaterThan(1.5)
      })
      const origin = await stage.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))
      await local(`pan:${round}`, async () => {
        for (let n = 0; n < 12; n++) await page.mouse.wheel(20, 20)
        await expect.poll(() => stage.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).not.toEqual(origin)
        for (let n = 0; n < 12; n++) await page.mouse.wheel(-20, -20)
      })
    }
    await drawing.getByRole('button', { name: 'Весь лист', exact: true }).click()
    if (texts) {
      await drawing.getByRole('tab', { name: /^Текст/ }).click()
      const note = drawing.locator('.line-scheme-text').filter({ hasText: /^Примечание 1$/ })
      await note.click()
      for (let round = 0; round < 3; round++) {
        const grip = (await note.locator('[data-text-resize="e"]').boundingBox())!, width = await note.evaluate(node => (node as HTMLElement).offsetWidth)
        await local(`resize:${round}`, async () => {
          await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down()
          try {
            await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 35, { steps: 30 })
            expect(await note.evaluate(node => (node as HTMLElement).offsetWidth)).toBeGreaterThan(width + 10)
            await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2, { steps: 30 })
          }
          finally { await page.mouse.up() }
          expect(Math.abs(await note.evaluate(node => (node as HTMLElement).offsetWidth) - width)).toBeLessThan(2)
        })
      }
    } else {
      await drawing.getByRole('tab', { name: /^Размеры/ }).click()
      for (let round = 0; round < 3; round++) await local(`dimension-input:${round}`, async () => {
        await drawing.getByRole('button', { name: /^Размер / }).first().click()
        const input = drawing.getByLabel('Расстояние, мм', { exact: true })
        await input.fill('1250'); await input.press('Escape')
        await expect(input).toHaveCount(0)
        await expect(drawing.getByRole('button', { name: /^Сохранить/ })).toBeDisabled()
      })
    }
  } finally { await probe.finish() }
})
