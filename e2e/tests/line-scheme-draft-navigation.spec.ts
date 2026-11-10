import { expect, test, type Locator } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)
const fixtureStamps = new Map<string, number>()
test.afterEach(async ({}, info) => {
  const id = fixtureStamps.get(info.testId)
  fixtureStamps.delete(info.testId)
  if (id != null) await withE2eDatabase(db => db.query('delete from welder_stamps where id=$1', [id]))
})

test('несохранённая схема: правка стыка поверх PDF, подтверждение переходов и сохранность ввода размера', async ({ page }, info) => {
  test.setTimeout(180_000)
  const project = `E2E scheme draft navigation ${info.project.name} ${info.repeatEachIndex}`, line = 'DRAFT-PDF'
  trackProject(info, project)
  const stamp = `SD${info.project.name.includes('webkit') ? 'W' : 'C'}${info.repeatEachIndex}`
  const lineId = await withLineProgramFixture(async db => {
    const id = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      values ($1,'DRAFT',$2,'II','A',100,100,'unassigned') returning id`, [project, line])).rows[0].id
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality,has_vik,psto_required)
      select $1,$2,'DRAFT',$3,'S'||n,'С','действующий','актуальная','да','нет' from generate_series(1,2) n`, [id, project, line])
    await db.query("update weld_joints set connection_type='С17',material_group='М01',welding_method='РД',d1=57,d2=57,t1=3,t2=3,category='II',group_name='A',weld_control_percent=100,pvk_control_percent=100 where line_program_id=$1 and joint='S1'", [id])
    const permit = { id: 'naks', weldType: 'РД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '108', thicknessFrom: '1', thicknessTo: '10', validFrom: '2026-01-01', validTo: '2027-12-31', note: '', archived: false }
    const savedStamp = await db.query<{ id: number }>('insert into welder_stamps(naks_stamp,welder_name,naks_permits,dls_permits) values ($1,$2,$3,$4) returning id', [stamp, 'Сварщик схемы', JSON.stringify([permit]), JSON.stringify([{ ...permit, id: 'dls', number: 'ДЛС-SCHEME' }])])
    fixtureStamps.set(info.testId, savedStamp.rows[0].id)
    const primary = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality,weld_date,has_vik,vik_result,has_uzk,has_pvk,psto_required,stamp_1_k)
      values ($1,$2,'DRAFT',$3,'S3','С','действующий','актуальная','2026-11-01','да','ремонт','да','да','нет','DRAFT-01') returning id`, [id, project, line])).rows[0].id
    const repair = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality,weld_date,has_vik,vik_result,has_uzk,has_pvk,psto_required,stamp_1_k)
      values ($1,$2,'DRAFT',$3,'S3R1','С','действующий','актуальная','2026-11-02','да','годен','нет','нет','нет','DRAFT-01') returning id`, [id, project, line])).rows[0].id
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id) select id,'primary',id,null from weld_joints where line_program_id=$1 and joint in ('S1','S2','S3')`, [id])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id) values ($1,'repair',$2,$2)`, [repair, primary])
    await db.query(`update weld_joints set vik_request='DRAFT-VIK-'||id,vik_request_date='2026-11-01',vik_conclusion='DRAFT-CONCLUSION-'||id,vik_conclusion_date='2026-11-02' where id=any($1::integer[])`, [[primary, repair]])
    return id
  })
  const pdf = await PDFDocument.create(); pdf.addPage([842, 595]); const buffer = Buffer.from(await pdf.save())
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-schemes'); await filterSchemeProject(page, project)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await chooser).setFiles({ name: 'Draft.pdf', mimeType: 'application/pdf', buffer })
  await page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  const scheme = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true }), layer = scheme.locator('[data-scheme-point-layer="1"]')
  await expect(layer).toBeVisible()
  for (const [joint, x, y] of [['S1', 260, 190], ['S2', 470, 310]] as const) {
    await scheme.getByRole('button', { name: joint, exact: true }).click(); await layer.click({ position: { x, y } })
  }
  const points = scheme.locator('[data-scheme-point]'), first = points.filter({ has: page.locator('[data-scheme-point-label]').filter({ hasText: /^S1$/ }) })
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка S1', exact: true }) })
  const openPicture = async () => { await first.click({ button: 'right' }); await page.getByTestId('context-action-menu').getByRole('button', { name: 'Открыть картину стыка', exact: true }).click(); await expect(picture).toBeVisible() }
  const prompt = page.getByRole('dialog', { name: 'Уйти из схемы линии?', exact: true })
  await scheme.getByRole('button', { name: 'Увеличить PDF', exact: true }).click()
  const initialPosition = (await first.boundingBox())!
  await openPicture(); await picture.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await expect(editor).toBeVisible(); await expect(page).toHaveURL(/\/line-schemes$/); await expect(prompt).not.toBeVisible()
  // A cold scheme entry must load the same reference data as the journal card.
  // It must not rely on a previous visit to the journal to populate stamps.
  for (const name of ['Клеймо_1', 'Клеймо_1 - факт']) {
    const select = editor.getByRole('combobox', { name, exact: true })
    await expect(select.locator(`option[value="${stamp}"]`)).toBeEnabled()
    await select.selectOption(stamp)
  }
  for (const name of ['Проект', 'Шифр', 'Группа трубопровода', 'Категория трубопровода', 'Контроль швов, (%)']) await expect(editor.getByRole('textbox', { name, exact: true })).toHaveAttribute('readonly')
  await expect(editor.getByRole('textbox', { name: 'Линия', exact: true })).toBeEditable()
  await expect(editor.getByRole('textbox', { name: 'Номер листа', exact: true })).toBeEditable()
  await expect(editor.getByRole('textbox', { name: 'Номер ИЗМа', exact: true })).toBeEditable()
  await editor.getByRole('textbox', { name: 'Изометрия', exact: true }).fill('ISO-SCHEME-EDIT')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(editor).not.toBeVisible()
  await expect(points).toHaveCount(2); await expect(scheme.getByRole('button', { name: /^Сохранить/ })).toBeEnabled()
  const afterEdit = (await first.boundingBox())!
  expect(Math.abs(afterEdit.x - initialPosition.x)).toBeLessThan(1); expect(Math.abs(afterEdit.y - initialPosition.y)).toBeLessThan(1)
  expect(await withE2eDatabase(async db => (await db.query("select isometry,stamp_1_k,stamp_1_k_fact from weld_joints where line_program_id=$1 and joint='S1'", [lineId])).rows[0])).toEqual({ isometry: 'ISO-SCHEME-EDIT', stamp_1_k: stamp, stamp_1_k_fact: stamp })
  await openPicture(); await picture.getByRole('button', { name: 'Журнал', exact: true }).click()
  await expect(prompt).toBeVisible(); await prompt.getByRole('button', { name: 'Остаться', exact: true }).click()
  await expect(page).toHaveURL(/\/line-schemes$/); await expect(points).toHaveCount(2)
  await scheme.getByRole('button', { name: 'Открыть картину стыка S3R1: проблема состояния', exact: true }).click()
  const repairPicture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка S3R1', exact: true }) })
  await repairPicture.getByRole('tab', { name: /^Требует действия/ }).click()
  await repairPicture.getByRole('button', { name: 'Показать описание СП-08', exact: true }).locator('..').getByRole('button', { name: 'Открыть программу линии', exact: true }).click()
  await expect(prompt).toBeVisible(); await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/line-schemes$/); await expect(points).toHaveCount(2)
  await scheme.getByRole('tab', { name: /^Размеры/ }).click(); await scheme.getByRole('button', { name: 'Добавить расстояние', exact: true }).click()
  await first.click(); await points.filter({ has: page.locator('[data-scheme-point-label]').filter({ hasText: /^S2$/ }) }).click()
  const input = scheme.locator('[data-scheme-dimension]').getByRole('textbox', { name: 'Расстояние, мм', exact: true })
  await input.fill('4321,5')
  await openPicture(); await picture.getByRole('button', { name: 'Журнал', exact: true }).click()
  await expect(prompt).toBeVisible(); await prompt.getByRole('button', { name: 'Остаться', exact: true }).click()
  await expect(input).toHaveValue('4321,5'); await input.press('Enter')
  await scheme.getByRole('button', { name: /^Сохранить/ }).click(); await expect(scheme.getByRole('button', { name: /^Сохранить/ })).toBeDisabled()
  await openPicture(); await picture.getByRole('button', { name: 'Журнал', exact: true }).click()
  await expect(page).toHaveURL(/\/journal$/); await expect(prompt).not.toBeVisible()
  await page.getByRole('button', { name: 'Схемы линий', exact: true }).click(); await filterSchemeProject(page, project)
  await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Draft', exact: true }).click()
  await expect(points).toHaveCount(2); await expect(scheme.locator('[data-scheme-dimension]')).toContainText(/4[\s\u00a0\u202f]?321,5/)
  const move = async (marker: Locator) => { const box = (await marker.boundingBox())!; await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 48, box.y + 28, { steps: 3 }); await page.mouse.up() }
  await move(first); await expect(scheme.getByRole('button', { name: /^Сохранить/ })).toBeEnabled()
  await openPicture(); await picture.getByRole('button', { name: 'Журнал', exact: true }).click()
  await prompt.getByRole('button', { name: 'Уйти без сохранения', exact: true }).click(); await expect(page).toHaveURL(/\/journal$/)
  expect(errors).toEqual([])
})

test('браузер Назад защищает выбранный PDF, загрузку и неизвестный результат операции', async ({ page }, info) => {
  test.setTimeout(120_000)
  const project = `E2E scheme file navigation ${info.project.name} ${info.repeatEachIndex}`, line = 'FILE-DRAFT'
  trackProject(info, project)
  await withE2eDatabase(async db => {
    await db.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values ($1,'DRAFT',$2,'unassigned')", [project, line])
  })
  const pdf = await PDFDocument.create(); pdf.addPage([842, 595]); const buffer = Buffer.from(await pdf.save())
  await page.goto('/journal'); await page.getByRole('button', { name: 'Схемы линий', exact: true }).click(); await filterSchemeProject(page, project)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('row').filter({ hasText: project }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
  await (await chooser).setFiles({ name: 'File-draft.pdf', mimeType: 'application/pdf', buffer })
  const files = page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true })
  const prompt = page.getByRole('dialog', { name: 'Уйти из схемы линии?', exact: true })
  await page.evaluate(() => history.back()); await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Остаться', exact: true }).click()
  await expect(files.getByText('Новый файл: File-draft.pdf', { exact: true })).toBeVisible()
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), uploading = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/line-scheme-file', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    started(); await gate; await route.continue()
  })
  try {
    await files.getByRole('button', { name: 'Загрузить PDF', exact: true }).click(); await uploading
    await page.evaluate(() => history.back())
    await expect(files.getByRole('alert')).toContainText('Дождитесь завершения операции')
    await expect(prompt).not.toBeVisible(); await expect(page).toHaveURL(/\/line-schemes$/)
  } finally { release() }
  const scheme = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
  await expect(scheme.locator('[data-scheme-point-layer="1"]')).toBeVisible()
  await page.unroute('**/api/line-scheme-file')
  await scheme.getByRole('button', { name: /^Файлы и архив/ }).click()
  await files.getByLabel('Файл схемы', { exact: true }).setInputFiles({ name: 'File-second.pdf', mimeType: 'application/pdf', buffer })
  await page.route('**/api/line-scheme-file', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    await route.fetch(); await route.abort('failed')
  })
  await files.getByRole('button', { name: 'Загрузить новую редакцию', exact: true }).click()
  await expect(files.getByRole('button', { name: 'Повторить операцию', exact: true })).toBeVisible()
  await page.unroute('**/api/line-scheme-file')
  await page.evaluate(() => history.back())
  await expect(files.getByRole('alert')).toContainText('Результат операции не подтверждён')
  await expect(prompt).not.toBeVisible(); await expect(page).toHaveURL(/\/line-schemes$/)
  await files.getByRole('button', { name: 'Повторить операцию', exact: true }).click()
  await expect(files.locator('[data-scheme-revision]')).toHaveCount(2)
  await expect(files.getByRole('alert')).not.toBeVisible()
  await files.getByRole('button', { name: 'Закрыть файлы', exact: true }).click()
  await page.evaluate(() => history.back()); await expect(page).toHaveURL(/\/journal$/)
})
