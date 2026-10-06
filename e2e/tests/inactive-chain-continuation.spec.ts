import { expect, test, type Page, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E inactive chain', lineName = 'INACTIVE-CHAIN', joint = 'F751'
const stamp = 'E2IC'
let dataListSnapshot: { value: string; updated_at: Date } | undefined
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    dataListSnapshot = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
    await db.query(`insert into app_settings(key,value,updated_at) values ('data-list',$1,now())
      on conflict(key) do update set value=excluded.value,updated_at=now()`,
    [JSON.stringify({ weldingTypes: ['РД'], connectionTypes: ['С17'], materialGroups: ['M01'] })])
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits)
      values ($1,'E2E актуальность цепочки','РД','M01','1','1000','1','100','2026-01-01','2026-12-31',$2)`,
    [stamp, JSON.stringify([{ id: 'e2e-inactive-chain', weldType: 'РД', materialGroups: 'M01', diameterFrom: '1', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '100', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }])])
  })
})
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [stamp])
    await db.query("delete from app_settings where key='data-list'")
    if (dataListSnapshot) await db.query("insert into app_settings(key,value,updated_at) values ('data-list',$1,$2)", [dataListSnapshot.value, dataListSnapshot.updated_at])
  })
})

async function seed(withUnofficialRepair = false) {
  return withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ($1,'U',$2,'II','A',10,0) returning id`, [project, lineName])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,connection_type,material_group,welding_method,d1,d2,t1,t2,wdi,stamp_1_k,stamp_1_k_fact,has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,final_status)
      select $1,$2,'U',$3,case when n=1 then $4 else $4||'R1' end,case when n=1 then 'действующий' else 'неофициальный' end,null,'2026-09-01','С17','M01','РД',108,108,4,4,0.42,'A','A','да','годен','IC-VIK','2026-09-01','IC-VIK-C','2026-09-02','да',case when n=1 then 'ремонт' else 'вырез' end,'IC-UZK','2026-09-02','IC-UZK-C','2026-09-03','не годен' from generate_series(1,$5::int) n returning id,joint`, [line.id, project, lineName, joint, withUnofficialRepair ? 2 : 1])
    // Raw fixture SQL bypasses the invalidation performed by application saves.
    await db.query(`update weld_joints set stamp_1_k=$1,stamp_1_z=$1,stamp_1_o=$1,stamp_1_k_fact=$1,stamp_1_z_fact=$1,stamp_1_o_fact=$1 where project_title=$2`, [stamp, project])
    await db.query(`insert into dispatcher_task_index_state(id,source_revision,computed_revision,full_rebuild,updated_at)
      values (1,1,-1,true,now()) on conflict (id) do update
      set source_revision=dispatcher_task_index_state.source_revision+1,full_rebuild=true,updated_at=now()`)
    return rows as Array<{ id: number; joint: string }>
  })
}

async function openPicture(page: Page, id: number) {
  await page.locator(`tr[data-weld-row-id="${id}"]`).getByRole('button', { name: joint, exact: true }).click()
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${joint}`, exact: true }) })
}

test('карточка → неактуальность → нет требования продолжения → возврат актуальности восстанавливает задачу и историю', async ({ page }) => {
  const [{ id }] = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  let picture = await openPicture(page, id)
  await expect(picture.getByRole('region', { name: 'Актуальность по ИЗМу' })).toHaveCount(0)
  await expect(picture.getByRole('region', { name: 'Продолжение цепочки стыка' }).getByRole('button', { name: `Создать ${joint}R1`, exact: true })).toBeVisible()
  await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
  for (const inactive of [true, false]) {
    await page.locator(`tr[data-weld-row-id="${id}"]`).getByRole('button', { name: 'Редактировать', exact: true }).click()
    const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await editor.getByText('Актуальность по ИЗМу', { exact: true }).locator('..').getByRole('combobox').selectOption(inactive ? 'не актуален' : '')
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
    picture = await openPicture(page, id)
    if (inactive) {
      await expect(picture.getByRole('region', { name: 'Актуальность по ИЗМу' }).getByRole('button')).toHaveCount(1)
      await expect(picture.getByRole('button', { name: 'Вернуть актуальность стыку' })).toBeVisible()
      await expect(picture.getByText('Продолжение не требуется', { exact: true })).toBeVisible()
      await expect(picture.getByRole('button', { name: `Создать ${joint}R1`, exact: true })).toHaveCount(0)
      await expect(picture.getByRole('button', { name: 'Врезать катушку досрочно', exact: true })).toHaveCount(0)
    } else {
      await expect(picture.getByRole('region', { name: 'Продолжение цепочки стыка' }).getByRole('button', { name: `Создать ${joint}R1`, exact: true })).toBeVisible()
      await expect(picture.getByRole('region', { name: 'Актуальность по ИЗМу' })).toHaveCount(0)
    }
    await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
    expect(await withE2eDatabase(async db => (await db.query('select uzk_result,uzk_conclusion from weld_joints where id=$1', [id])).rows[0])).toEqual({ uzk_result: 'ремонт', uzk_conclusion: 'IC-UZK-C' })
  }
  expect(errors).toEqual([])
})

test('одиночный неактуальный стык: понятное подтверждение, отмена и возврат скрывают лишние команды без фоновых запросов', async ({ page }) => {
  const [{ id }] = await seed(), calls: string[] = [], errors: string[] = []
  await withE2eDatabase(db => db.query("update weld_joints set revision_actuality='не актуален' where id=$1", [id]))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  const picture = await openPicture(page, id)
  const controls = picture.getByRole('region', { name: 'Актуальность по ИЗМу' })
  await expect(controls.getByRole('button')).toHaveCount(1)
  expect(calls.filter(name => name.startsWith('previewChainActuality_'))).toHaveLength(0)
  for (const cancel of [true, false]) {
    await controls.getByRole('button', { name: 'Вернуть актуальность стыку' }).click()
    const editor = page.getByRole('dialog', { name: 'Вернуть актуальность стыку', exact: true })
    await expect(editor.getByText(`Стык: ${joint}.`, { exact: false })).toContainText('Будет изменено: 1')
    await expect(editor.getByText(/R\/W|Стороны катушки|Записей в цепочке/)).toHaveCount(0)
    await expect(editor.getByRole('button', { name: 'Подтвердить актуальность стыка' })).toBeDisabled()
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    if (cancel) await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
    else {
      await editor.getByRole('checkbox').check()
      await editor.getByRole('button', { name: 'Подтвердить актуальность стыка' }).click()
    }
    await expect(editor).toBeHidden()
    expect(await withE2eDatabase(async db => (await db.query('select revision_actuality from weld_joints where id=$1', [id])).rows[0].revision_actuality)).toBe(cancel ? 'не актуален' : null)
  }
  await expect(controls).toHaveCount(0)
  expect(calls.filter(name => name.startsWith('previewChainActuality_'))).toHaveLength(2)
  expect(calls.filter(name => name.startsWith('setChainActuality_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('listWeldJointChain_'))).toHaveLength(2)
  expect(errors).toEqual([])
})

test('официальный ремонт создаётся рядом с неофициальным тёзкой и наследует обязательный УЗК без результатов', async ({ page }) => {
  const [source, historical] = await seed(true), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  const picture = await openPicture(page, source.id)
  await picture.getByRole('region', { name: 'Продолжение цепочки стыка' }).getByRole('button', { name: `Создать ${joint}R1`, exact: true }).click()
  const rows = () => withE2eDatabase(async db => (await db.query('select id,joint,officiality,has_vik,has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date from weld_joints where project_title=$1 order by id', [project])).rows)
  await expect.poll(async () => (await rows()).length).toBe(3)
  const after = await rows(), created = after.find(row => row.id !== source.id && row.id !== historical.id)
  // A derived waiting label is not an inherited result or a started request.
  expect(created).toMatchObject({ joint: `${joint}R1`, has_vik: 'да', has_uzk: 'да',
    uzk_result: 'ожидает заявку', uzk_request: null, uzk_request_date: null, uzk_conclusion: null, uzk_conclusion_date: null })
  expect(created.officiality).not.toBe('неофициальный')
  expect(after.find(row => row.id === historical.id)).toMatchObject({ officiality: 'неофициальный', uzk_result: 'вырез', uzk_conclusion: 'IC-UZK-C' })
  expect(errors).toEqual([])
})

test('официальность туда и обратно: отмена, два окна, повтор запроса сохраняют факты и одно физическое соединение', async ({ page }) => {
  const [source, repair] = await seed(true)
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  // Initial valid history only. The transition under audit is performed through
  // the real officiality dialog, including its chain-rebuild confirmation.
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='действующий',
    weld_date='2026-09-04',vik_request_date='2026-09-04',vik_conclusion_date='2026-09-04',
    uzk_request_date='2026-09-04',uzk_conclusion_date='2026-09-04',uzk_result='годен',final_status='годен'
    where id=$1`, [repair.id]))
  const assertPhysicalCount = async () => {
    await page.goto('/line-program')
    await page.getByLabel('Поиск программы линий').fill(lineName)
    await expect(page.getByTestId('line-program-card')).toHaveCount(1)
    await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Учитываемых соединений 1', exact: true })).toBeVisible()
  }
  await assertPhysicalCount()
  await page.goto('/lnk')
  await page.getByRole('button', { name: 'Официальность', exact: true }).click()
  const officiality = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await officiality.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await officiality.getByRole('button').filter({ hasText: `${lineName} · ${joint}` }).click()
  await officiality.getByRole('button', { name: /^Неофициальный/ }).click()
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  const rebuild = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Изменить официальность и перестроить цепочку', exact: true }) })
  await expect(rebuild).toContainText(`${joint}R1 -> ${joint}`)
  await rebuild.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await withE2eDatabase(async db => (await db.query('select joint,officiality from weld_joints where id=$1', [source.id])).rows[0]))
    .toEqual({ joint, officiality: 'действующий' })
  expect(calls.filter(name => name.startsWith('applyLnkOfficialityChange_'))).toHaveLength(0)
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await rebuild.getByRole('button', { name: 'Сохранить и перестроить', exact: true }).click()
  await expect(officiality).toBeHidden()
  expect(await withE2eDatabase(async db => (await db.query('select id,joint,officiality,uzk_result from weld_joints where id=any($1::int[]) order by id', [[source.id, repair.id]])).rows)).toEqual([
    { id: source.id, joint, officiality: 'неофициальный', uzk_result: 'ремонт' },
    { id: repair.id, joint, officiality: null, uzk_result: 'годен' },
  ])
  await assertPhysicalCount()
  await expect(page.getByTestId('program-finished-label')).toBeVisible()
  await page.goto('/statistics')
  await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
  await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
  await page.getByRole('button', { name: 'Стыки', exact: true }).click()
  await expect(page.getByText('1 выполнено из 1', { exact: true })).toBeVisible()
  expect(calls.filter(name => name.startsWith('applyLnkOfficialityChange_'))).toHaveLength(1)
  expect(calls.filter(name => name.startsWith('previewLnkOfficialityChange_'))).toHaveLength(2)

  const facts = () => withE2eDatabase(async db => (await db.query(`select id,weld_date,
    vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,
    uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date
    from weld_joints where project_title=$1 order by id`, [project])).rows)
  const beforeRestore = await facts()
  const openRestore = async (tab: Page) => {
    await tab.goto('/lnk')
    await tab.getByRole('button', { name: 'Официальность', exact: true }).click()
    const dialog = tab.getByRole('dialog').filter({ has: tab.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
    await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
    await dialog.getByRole('button').filter({ hasText: `${lineName} · ${joint}` }).click()
    await dialog.getByRole('button', { name: /^Официальный/ }).click()
    await dialog.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
    const confirmation = tab.getByRole('dialog').filter({ has: tab.getByRole('heading', { name: 'Изменить официальность и перестроить цепочку', exact: true }) })
    await expect(confirmation).toContainText(`${joint} -> ${joint}R1`)
    return { dialog, confirmation }
  }
  const first = await openRestore(page)
  await first.confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await facts()).toEqual(beforeRestore)
  expect(calls.filter(name => name.startsWith('applyLnkOfficialityChange_'))).toHaveLength(1)
  await first.dialog.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(first.confirmation).toBeVisible()
  const secondPage = await page.context().newPage()
  secondPage.on('pageerror', error => errors.push(error.message))
  const second = await openRestore(secondPage)
  const write = page.waitForRequest(request => request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('applyLnkOfficialityChange_'))
  await first.confirmation.getByRole('button', { name: 'Сохранить и перестроить', exact: true }).click()
  await expect(first.dialog).toBeHidden()
  const restored = () => withE2eDatabase(async db => (await db.query(`select w.id,w.joint,w.officiality,s.kind,s.physical_root_id,s.source_row_id
    from weld_joints w join weld_joint_program_states s on s.weld_joint_id=w.id
    where w.project_title=$1 order by w.id`, [project])).rows)
  const expected = [
    { id: source.id, joint, officiality: null, kind: 'primary', physical_root_id: source.id, source_row_id: null },
    { id: repair.id, joint: `${joint}R1`, officiality: null, kind: 'repair', physical_root_id: source.id, source_row_id: source.id },
  ]
  expect(await restored()).toEqual(expected)
  expect(await facts()).toEqual(beforeRestore)
  await second.confirmation.getByRole('button', { name: 'Сохранить и перестроить', exact: true }).click()
  await expect(secondPage.getByText(/изменил|изменён|изменен/).first()).toBeVisible()
  await secondPage.close()
  // Lost response / double submission must not turn the repair into R2.
  const request = await write, headers = await request.allHeaders()
  delete headers['content-length']
  expect(await (await page.request.post(request.url(), { headers, data: request.postData()! })).text()).toMatch(/изменил|изменён|изменен/)
  expect(await restored()).toEqual(expected)
  expect(await facts()).toEqual(beforeRestore)
  await assertPhysicalCount()
  await expect(page.getByTestId('program-finished-label')).toBeVisible()
  await page.goto('/journal')
  const picture = await openPicture(page, source.id)
  await expect(picture.getByText('СП-04', { exact: false })).toHaveCount(0)
  expect(calls.filter(name => name.startsWith('applyLnkOfficialityChange_'))).toHaveLength(2)
  expect(calls.filter(name => name.startsWith('previewLnkOfficialityChange_'))).toHaveLength(4)
  expect(errors).toEqual([])
})

test('перестройка официальности не обходит подтверждение восстановления после удаления катушки', async ({ page }) => {
  const [source, repair] = await seed(true)
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set officiality='действующий',weld_date='2026-09-04',
      vik_request_date='2026-09-04',vik_conclusion_date='2026-09-04',uzk_request_date='2026-09-04',
      uzk_conclusion_date='2026-09-04',uzk_result='годен',final_status='годен' where id=$1`, [repair.id])
    // A completed, then deleted mistaken pair is the initial history. No SQL
    // changes after opening the UI: the attempted bypass uses ordinary clicks.
    const { rows: sides } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date)
      values ($1,'U',$2,$3||'Y1','2026-09-05'),($1,'U',$2,$3||'Y2','2026-09-05') returning id`, [project, lineName, joint])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,replaced_by_coil,replacement_coil_ids)
      values ($1,'primary',$1,true,$2)`, [source.id, sides.map(row => row.id)])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      values ($1,'repair',$2,$2)`, [repair.id, source.id])
    for (const [index, side] of sides.entries()) await db.query(`insert into weld_joint_program_states
      (weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side) values ($1,'coil',$1,$2,$3,$4)`, [side.id, repair.id, source.id, index + 1])
    await db.query('delete from weld_joints where id=any($1::int[])', [sides.map(row => row.id)])
  })
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/lnk')
  await page.getByRole('button', { name: 'Официальность', exact: true }).click()
  const officiality = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await officiality.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await officiality.getByRole('button').filter({ hasText: `${lineName} · ${joint}` }).click()
  await officiality.getByRole('button', { name: /^Неофициальный/ }).click()
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(page.getByText('Сначала завершите проверку ошибочной катушки', { exact: false }).first()).toBeVisible()
  await expect(officiality).toBeVisible()
  expect(calls.filter(name => name.startsWith('applyLnkOfficialityChange_'))).toHaveLength(0)
  expect(await withE2eDatabase(async db => (await db.query(`select w.officiality,s.replaced_by_coil from weld_joints w
    join weld_joint_program_states s on s.weld_joint_id=w.id where w.id=$1`, [source.id])).rows[0]))
    .toEqual({ officiality: 'действующий', replaced_by_coil: true })
})

for (const recovery of ['вернуть ремонт', 'исключить источник'] as const) test(`ДЗ-13 актуальности: отмена безопасна, путь «${recovery}» снимает задачу без потери истории`, async ({ page }) => {
  const [source, repair] = await seed(true), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='действующий',revision_actuality='не актуален',uzk_result='годен',final_status='годен' where id=$1`, [repair.id]))
  const state = () => withE2eDatabase(async db => (await db.query('select id,revision_actuality,uzk_result,uzk_conclusion from weld_joints where project_title=$1 order by id', [project])).rows)
  const before = await state(), active = recovery === 'вернуть ремонт'
  const title = active ? 'Вернуть актуальность цепочке' : 'Сделать цепочку неактуальной'
  for (const cancel of [true, false]) {
    await page.goto('/journal')
    const picture = await openPicture(page, source.id)
    await expect(picture.getByText('ДЗ-13 · Проверить актуальность цепочки', { exact: true })).toBeVisible()
    await picture.getByRole('tab', { name: /^Требует действия/ }).click()
    const actions = picture.getByRole('region', { name: 'Требует действия', exact: true })
    if (active) {
      await actions.getByRole('button', { name: 'Другие действия ДЗ-13', exact: true }).click()
      await page.getByRole('menuitem', { name: title, exact: true }).click()
    } else await actions.getByRole('button', { name: title, exact: true }).click()
    const editor = page.getByRole('dialog', { name: title, exact: true })
    await expect(editor.getByText('Записей в цепочке:', { exact: false })).toContainText('2. Будет изменено: 1')
    await expect(editor.getByRole('button', { name: 'Подтвердить актуальность цепочки' })).toBeDisabled()
    if (!cancel) await editor.getByRole('checkbox').check()
    await editor.getByRole('button', { name: cancel ? 'Отмена' : 'Подтвердить актуальность цепочки', exact: true }).click()
    await expect(editor).toBeHidden()
    if (cancel) expect(await state()).toEqual(before)
  }
  await page.goto('/journal')
  let picture = await openPicture(page, source.id)
  await expect(picture.getByText('ДЗ-13 · Проверить актуальность цепочки', { exact: true })).toHaveCount(0)
  expect((await state()).every(row => (row.revision_actuality !== 'не актуален') === active)).toBe(true)
  // Fully active groups are intentionally quiet. Exclusion starts with the
  // ordinary IZМ field; a mixed group then exposes both resolution choices.
  if (active) {
    await expect(picture.getByRole('region', { name: 'Актуальность по ИЗМу' })).toHaveCount(0)
    await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.locator(`tr[data-weld-row-id="${source.id}"]`).getByRole('button', { name: 'Редактировать', exact: true }).click()
    const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await editor.getByText('Актуальность по ИЗМу', { exact: true }).locator('..').getByRole('combobox').selectOption('не актуален')
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
    picture = await openPicture(page, source.id)
    await expect(picture.getByRole('region', { name: 'Актуальность по ИЗМу' }).getByRole('button')).toHaveCount(2)
  } else {
    // A fully inactive group still has its recovery path after DZ-13 disappears.
    await expect(picture.getByRole('region', { name: 'Актуальность по ИЗМу' }).getByRole('button')).toHaveCount(1)
  }
  const inverse = active ? 'Сделать цепочку неактуальной' : 'Вернуть актуальность цепочке'
  await picture.getByRole('region', { name: 'Актуальность по ИЗМу' }).getByRole('button', { name: inverse, exact: true }).click()
  const restore = page.getByRole('dialog', { name: inverse, exact: true })
  await expect(restore.getByText('Записей в цепочке:', { exact: false })).toContainText(`2. Будет изменено: ${active ? 1 : 2}`)
  await restore.getByRole('checkbox').check()
  await restore.getByRole('button', { name: 'Подтвердить актуальность цепочки' }).click()
  await expect(restore).toBeHidden()
  await expect(picture.getByRole('region', { name: 'Актуальность по ИЗМу' })).toHaveCount(active ? 1 : 0)
  expect((await state()).every(row => (row.revision_actuality === 'не актуален') === active)).toBe(true)
  expect((await state()).map(row => [row.id, row.uzk_result, row.uzk_conclusion])).toEqual(before.map(row => [row.id, row.uzk_result, row.uzk_conclusion]))
  expect(errors).toEqual([])
})

test('актуальность: Escape и устаревшее окно не меняют цепочку; повторная проверка восстанавливает путь', async ({ page }) => {
  const [source, repair] = await seed(true), calls: string[] = [], errors: string[] = []
  const pending = new Set<Request>()
  await withE2eDatabase(db => db.query(`update weld_joints set revision_actuality='не актуален' where id=$1`, [repair.id]))
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request) } })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  await page.goto('/journal')
  const picture = await openPicture(page, source.id), title = 'Сделать цепочку неактуальной'
  const open = picture.locator('aside').getByRole('button', { name: title, exact: true })
  await open.click()
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await expect(dialog.getByRole('checkbox')).toBeVisible()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  expect(calls.filter(name => name.startsWith('previewChainActuality_'))).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden(); await expect(picture).toBeVisible()
  expect(calls.filter(name => name.startsWith('setChainActuality_'))).toHaveLength(0)
  await open.click(); await expect(dialog.getByRole('checkbox')).toBeVisible()
  // Another operator has reactivated the historical repair after this preview.
  await withE2eDatabase(db => db.query(`update weld_joints set revision_actuality=null,updated_at=clock_timestamp() where id=$1`, [repair.id]))
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Подтвердить актуальность цепочки' }).click()
  await expect(dialog.getByRole('alert')).toContainText('изменились')
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  expect(await withE2eDatabase(async db => (await db.query('select revision_actuality from weld_joints where id=$1', [source.id])).rows[0].revision_actuality)).toBeNull()
  await dialog.getByRole('button', { name: 'Повторить проверку' }).click()
  await expect(dialog.getByText('Записей в цепочке:', { exact: false })).toContainText('2. Будет изменено: 2')
  await dialog.getByRole('checkbox').check()
  await expect.poll(() => pending.size).toBe(0)
  const beforeSave = calls.length
  await dialog.getByRole('button', { name: 'Подтвердить актуальность цепочки' }).click()
  await expect(dialog).toBeHidden()
  await expect(picture.getByText('Продолжение не требуется', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Диспетчер задач', { exact: true })).toContainText('Изменения выполняются только после подтверждения.')
  await expect.poll(() => pending.size).toBe(0)
  const afterSave = calls.slice(beforeSave)
  expect(afterSave.filter(name => name.startsWith('setChainActuality_'))).toHaveLength(1)
  expect(afterSave.filter(name => name.startsWith('listWeldJointChain_'))).toHaveLength(1)
  expect(afterSave.filter(name => name.startsWith('getDispatcherTaskSnapshot_'))).toHaveLength(1)
  expect(afterSave.filter(name => name.startsWith('refreshDispatcherTaskSnapshot_'))).toHaveLength(1)
  expect(afterSave.filter(name => name.startsWith('listWeldingJournalPage_')).length).toBeLessThanOrEqual(2)
  expect(afterSave.filter(name => name.startsWith('previewChainActuality_'))).toHaveLength(0)
  expect(calls.filter(name => name.startsWith('setChainActuality_'))).toHaveLength(2)
  expect(await withE2eDatabase(async db => (await db.query('select officiality,uzk_result,uzk_conclusion,revision_actuality from weld_joints where id=$1', [repair.id])).rows[0]))
    .toEqual({ officiality: 'неофициальный', uzk_result: 'вырез', uzk_conclusion: 'IC-UZK-C', revision_actuality: 'не актуален' })
  expect(errors).toEqual([])
})
