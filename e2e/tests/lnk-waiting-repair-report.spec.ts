import { expect, test, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { drizzle } from 'drizzle-orm/node-postgres'
import { withE2eDatabase } from '../database'
import { loadPendingRepairNames } from '@/server/lnk-waiting-repair-report'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { captureFullReportPrint } from '../report-print-capture'
import { captureReportExcel } from '../report-excel-capture'

const project = 'E2E ЛНК задание на ремонт'
const coordinates = '0-250: ДНО\n250-500: Пора\n500-0: ДНО'

test.afterEach(async () => {
  await withLineProgramFixture(db => db.query(`delete from weld_joint_program_states s using weld_joints w
    where s.weld_joint_id=w.id and w.project_title=$1`, [project]))
  await cleanupLineProgramProjects([project])
})

test('prints the latest rejected weld and refreshes the repair assignment at each opening and download', async ({ page }) => {
  const ids = await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number }>(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,officiality,has_vik,vik_result,revision_actuality,connection_type)
      values ($1,'A','L1','F12','2026-08-01','действующий','да','годен','актуальная','СШ'),
             ($1,'A','L1','F12R1','2026-08-05','действующий','да','годен','актуальная','СШ'),
             ($1,'A','L2','F14','2026-08-02','неофициальный','да',null,'актуальная','СШ'),
             ($1,'A','L2','F14',null,'действующий','да',null,'актуальная','СШ'),
             ($1,'A','L3','S17','2026-08-03','действующий','да','годен','актуальная','СШ'),
             ($1,'A','L4','S17','2026-08-03','действующий','да','годен','актуальная','СШ')
      returning id`, [project])
    const [first, repair, pre, , duplicate] = rows.map(row => row.id)
    await db.query(`update weld_joints set has_rk='да',rk_control_basis='проект',rk_result='ремонт',
      rk_conclusion_date='2026-08-07', rk_conclusion='РК-07',rk_request='Заявка-06',rk_request_date='2026-08-06',
      lnk_defect_description=$2, d1=219,t1=6,d2=159,t2=5,stamp_1_k='OFFICIAL',stamp_1_k_fact='ABC1',
      stamp_1_z_fact='ABC2',lnk_note='Доступ с площадки' where id=any($1::int[])`, [[first, repair], coordinates])
    await db.query("update weld_joints set stamp_1_k_fact='D503',stamp_1_z_fact=' d503 ' where id=$1", [pre])
    await db.query(`insert into pre_heat_treatment_controls
      (weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      values ($1,'ВИК','До ТО-01','2026-08-02','ремонт','Заключение до ТО','2026-08-03','Подрез')`, [pre])
    await db.query(`insert into duplicate_controls (weld_joint_id,method,result,control_date,conclusion,conclusion_date)
      values ($1,'УЗК','ремонт','2026-08-06','Дубль-08','2026-08-08')`, [duplicate])
    await db.query(`update weld_joints set has_uzk='да',uzk_request='Чужая заявка',
      stamp_1_k_fact='пусто',stamp_1_z_fact='A107' where id=$1`, [duplicate])
    // The pre-TO document and a same-titled primary document must not exchange signatures.
    for (const [rowId, type, title, date, stage, stamp] of [
      [repair, 'system:lnkConclusionRk', 'РК-07', '2026-08-07', null, 'РК7'],
      [pre, 'system:lnkConclusionVik', 'Заключение до ТО', '2026-08-03', null, 'Другая роль'],
      [pre, 'system:lnkConclusionVik', 'Заключение до ТО', '2026-08-03', 'beforeHeatTreatment', 'ВИК3'],
    ] as const) {
      const doc = await db.query(`insert into generated_documents(type,title,period_from,file_name,mime_type,specialists,source_metadata)
        values ($1,$2,$3,'fixture.xlsx','application/octet-stream',$4,$5) returning id`, [type,title,date,
        JSON.stringify({ first: { id: 1, name: 'Контролёр', certificate: '123', stamp } }), stage ? JSON.stringify({ sourceKind: stage }) : null])
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)', [doc.rows[0].id,rowId])
    }
    return { first, repair }
  })
  await page.goto('/lnk')
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  const frame = preview.frameLocator('iframe')
  const open = () => openWaitingRepairReport(page)
  const close = () => preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await open()
  const row = (joint: string) => frame.locator('tbody tr').filter({ has: page.locator('td:nth-child(7)', { hasText: new RegExp(`^${joint}$`) }) })
  await expect(row('F12')).toHaveCount(0)
  await expect(row('F12R1')).toContainText('Пора')
  const repairCells = row('F12R1').locator('td')
  await expect(repairCells.nth(13)).toHaveText('ABC1/ABC2')
  await expect(repairCells.nth(14)).toHaveText('РК')
  await expect(repairCells.nth(16)).toHaveText('05.08.2026')
  await expect(repairCells.nth(20)).toHaveText(coordinates)
  await expect(repairCells.nth(22)).toHaveText('ЮМС')
  await expect(repairCells.nth(23)).toHaveText('РК7')
  await expect(repairCells.nth(24)).toHaveText('-')
  // Force the published-pages path even on this small fixture. A compact
  // task snapshot can omit the repair when thousands of other tasks precede it.
  const fromPages = await withE2eDatabase(async db => {
    const state = (await db.query('select repeated_tasks from dispatcher_task_index_state where id=1')).rows[0]
    const payload = JSON.parse(state.repeated_tasks)
    return loadPendingRepairNames(drizzle(db), { repeatedTasks: JSON.stringify({ ...payload, tasksTruncated: true, tasks: [] }) })
  })
  expect(fromPages.get(ids.repair)).toBe('-')
  const preCells = row('F14').locator('td')
  await expect(preCells.nth(13)).toHaveText('D503')
  await expect(preCells.nth(14)).toHaveText('ВИК до ТО')
  await expect(preCells.nth(20)).toHaveText('Подрез')
  await expect(preCells.nth(23)).toHaveText('ВИК3')
  await expect(preCells.nth(24)).toHaveText('F14')
  const duplicateCells = row('S17').locator('td')
  await expect(duplicateCells.nth(13)).toHaveText('A107')
  await expect(duplicateCells.nth(14)).toHaveText('УЗК (дубль)')
  await expect(duplicateCells.nth(15)).toBeEmpty()
  await expect(duplicateCells.nth(18)).toHaveText('06.08.2026')
  await expect(duplicateCells.nth(21)).toHaveText('Дубль-08')
  await expect(duplicateCells.nth(23)).toBeEmpty()

  await captureFullReportPrint(page, true)
  await preview.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').columns)).toBe(26)
  const print = await page.evaluate(() => (window as Window & { auditFullPrintHtml?: string }).auditFullPrintHtml)
  for (const stamp of ['ABC1/ABC2', 'D503', 'A107']) expect(print).toContain(`>${stamp}</td>`)

  const next = await withLineProgramFixture(async db => {
    await db.query("update weld_joints set lnk_note='После исправления' where id=$1", [ids.repair])
    const result = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,officiality)
      values ($1,'A','L1','F12R2','действующий') returning id`, [project])
    return result.rows[0].id
  })
  const workbook = await captureReportExcel(page, preview)
  const data = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Ожидает ремонта'], { header: 1 })
  expect(data[0]).toHaveLength(26)
  expect(data.find(cells => cells[6] === 'F12R1')?.[13]).toBe('ABC1/ABC2')
  expect(data.find(cells => cells[6] === 'F14')?.[13]).toBe('D503')
  expect(data.find(cells => cells[6] === 'S17')?.[13]).toBe('A107')
  expect(data[0].slice(7, 13)).toEqual(['Способ сварки','Тип соединения','Диаметр 1-го элемента, мм','Толщина стенки 1-го элемента, мм','Диаметр 2-го элемента, мм','Толщина стенки 2-го элемента, мм'])
  expect(data.find(cells => cells[6] === 'F12R1')?.slice(23)).toEqual(['РК7','F12R2','После исправления'])
  await close()
  await open()
  await expect(repairCells.nth(24)).toHaveText('F12R2')
  await expect(repairCells.nth(25)).toHaveText('После исправления')
  await close()
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set joint='F992' where id=$1", [next])
    await db.query("insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id) values ($1,'repair',$2,$3)",
      [next, ids.first, ids.repair])
  })
  await open()
  await expect(repairCells.nth(24)).toHaveText('F992')
  await close()
  await withLineProgramFixture(db => db.query("update weld_joints set weld_date='2026-08-10' where id=$1", [next]))
  await open()
  await expect(row('F12R1')).toHaveCount(0)
  await expect(row('S17')).toHaveCount(1)
})

async function openWaitingRepairReport(page: Page) {
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Ожидает ремонта', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  await expect(preview.frameLocator('iframe').getByRole('heading', { name: 'ЛНК: ожидает ремонта' })).toBeVisible()
  return preview
}

test('keeps an unfinished coil on the foreman report after renaming its source and sides', async ({ page }) => {
  await withLineProgramFixture(async db => {
    const { rows } = await db.query<{ id: number; joint: string }>(`insert into weld_joints
      (project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,connection_type,
       has_vik,vik_result,has_uzk,uzk_result)
      select $1,'К','L9',joint,'действующий','актуальная',day,'С17','да',
        case when day is not null then 'годен' end,'да',result
      from (values ('F20',date '2026-08-01','вырез'),('F31',null,null),('F32',date '2026-08-03',null)) weld(joint,day,result)
      returning id,joint`, [project])
    const id = (joint: string) => rows.find(row => row.joint === joint)!.id
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side)
      values ($1,'primary',$1,null,null,null), ($2,'coil',$2,$1,$1,1), ($3,'coil',$3,$1,$1,2)`,
      [id('F20'), id('F31'), id('F32')])
  })
  await page.goto('/lnk')
  const preview = await openWaitingRepairReport(page)
  const source = preview.frameLocator('iframe').getByRole('row').filter({ has: page.getByRole('cell', { name: 'F20', exact: true }) })
  await expect(source.getByRole('cell').nth(24)).toHaveText('F31, F32')
  // A surviving physical side still identifies the work when its mate is gone.
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      await db.query("delete from weld_joints where project_title=$1 and joint='F31'", [project])
      const { rows: [parent] } = await db.query<{ id: number }>("select id from weld_joints where project_title=$1 and joint='F20'", [project])
      const pending = await loadPendingRepairNames(drizzle(db), { repeatedTasks: '[]' })
      expect(pending.get(parent.id)).toBe('Замена катушкой')
    } finally {
      await db.query('rollback')
    }
  })
  await preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await withLineProgramFixture(db => db.query("update weld_joints set weld_date='2026-08-04' where project_title=$1 and joint='F31'", [project]))
  await openWaitingRepairReport(page)
  await expect(source).toHaveCount(0)
  // Removing both records does not undo a confirmed physical replacement.
  // The dispatcher can still infer a request from the renamed rejected source.
  await preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      const result = await db.query<{ id: number }>(`update weld_joint_program_states s set replaced_by_coil=true
        from weld_joints w where w.id=s.weld_joint_id and w.project_title=$1 and w.joint='F20' returning w.id`, [project])
      const retired = result.rows[0].id
      await db.query("delete from weld_joints where project_title=$1 and joint in ('F31','F32')", [project])
      const tasks = [{ kind: 'create', row: { id: retired } }]
      const remaining = await loadPendingRepairNames(drizzle(db), { repeatedTasks: JSON.stringify({ tasks }) })
      expect(remaining.has(retired)).toBe(false)
    } finally {
      await db.query('rollback')
    }
  })
})

test('reports the coil decision, then both actual side names until both weld dates are recorded', async ({ page }) => {
  const sourceId = await withLineProgramFixture(async db => {
    const rows = await db.query<{ id: number; joint: string }>(`insert into weld_joints
      (project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,connection_type,d1,d2,t1,t2,
       has_vik,vik_control_basis,vik_result,vik_conclusion_date,vik_conclusion,
       has_uzk,uzk_control_basis,uzk_result,uzk_conclusion_date,uzk_conclusion,uzk_request,uzk_request_date)
      select $1,'К','L5',joint,'действующий','актуальная',day,'С17',108,108,4,4,
        'да','проект','годен',day,'ВИК-'||joint,
        'да','проект','вырез',day,'УЗК-'||joint,'Заявка-'||joint,day
      from (values ('S1',date '2026-08-01'),('S1W1',date '2026-08-02'),
        ('S1W2',date '2026-08-03'),('S1W3',date '2026-08-04')) chain(joint,day) returning id,joint`, [project])
    return rows.rows.find(row => row.joint === 'S1W3')!.id
  })
  await page.goto('/lnk')
  const preview = await openWaitingRepairReport(page)
  const frame = preview.frameLocator('iframe')
  const source = frame.locator('tbody tr').filter({ has: page.getByRole('cell', { name: 'S1W3', exact: true }) })
  const newName = source.getByRole('cell').nth(24)
  await expect(newName).toHaveText('Замена катушкой')
  const paged = await withE2eDatabase(db => loadPendingRepairNames(drizzle(db), {
    repeatedTasks: JSON.stringify({ tasksTruncated: true }),
  }))
  expect(paged.get(sourceId)).toBe('Замена катушкой')
  const close = () => preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await close()

  await page.goto('/journal')
  const dispatcher = page.getByLabel('Диспетчер задач', { exact: true })
  await dispatcher.getByRole('button', { name: 'Развернуть', exact: true }).click()
  const code = dispatcher.locator('[data-dispatcher-code-group]').filter({ has: page.getByText('СП-09', { exact: true }) })
  await code.locator('summary').first().click()
  await code.locator('[data-dispatcher-object-summary]').filter({ hasText: 'S1' }).first().click()
  const pair = code.getByText('катушка S1Y1 + S1Y2', { exact: true })
  await pair.locator('xpath=ancestor::div[contains(@class,"grid")][1]').getByRole('button', { name: 'Катушка', exact: true }).click()
  const sides = () => withE2eDatabase(async db => (await db.query(
    "select joint from weld_joints where project_title=$1 and line='L5' and joint in ('S1Y1','S1Y2') order by joint", [project]
  )).rows.map(row => row.joint))
  await expect.poll(sides).toEqual(['S1Y1','S1Y2'])
  await page.goto('/lnk')
  await openWaitingRepairReport(page)
  await expect(newName).toHaveText('S1Y1, S1Y2')
  const workbook = await captureReportExcel(page, preview)
  const matrix = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Ожидает ремонта'], { header: 1 })
  expect(matrix.filter(row => row[6] === 'S1W3').map(row => row[24])).toEqual(['S1Y1, S1Y2'])
  await captureFullReportPrint(page, true)
  await preview.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { auditFullPrintHtml?: string }).auditFullPrintHtml ?? '')).toContain('S1Y1, S1Y2')
  const weldSide = (joint: string) => withLineProgramFixture(db => db.query(
    "update weld_joints set weld_date='2026-08-05' where project_title=$1 and line='L5' and joint=$2", [project, joint],
  ))
  await close()
  await weldSide('S1Y2')
  await openWaitingRepairReport(page)
  await expect(newName).toHaveText('S1Y1, S1Y2')
  await close()
  await weldSide('S1Y1')
  await openWaitingRepairReport(page)
  await expect(source).toHaveCount(0)
})
