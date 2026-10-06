import { expect, test, type Route } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test.afterEach(() => cleanupLineProgramProjects(['E2E system rules']))

// Change only the selected result in a real serialized RPC. Other results,
// row versions, dates and document names must remain exactly as the UI sent them.
function withRejectedRpcResult(body: string, field: 'uzkResult' | 'result') {
  const wire = JSON.parse(body)
  let changed = 0
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const value = node as { k?: unknown[]; v?: Array<{ s?: string }> }
    const index = Array.isArray(value.k) ? value.k.indexOf(field) : -1
    if (index >= 0 && Array.isArray(value.v)) {
      expect(value.v[index].s).toBe('годен')
      value.v[index].s = 'вырез'
      changed++
    }
    Object.values(node).forEach(visit)
  }
  visit(wire)
  expect(changed).toBe(1)
  return JSON.stringify(wire)
}

async function ownControlSnapshot(id: number) {
  return withE2eDatabase(async db => ({
    weld: (await db.query('select * from weld_joints where id=$1', [id])).rows,
    controls: (await db.query('select * from pre_heat_treatment_controls where weld_joint_id=$1 order by id', [id])).rows,
    documents: (await db.query(`select d.*,a.* from generated_documents d
      join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=$1 order by d.id`, [id])).rows,
    sequences: (await db.query("select * from app_settings where key like 'system-document-next-number:%' order by key")).rows,
  }))
}

for (const order of ['одновременно', 'сначала послойный', 'сначала дубль'] as const) {
test(`два окна не сохраняют несовместимые послойный контроль и дубль: ${order}`, async ({ page }) => {
  const joint = 'F704', lineName = 'SYS-LAYERED-RACE'
  const id = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ('E2E system rules','SYS',$1,'II','A',100,100) returning id`, [lineName])
    const { rows: [row] } = await db.query(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,has_pvk,officiality,
      material_group,welding_method,d1,d2,t1,t2,wdi,vik_control_basis,pvk_control_basis,category,group_name,weld_control_percent,pvk_control_percent,
      vik_request,vik_request_date,vik_result,vik_conclusion_date,vik_conclusion,pvk_request,pvk_request_date,pvk_result,pvk_conclusion_date,pvk_conclusion,final_status)
      values ($1,'E2E system rules','SYS',$2,$3,'У17','2026-09-01','A','да','да','действующий',
      'M01','РД',108,108,4,4,0.42,'проект','проект','II','A',100,100,
      'VIK-RACE','2026-09-01','годен','2026-09-02','VIK-RACE-C','PVK-RACE','2026-09-01','годен','2026-09-02','PVK-RACE-C','годен') returning id`, [line.id, lineName, joint])
    return row.id
  })
  const duplicatePage = await page.context().newPage(), errors: string[] = []
  for (const tab of [page, duplicatePage]) tab.on('pageerror', error => errors.push(error.message))
  // Finish initial report-derived updates for the SQL fixture before taking
  // the assignment version; only the two intended writes should race.
  await duplicatePage.goto('/lnk')
  await duplicatePage.waitForLoadState('networkidle')
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(lineName)
  await program.getByRole('button', { name: `Расчёт линии ${lineName}`, exact: true }).click()
  await program.getByRole('button', { name: /^Назначения/ }).last().click()
  const assignments = page.getByRole('dialog', { name: `Назначения · ${lineName}` })
  await assignments.getByLabel(`${joint} · Послойный ПВК`, { exact: true }).selectOption('да')
  await assignments.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  const saveAssignments = assignments.getByRole('button', { name: 'Сохранить назначения', exact: true })
  await expect(saveAssignments).toBeEnabled()
  await duplicatePage.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const duplicate = duplicatePage.getByRole('dialog')
  await duplicate.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await expect(duplicate.getByText('Найдено: 1 · Выбрано: 0', { exact: true })).toBeVisible()
  await duplicate.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await duplicate.getByRole('button', { name: 'РК', exact: true }).click()
  await duplicate.getByRole('combobox', { name: 'Результат', exact: true }).selectOption('годен')
  await duplicate.getByRole('textbox', { name: 'Дата контроля', exact: true }).fill('02.09.2026')
  await duplicate.getByRole('textbox', { name: 'Заключение', exact: true }).fill('SYS-RACE-DUP')
  await duplicate.getByRole('textbox', { name: 'Дата заключения', exact: true }).fill('03.09.2026')
  // Both forms use the old state; exercise concurrency and each deterministic winner.
  const releases: (() => void)[] = [], arrived: string[] = []
  const gates = [0, 1].map(index => new Promise<void>(resolve => { releases[index] = resolve }))
  const isWrite = (url: string) => /^(applyLineProgramControl|saveDuplicateControls)_/.test(rpcName(url))
  for (const [index, tab] of [page, duplicatePage].entries()) await tab.route('**/_serverFn/**', async route => {
    if (isWrite(route.request().url())) { arrived.push(route.request().url()); await gates[index] }
    await route.continue()
  })
  const responses = [page, duplicatePage].map(tab => tab.waitForResponse(response => response.url().includes('/_serverFn/') && isWrite(response.url())))
  try {
    await Promise.all([saveAssignments.click(), duplicate.getByRole('button', { name: 'Добавить дубль', exact: true }).click()])
    await expect.poll(() => arrived.length).toBe(2)
    if (order !== 'одновременно') {
      const first = order === 'сначала послойный' ? 0 : 1
      releases[first]()
      await (await responses[first]).finished()
    }
  } finally { releases.forEach(release => release()) }
  await Promise.all((await Promise.all(responses)).map(response => response.finished()))
  const stored = await withE2eDatabase(async db => (await db.query(`select w.layered_control_assigned as layered,
    (select count(*)::int from duplicate_controls d where d.weld_joint_id=w.id) as duplicates from weld_joints w where w.id=$1`, [id])).rows[0])
  expect([{ layered: true, duplicates: 0 }, { layered: false, duplicates: 1 }]).toContainEqual(stored)
  if (order !== 'одновременно') expect(stored.layered).toBe(order === 'сначала послойный')
  const losingDialog = stored.layered ? duplicate : assignments
  await expect(losingDialog.getByText(/При послойном контроле любой дубль|Послойный контроль несовместим|изменил|изменён|изменен/).first()).toBeVisible()
  expect(errors).toEqual([])
  await duplicatePage.close()
  await page.close()
})
}

test('после выполненного РК можно назначить ПВК, создать заявку и довнести только допустимую дату результата', async ({ page }) => {
  const joint = 'F703', lineName = 'SYS-LATE-PVK'
  const id = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ('E2E system rules','SYS',$1,'II','A',100,100) returning id`, [lineName])
    const { rows: [row] } = await db.query(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,has_rk,officiality,
      material_group,welding_method,d1,d2,t1,t2,wdi,vik_control_basis,rk_control_basis,category,group_name,weld_control_percent,pvk_control_percent,
      vik_request,vik_request_date,vik_result,vik_conclusion_date,vik_conclusion,rk_request,rk_request_date,rk_result,rk_conclusion_date,rk_conclusion)
      values ($1,'E2E system rules','SYS',$2,$3,'СШ','2026-09-01','A','да','да','действующий',
      'M01','РД',108,108,4,4,0.42,'проект','проект','II','A',100,100,
      'VIK-LATE','2026-09-09','годен','2026-09-09','VIK-LATE-C','RK-LATE','2026-09-09','годен','2026-09-12','RK-LATE-C') returning id`, [line.id, lineName, joint])
    return row.id
  })
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(lineName)
  await program.getByRole('button', { name: `Расчёт линии ${lineName}`, exact: true }).click()
  await program.getByRole('button', { name: /^Назначения/ }).last().click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${lineName}` })
  await editor.getByLabel(`${joint} · ПВК`, { exact: true }).selectOption('да')
  await editor.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1')).toBeVisible()
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select has_pvk,rk_result from weld_joints where id=$1', [id])).rows[0])).toEqual({ has_pvk: 'да', rk_result: 'годен' })
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
  await page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).click()
  await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
  await page.getByRole('button', { name: 'Новая заявка', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Дата заявки', { exact: true }).fill('2026-09-09')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.reload()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
  await page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).click()
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
  const resultDialog = page.getByRole('dialog')
  await resultDialog.getByLabel('Метод контроля', { exact: true }).selectOption('pvkRequest')
  await resultDialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
  await resultDialog.getByRole('checkbox', { name: `Выбрать стык ${lineName} ${joint}`, exact: true }).check()
  await resultDialog.getByLabel('Результат для всех выбранных', { exact: true }).selectOption('годен')
  await resultDialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-13')
  await expect(resultDialog.getByText(/позже РК/).first()).toBeVisible()
  const save = resultDialog.getByRole('button', { name: 'Сохранить результат', exact: true })
  await expect(save).toBeDisabled()
  await resultDialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-11')
  await save.click()
  await expect(resultDialog).toBeHidden()
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select pvk_result,pvk_conclusion_date::text,rk_result,rk_conclusion_date::text from weld_joints where id=$1', [id])).rows[0])).toEqual({ pvk_result: 'годен', pvk_conclusion_date: '2026-09-11', rk_result: 'годен', rk_conclusion_date: '2026-09-12' })
  await page.close()
})

for (const beforeHeatTreatment of [false, true]) for (const date of ['2026-09-10', '2026-09-11']) {
  test(`довнесение УЗК ${date} после РК с браком 11 сентября: ${beforeHeatTreatment ? 'до ТО' : 'основной НК'}`, async ({ page }) => {
    const joint = beforeHeatTreatment ? 'F702' : 'F701'
    const createHistoricalRequest = date === '2026-09-11'
    const id = await withE2eDatabase(async db => {
      const { rows: [row] } = await db.query(`insert into weld_joints
        (project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,has_rk,has_uzk,psto_required,officiality,
        material_group,welding_method,d1,d2,t1,t2,wdi,vik_control_basis,rk_control_basis,uzk_control_basis)
        values ('E2E system rules','SYS','SYS-BACKFILL',$1,'СШ','2026-09-01','A','да','да','да',$2,'действующий',
        'M01','РД',108,108,4,4,0.42,'проект','проект','проект') returning id`, [joint, beforeHeatTreatment ? 'да' : null])
      if (beforeHeatTreatment) {
        await db.query(`insert into pre_heat_treatment_controls (weld_joint_id,method,request_name,request_date,result,conclusion_date,conclusion_name)
          values ($1,'ВИК','VIK-BF','2026-09-09','годен','2026-09-09','VIK-BF-C'),
          ($1,'РК','RK-BF','2026-09-09','ремонт','2026-09-11','RK-BF-C'),
          ($1,'УЗК','UZK-BF','2026-09-09','ожидает НК',null,null)`, [row.id])
      } else {
        await db.query(`update weld_joints set vik_request='VIK-BF',vik_request_date='2026-09-09',vik_result='годен',
          vik_conclusion_date='2026-09-09',vik_conclusion='VIK-BF-C',rk_request='RK-BF',rk_request_date='2026-09-09',
          rk_result='ремонт',rk_conclusion_date='2026-09-11',rk_conclusion='RK-BF-C',
          uzk_request='UZK-BF',uzk_request_date='2026-09-09',uzk_result='ожидает НК' where id=$1`, [row.id])
      }
      if (createHistoricalRequest) {
        if (beforeHeatTreatment) await db.query("delete from pre_heat_treatment_controls where weld_joint_id=$1 and method='УЗК'", [row.id])
        else await db.query('update weld_joints set uzk_request=null,uzk_request_date=null,uzk_result=null where id=$1', [row.id])
      }
      return row.id
    })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/lnk')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
    await page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).click()
    if (createHistoricalRequest) {
      await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
      await page.getByRole('button', { name: 'Новая заявка', exact: true }).click()
      const requestDialog = page.getByRole('dialog')
      const requestSave = requestDialog.getByRole('button', { name: beforeHeatTreatment ? 'Создать заявку до ТО' : 'Создать заявку', exact: true })
      await requestDialog.getByLabel('Дата заявки', { exact: true }).fill('2026-09-12')
      await expect(requestSave).toBeDisabled()
      await requestDialog.getByLabel('Дата заявки', { exact: true }).fill('2026-09-09')
      await expect(requestSave).toBeEnabled()
      await requestSave.click()
      await expect(requestDialog).toBeHidden()
      await page.reload()
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
      await page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).click()
    }
    if (beforeHeatTreatment) {
      await page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).locator('xpath=ancestor::tr')
        .getByRole('button', { name: 'Добавить результат ЛНК на этот стык', exact: true }).click()
    } else {
      await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
      await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
    }
    const heading = `Внесение результатов ЛНК${beforeHeatTreatment ? ' до ТО' : ''}`
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
    await dialog.getByLabel('Метод контроля', { exact: true }).selectOption(beforeHeatTreatment ? 'УЗК' : 'uzkRequest')
    if (!beforeHeatTreatment) await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(joint)
    await dialog.getByRole('checkbox', { name: `Выбрать стык SYS-BACKFILL ${joint}`, exact: true }).check()
    const save = dialog.getByRole('button', { name: beforeHeatTreatment ? 'Сохранить результат до ТО' : 'Сохранить результат', exact: true })
    await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-12')
    await dialog.getByLabel('Результат для всех выбранных', { exact: true }).selectOption('годен')
    await expect(dialog.getByText(/выполнен после негодного РК/).first()).toBeVisible()
    await expect(save).toBeDisabled()
    await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-11')
    await dialog.getByLabel('Результат для всех выбранных', { exact: true }).selectOption('вырез')
    await expect(dialog.getByText(/только один негодный результат/).first()).toBeVisible()
    await expect(save).toBeDisabled()
    // Equal dates isolate the single-rejection rule from the independent ban on
    // control after an earlier failure. The successful retry keeps its own date.
    await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-11')
    await dialog.getByLabel('Результат для всех выбранных', { exact: true }).selectOption('годен')
    await expect(save).toBeEnabled()
    await page.waitForLoadState('networkidle')
    const beforeRejectedWrite = await ownControlSnapshot(id)
    const rpc = beforeHeatTreatment ? 'savePreHeatTreatmentLnkWorkflow_' : 'updateWeldJoints_'
    const injectSecondFailure = async (route: Route) => {
      if (!rpcName(route.request().url()).startsWith(rpc)) return route.continue()
      await route.continue({ postData: withRejectedRpcResult(route.request().postData()!, beforeHeatTreatment ? 'result' : 'uzkResult') })
    }
    await page.route('**/_serverFn/**', injectSecondFailure)
    const rejection = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith(rpc))
    await save.click()
    expect(await (await rejection).text()).toContain('только один негодный результат')
    expect(await ownControlSnapshot(id)).toEqual(beforeRejectedWrite)
    await page.unroute('**/_serverFn/**', injectSecondFailure)
    await dialog.getByLabel('Дата контроля', { exact: true }).fill(date)
    await expect(save).toBeEnabled()
    await save.click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => withE2eDatabase(async db => {
      if (beforeHeatTreatment) return (await db.query(`select result,conclusion_date::text as date from pre_heat_treatment_controls where weld_joint_id=$1 and method='УЗК'`, [id])).rows[0]
      return (await db.query('select uzk_result as result,uzk_conclusion_date::text as date from weld_joints where id=$1', [id])).rows[0]
    })).toEqual({ result: 'годен', date })
    if (beforeHeatTreatment && date === '2026-09-11') {
      await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
      await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
      await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК', exact: true })
        .getByRole('button', { name: 'До ТО', exact: true }).click()
      const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК до ТО', exact: true }) })
      await manager.getByLabel('Вид контроля в реестре', { exact: true }).selectOption('УЗК')
      await manager.getByPlaceholder('Стык, линия, заявка или заключение').fill(joint)
      const correctionResult = manager.getByRole('combobox', { name: 'Результат', exact: true })
      await expect(correctionResult).toHaveValue('годен')
      await page.waitForLoadState('networkidle')
      const beforeCorrection = await ownControlSnapshot(id)
      await correctionResult.selectOption('вырез')
      const corrected = page.waitForResponse(response => response.url().includes('/_serverFn/') && rpcName(response.url()).startsWith('correctPreHeatTreatmentLnkResult_'))
      await manager.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
      expect(await (await corrected).text()).toContain('только один негодный результат')
      expect(await ownControlSnapshot(id)).toEqual(beforeCorrection)
      await expect(page.getByText(/только один негодный результат/).first()).toBeVisible()
      await correctionResult.selectOption('годен')
      await expect(manager.getByRole('button', { name: 'Сохранить результат', exact: true })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(manager).toBeHidden()
      expect(await ownControlSnapshot(id)).toEqual(beforeCorrection)
    }
    expect(errors).toEqual([])
    await page.close()
  })
}

test('физическая замена, удаление и позднее согласование в БД, индексе и виртуальном поле', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-line-program-system-rules.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toEqual({ physicalReplacement: true, stableIdsAfterDeletion: true, lateApproval: true, repairOnlyPersistedAndVirtual: true, exclusionRestoresRepairTask: true })
})

test('объяснение загружается только по раскрытию, постранично; обязательный ремонт виден и защищён', async ({ page }) => {
  await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query("insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ('E2E system rules','SYS','SYS-EXPLAIN','II','A',10,10) returning id")
    await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,has_rk,rk_result,weld_control_percent,pvk_control_percent,category,group_name)
      select $1,'E2E system rules','SYS','SYS-EXPLAIN','F'||n,'С17','2026-09-01','SYS-A','да',case when n=1 then 'да' end,case when n=1 then 'ремонт' end,10,10,'II','A' from generate_series(1,55) n`, [line.id])
    await db.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,has_rk,weld_control_percent,pvk_control_percent,category,group_name)
      values ($1,'E2E system rules','SYS','SYS-EXPLAIN','F1R1','С17','2026-09-02','SYS-B','да','да',10,10,'II','A')`, [line.id])
  })
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const reads = () => calls.filter(name => name.startsWith('getLineProgramExplanation_')).length
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill('SYS-EXPLAIN')
  await program.getByRole('button', { name: 'Расчёт линии SYS-EXPLAIN', exact: true }).click()
  await program.getByRole('button', { name: 'Расчёт линии', exact: true }).click()
  expect(reads()).toBe(0)
  const calculation = page.getByRole('dialog', { name: 'Расчёт · SYS-EXPLAIN' })
  const explanation = calculation.getByRole('region', { name: 'Подробности расчёта' })
  await calculation.getByTestId('demand-common').getByRole('button', { name: /^Текущая потребность с учётом предела/ }).click()
  await expect(explanation).toContainText('SYS-A: 55 × 10% → база 6')
  await expect(explanation.getByRole('button', { name: /^Показать стык .* в журнале$/ })).toHaveCount(50)
  expect(reads()).toBe(1)
  await explanation.getByRole('button', { name: 'Страница 2', exact: true }).click()
  await expect(explanation.getByRole('button', { name: /^Показать стык .* в журнале$/ })).toHaveCount(5)
  expect(reads()).toBe(2)
  await explanation.getByLabel('Состав расчёта РК/УЗК').selectOption('obligations')
  await expect(explanation).toContainText('Обязателен после негодного РК на F1')
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  expect(reads()).toBe(3)
  await calculation.screenshot({ path: 'outputs/line-program-calculation-details.png' })
  await calculation.getByRole('button', { name: 'Закрыть расчёт' }).click()
  await program.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await program.getByTestId('program-scope-actions').getByRole('button', { name: /^Назначения/ }).last().click()
  const dialog = page.getByRole('dialog', { name: 'Назначения · SYS-EXPLAIN' })
  await dialog.getByLabel('Поиск стыков в назначениях').fill('F1R1')
  const rk = dialog.getByLabel('F1R1 · РК', { exact: true })
  await expect(rk).toHaveClass(/border-amber-400/)
  await expect(rk).toHaveAttribute('title', /Обязателен после негодного РК/)
  await expect(rk.locator('option[value=""]')).toBeDisabled()
  await expect(dialog.getByLabel('F1R1 · ВИК', { exact: true })).toHaveCount(0)
  await withE2eDatabase(async db => {
    const { rows: [repair] } = await db.query("select has_vik from weld_joints where line='SYS-EXPLAIN' and joint='F1R1'")
    expect(repair.has_vik).toBe('да') // Only the redundant editor disappeared, not the requirement.
  })
  await dialog.screenshot({ path: 'outputs/line-program-system-rules.png' })
  expect(errors).toEqual([])
})
