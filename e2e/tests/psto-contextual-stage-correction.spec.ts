import { filterPstoExceptions } from './psto-exception-helpers'
import { asE2eOwner } from '../with-owner-access'
import { documentGridRow } from '../document-grid'
import { editJournalJoint } from '../journal-grid'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const PROJECT = 'E2E contextual PSTO correction'
const SOURCE = 'CTX-PSTO-SOURCE'
const TARGET = 'CTX-PSTO-TARGET'
const STAMP = 'ECPC'
const historicalSpecialists = { first: { id: 900001, name: 'Исторический дефектоскопист', certificate: 'СТАРОЕ-УД' }, second: null }
const METHODS = [
  { key: 'vik', code: 'ВИК', defect: 'vik_defect_description' },
  { key: 'rk', code: 'РК', defect: 'lnk_defect_description' },
  { key: 'uzk', code: 'УЗК', defect: 'uzk_defect_description' },
  { key: 'pvk', code: 'ПВК', defect: 'pvk_defect_description' },
] as const
type Stage = 'primary' | 'beforeHeatTreatment'
type StoredRow = Record<string, unknown>
type Control = {
  method: string; request_name: string; request_date: string; result: string
  conclusion_name: string; conclusion_date: string; defect_description: string
  rk_exposure_confirmed_diameter: number | null
}
let settings: { key: string; value: string; updated_at: Date }[] = []

// Only the existing runner owns/creates the disposable database. Nothing runs
// at module import, and this spec never touches the shared seed implementation.
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    settings = (await db.query("select key,value,updated_at from app_settings where key in ('data-list','control-processes')")).rows
    for (const [key, value] of [
      ['data-list', { weldingTypes: ['РД'], connectionTypes: ['С17'], materialGroups: ['M01'] }],
      ['control-processes', { preHeatTreatmentLnkEnabled: true, allowPrimaryLnkBeforePreviousStagesComplete: true }],
    ] as const) await db.query(`insert into app_settings(key,value) values ($1,$2)
      on conflict(key) do update set value=excluded.value,updated_at=now()`, [key, JSON.stringify(value)])
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,weld_type,material_groups,
      diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits)
      values ($1,'E2E contextual correction','РД','M01','1','1000','1','100','2026-01-01','2026-12-31',$2)`,
    [STAMP, JSON.stringify([{ id: 'contextual-psto', weldType: 'РД', materialGroups: 'M01', diameterFrom: '1', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '100', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }])])
  })
})

test.afterEach(async () => {
  await cleanupLineProgramProjects([PROJECT])
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [STAMP])
    await db.query("delete from app_settings where key in ('data-list','control-processes')")
    for (const row of settings) await db.query('insert into app_settings(key,value,updated_at) values ($1,$2,$3)', [row.key, row.value, row.updated_at])
  })
})

function control(method: typeof METHODS[number]): Control {
  return {
    method: method.code,
    request_name: `CTX-${method.key}-REQUEST`,
    request_date: method.key === 'vik' ? '2026-09-02' : '2026-09-04',
    result: 'годен',
    conclusion_name: `CTX-${method.key}-CONCLUSION`,
    conclusion_date: method.key === 'vik' ? '2026-09-03' : '2026-09-05',
    defect_description: 'ДНО',
    rk_exposure_confirmed_diameter: method.key === 'rk' ? 108 : null,
  }
}

async function seed(stage: Stage) {
  return withLineProgramFixture(async db => {
    const lines = (await db.query<{ id: number; line: string }>(`insert into line_programs
      (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'CTX',$2,'II','A',100,100),($1,'CTX',$3,'II','A',100,100) returning id,line`, [PROJECT, SOURCE, TARGET])).rows
    const rows: { id: number; joint: string }[] = []
    for (const joint of ['F881', 'F882']) {
      const row = (await db.query<{ id: number; joint: string }>(`insert into weld_joints
        (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,material_group,welding_method,
        officiality,revision_actuality,d1,d2,t1,t2,wdi,stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
        has_vik,has_rk,has_uzk,has_pvk,psto_required,category,group_name,weld_control_percent,pvk_control_percent)
        values ($1,$2,'CTX',$3,$4,'2026-09-01','С17','M01','РД','действующий','актуальная',108,108,4,4,0.42,
        $5,$5,$5,$5,$5,$5,'да','да','да','да',$6,'II','A',100,100) returning id,joint`,
      [lines.find(line => line.line === SOURCE)!.id, PROJECT, SOURCE, joint, STAMP, stage === 'primary' ? null : 'да'])).rows[0]!
      rows.push(row)
      for (const method of METHODS) {
        const c = control(method)
        if (stage === 'primary') {
          await db.query(`update weld_joints set ${method.key}_request=$2,${method.key}_request_date=$3,
            ${method.key}_result=$4,${method.key}_conclusion=$5,${method.key}_conclusion_date=$6,${method.defect}=$7
            where id=$1`, [row.id, c.request_name, c.request_date, c.result, c.conclusion_name, c.conclusion_date, c.defect_description])
        } else {
          await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,
            conclusion_name,conclusion_date,defect_description,rk_exposure_confirmed_diameter)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [row.id, c.method, c.request_name, c.request_date, c.result,
            c.conclusion_name, c.conclusion_date, c.defect_description, c.rk_exposure_confirmed_diameter])
        }
      }
      if (stage === 'primary') await db.query('update weld_joints set rk_exposure_confirmed_diameter=108 where id=$1', [row.id])
      // Seed the known derived state too: all primary methods are good, or
      // pre-TO is complete and PSTO still awaits its request. Otherwise a
      // concurrent dispatcher refresh legitimately fills NULL final_status and
      // races the exact-facts assertion for the unselected sibling below.
      await db.query('update weld_joints set final_status=$2 where id=$1',
        [row.id, stage === 'primary' ? 'годен' : 'ожидает заявку'])
    }
    // One shared VIK conclusion explicitly exercises retention of the other
    // weld's source position when only F881 changes stage.
    const positions = stage === 'beforeHeatTreatment'
      ? (await db.query<{ id: number; weld_joint_id: number }>("select id,weld_joint_id from pre_heat_treatment_controls where weld_joint_id=any($1::int[]) and method='ВИК' order by id", [rows.map(row => row.id)])).rows
        .map(row => ({ kind: 'beforeHeatTreatment', weldJointId: row.weld_joint_id, relationId: row.id, methodCode: 'ВИК' }))
      : undefined
    const document = (await db.query<{ id: number }>(`insert into generated_documents
      (type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      values ('system:lnkConclusionVik','CTX-vik-CONCLUSION','context.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '2026-09-03','2026-09-03',2,$1) returning id`, [JSON.stringify({ methodCode: 'ВИК', methodCodes: ['ВИК'], positionCount: 2,
      projects: [PROJECT], subtitleCodes: ['CTX'], lines: [SOURCE],
      ...(positions ? { sourceKind: 'beforeHeatTreatment', sourcePositions: positions } : {}),
    })])).rows[0]!
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [document.id, rows.map(row => row.id)])
    await db.query('update generated_documents set specialists=$1::jsonb where id=$2', [JSON.stringify(historicalSpecialists), document.id])
    return { moved: rows[0]!, kept: rows[1]!, sourceDocumentId: document.id }
  })
}

async function snapshot(id: number) {
  return withE2eDatabase(async db => ({
    row: (await db.query<{ row: StoredRow }>('select to_jsonb(w) as row from weld_joints w where id=$1', [id])).rows[0]!.row,
    controls: (await db.query<{ row: StoredRow }>('select to_jsonb(c) as row from pre_heat_treatment_controls c where weld_joint_id=$1 order by method', [id])).rows.map(row => row.row),
    cycles: (await db.query<{ row: StoredRow }>('select to_jsonb(c) as row from psto_repeat_cycles c where weld_joint_id=$1 order by sequence', [id])).rows.map(row => row.row),
    documents: (await db.query(`select d.id,d.title,d.row_count,d.source_metadata from generated_documents d
      join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=$1 order by d.id`, [id])).rows,
  }))
}

async function clearOptionalNames(id: number, stage: Stage) {
  // Retain the named, shared VIK document and the sibling weld. The other three
  // results have facts/dates but no document, and must not acquire invented names.
  await withLineProgramFixture(async db => {
    if (stage === 'primary') await db.query('update weld_joints set rk_conclusion=null,uzk_conclusion=null,pvk_conclusion=null where id=$1', [id])
    else await db.query("update pre_heat_treatment_controls set conclusion_name=null where weld_joint_id=$1 and method<>'ВИК'", [id])
  })
}

async function expectPackage(id: number, stage: Stage, unnamed = false) {
  const state = await snapshot(id)
  if (stage === 'primary') expect(state.controls).toEqual([])
  else expect(state.controls).toHaveLength(METHODS.length)
  for (const method of METHODS) {
    const c = { ...control(method), conclusion_name: unnamed && method.key !== 'vik' ? null : control(method).conclusion_name }
    if (stage === 'beforeHeatTreatment') {
      expect(state.controls.find(row => row.method === method.code)).toMatchObject(c)
      for (const suffix of ['request', 'request_date', 'conclusion', 'conclusion_date']) expect(state.row[`${method.key}_${suffix}`]).toBeNull()
      expect([null, 'ожидает заявку', 'ожидает НК']).toContain(state.row[`${method.key}_result`])
      expect(state.row[method.defect]).toBeNull()
    } else {
      expect(state.row).toMatchObject({
        [`${method.key}_request`]: c.request_name, [`${method.key}_request_date`]: c.request_date,
        [`${method.key}_result`]: c.result, [`${method.key}_conclusion`]: c.conclusion_name,
        [`${method.key}_conclusion_date`]: c.conclusion_date, [method.defect]: c.defect_description,
      })
    }
  }
  expect(state.row.rk_exposure_confirmed_diameter).toBe(stage === 'primary' ? 108 : null)
  if (unnamed) {
    // Only the VIK conclusion is named. Requests may still exist; no empty or
    // automatically invented conclusion documents may appear for the other methods.
    const conclusions = await withE2eDatabase(async db => (await db.query(`select d.type,d.title from generated_documents d
      join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=$1 and d.type like 'system:lnkConclusion%'`, [id])).rows)
    expect(conclusions).toEqual([{ type: 'system:lnkConclusionVik', title: 'CTX-vik-CONCLUSION' }])
  }
}

function dialog(page: Page, name: string) {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name, exact: true }) })
}

function choices(parent: Locator, joint: string) {
  return parent.getByRole('group', { name: `Этап НК для стыка ${joint}`, exact: true })
}

async function openAssignment(page: Page) {
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  const program = dialog(page, 'Программа ПСТО')
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'line', SOURCE)
  await expect(program.getByText(SOURCE, { exact: true })).toBeVisible()
  await program.getByRole('button', { name: 'Назначить', exact: true }).click()
  const assignment = dialog(page, 'Назначение ПСТО')
  await expect(choices(assignment, 'F881')).toBeVisible()
  return assignment
}

async function openMove(page: Page, id: number, isChain = false) {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(SOURCE)
  await editJournalJoint(page, id)
  const editor = dialog(page, 'Редактирование стыка')
  const input = editor.getByText('Линия', { exact: true }).locator('..').getByRole('textbox')
  await input.fill(TARGET)
  await input.press('Tab')
  const move = dialog(page, isChain ? 'Перенос цепочки F881' : 'Перенос стыка на другую линию')
  await expect(choices(move, 'F881')).toBeVisible()
  return { editor, move }
}

async function openCancellation(page: Page) {
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  const program = dialog(page, 'Программа ПСТО')
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'line', SOURCE)
  await expect(program.getByText(SOURCE, { exact: true })).toBeVisible()
  await program.getByRole('button', { name: 'Отменить ПСТО', exact: true }).click()
  const cancellation = dialog(page, 'Отмена ПСТО')
  await expect(choices(cancellation, 'F881')).toBeVisible()
  return cancellation
}

async function addTarget(fixture: Awaited<ReturnType<typeof seed>>, pre: boolean, merge = false) {
  return withE2eDatabase(async db => {
    const row = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
      connection_type,officiality,revision_actuality,has_vik,psto_required,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'CTX',$2,'F883','2026-09-01','С17','действующий','актуальная','да',$3,'II','A',100,100) returning id`,
    [PROJECT, TARGET, pre ? 'да' : null])).rows[0]
    if (!merge) return row.id as number
    let positions: unknown[] | undefined
    if (pre) {
      const c = (await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
        values ($1,'ВИК','CTX-vik-REQUEST','2026-09-02','годен','CTX-vik-CONCLUSION','2026-09-03') returning id`, [row.id])).rows[0]
      positions = [{ kind: 'beforeHeatTreatment', weldJointId: row.id, relationId: c.id, methodCode: 'ВИК' }]
    } else await db.query(`update weld_joints set vik_request='CTX-vik-REQUEST',vik_request_date='2026-09-02',
      vik_result='годен',vik_conclusion='CTX-vik-CONCLUSION',vik_conclusion_date='2026-09-03' where id=$1`, [row.id])
    const document = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata,specialists)
      values ('system:lnkConclusionVik','CTX-vik-CONCLUSION','target.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '2026-09-03','2026-09-03',1,$1,$2::jsonb) returning id`, [JSON.stringify({ methodCode: 'ВИК', methodCodes: ['ВИК'], projects: [PROJECT], lines: [TARGET],
        ...(positions ? { sourceKind: 'beforeHeatTreatment', sourcePositions: positions, positionCount: 1 } : {}),
      }), JSON.stringify({ first: { id: 900002, name: 'Другой специалист', certificate: 'ДРУГОЕ-УД' }, second: null })])).rows[0]
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)', [document.id, row.id])
    return document.id as number
  })
}

test('отмена ПСТО: явный перенос одного стыка сохраняет специалистов и не переносит соседний', async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  const cancellation = await openCancellation(page)
  await expect(choices(cancellation, 'F881').getByRole('radio', { name: 'Оставить НК до ТО' })).toBeChecked()
  await choices(cancellation, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной' }).check()
  await cancellation.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true }).click()
  await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
  await expectPackage(fixture.moved.id, 'primary')
  await expectPackage(fixture.kept.id, 'beforeHeatTreatment')
  expect((await snapshot(fixture.moved.id)).row.psto_required).toBe('отменен')
  await expectSharedDocument(page, fixture, 'primary')
})

test('исключение ПСТО: включение, снятие и повторное включение сохраняют этапы; явный перенос работает в обе стороны', async ({ page }) => {
  const fixture = await seed('primary')
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  const program = dialog(page, 'Программа ПСТО')
  await program.getByRole('button', { name: 'Исключения', exact: true }).click()
  const add = async () => {
    await program.getByRole('button', { name: 'Добавить исключение' }).click()
    await filterPstoExceptions(page, 'Выбор цепочки для исключения ПСТО', 'line', SOURCE)
    const candidate = program.locator('.ag-row').filter({ has: page.locator('[col-id="joint"]', { hasText: /^F881$/ }) })
    await candidate.getByRole('button', { name: 'Выбрать цепочку' }).click()
    await program.getByLabel('Основание исключения').fill('Техническое решение: отдельная термообработка')
    const details = program.locator('summary').filter({ hasText: 'Этапы записанного НК' })
    if (await details.count()) await details.click()
  }
  const save = async (remove = false) => {
    await program.getByRole('button', { name: remove ? 'Убрать исключение' : 'Сохранить исключение', exact: true }).click()
    await expect(program.getByRole('button', { name: 'Добавить исключение' })).toBeVisible()
  }
  const remove = async () => {
    await filterPstoExceptions(page, 'Исключения ПСТО', 'line', SOURCE)
    await program.getByRole('button', { name: 'Убрать исключение', exact: true }).click()
    await expect(program.getByText('После снятия исключения', { exact: true })).toBeVisible()
    const details = program.locator('summary').filter({ hasText: 'Этапы записанного НК' })
    if (await details.count()) await details.click()
  }
  await add()
  await expect(choices(program, 'F881').getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  await choices(program, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО', exact: true }).check()
  await save()
  await expectPackage(fixture.moved.id, 'beforeHeatTreatment')
  await expectSharedDocument(page, fixture, 'beforeHeatTreatment')

  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await program.getByRole('button', { name: 'Исключения', exact: true }).click()

  await remove()
  await expect(choices(program, 'F881').getByRole('radio', { name: 'Оставить НК до ТО', exact: true })).toBeChecked()
  await save(true)
  await expectPackage(fixture.moved.id, 'beforeHeatTreatment')
  await add()
  await save()
  await expectPackage(fixture.moved.id, 'beforeHeatTreatment')
  await remove()
  await choices(program, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true }).check()
  await save(true)
  await expectPackage(fixture.moved.id, 'primary')
  await expectPackage(fixture.kept.id, 'primary')
  expect((await snapshot(fixture.kept.id)).row.psto_required).toBeNull()
  expect((await snapshot(fixture.moved.id)).row.psto_exception_basis).toBeNull()
  const shared = await withE2eDatabase(async db => (await db.query('select row_count,specialists from generated_documents where id=$1', [fixture.sourceDocumentId])).rows[0])
  expect(shared).toEqual({ row_count: 2, specialists: historicalSpecialists })
})

test('возобновление после отмены: явный перенос одного стыка сохраняет специалистов, сосед с заявкой ПСТО остаётся KEEP', async ({ page }) => {
  const fixture = await seed('primary')
  const assignment = await openAssignment(page)
  for (const joint of ['F881', 'F882']) {
    await expect(choices(assignment, joint).getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  }
  await assignment.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
  await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
  await expectPackage(fixture.moved.id, 'primary')
  await expectPackage(fixture.kept.id, 'primary')

  // A primary NK package alone permits removing an empty assignment, not an
  // official cancellation. Give only the sibling an existing request-only PSTO
  // history: this is fixture preparation, not a test of request creation. The
  // assignment, cancellation and reactivation themselves all use the real UI.
  await withE2eDatabase(db => db.query(`update weld_joints
    set psto_request='CTX-REACTIVATE-PSTO',psto_request_date='2026-09-06'
    where id=$1`, [fixture.kept.id]))
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  const program = dialog(page, 'Программа ПСТО')
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'line', SOURCE)
  await expect(program.getByText(SOURCE, { exact: true })).toBeVisible()
  await program.getByRole('button', { name: 'Отменить ПСТО', exact: true }).click()
  const cancellation = dialog(page, 'Отмена ПСТО')
  await cancellation.getByLabel(/Дата решения об отмене ПСТО/).fill('2026-09-10')
  await cancellation.getByLabel('Основание отмены ПСТО', { exact: true }).fill('CTX-REACTIVATE-CANCELLATION')
  await cancellation.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true }).click()
  await expect(program).toBeVisible()
  for (const row of [fixture.moved, fixture.kept]) {
    await expectPackage(row.id, 'primary')
    expect((await snapshot(row.id)).row).toMatchObject({
      psto_required: 'отменен', psto_cancellation_date: '2026-09-10',
      psto_control_basis: 'CTX-REACTIVATE-CANCELLATION',
    })
  }
  const keptBefore = await snapshot(fixture.kept.id)

  await program.getByRole('button', { name: 'Возобновить', exact: true }).click()
  const reactivation = dialog(page, 'Возобновление ПСТО')
  for (const joint of ['F881', 'F882']) {
    await expect(choices(reactivation, joint).getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  }
  const transferLabel = 'Весь основной НК → до ТО'
  await expect(choices(reactivation, 'F881').getByRole('radio', { name: transferLabel, exact: true })).toBeEnabled()
  await expect(choices(reactivation, 'F882').getByRole('radio', { name: transferLabel, exact: true })).toBeDisabled()
  await expect(choices(reactivation, 'F882')).toContainText('заявка или история ПСТО/ТВМТ')
  await choices(reactivation, 'F881').getByRole('radio', { name: transferLabel, exact: true }).check()
  await expect(choices(reactivation, 'F882').getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  await reactivation.getByRole('button', { name: 'Возобновить ПСТО', exact: true }).click()
  await expect(program).toBeVisible()
  await page.reload()

  await expectPackage(fixture.moved.id, 'beforeHeatTreatment')
  await expectPackage(fixture.kept.id, 'primary')
  for (const row of [fixture.moved, fixture.kept]) {
    expect((await snapshot(row.id)).row).toMatchObject({
      psto_required: 'да', psto_cancellation_date: null, psto_control_basis: null,
    })
  }
  expect((await snapshot(fixture.moved.id)).row).toMatchObject({
    psto_request: null, psto_request_date: null, psto_result: null, psto_date: null,
  })
  const keptAfter = await snapshot(fixture.kept.id)
  for (const field of RECORDED_CONTROL_FIELDS) expect(keptAfter.row[field], field).toEqual(keptBefore.row[field])
  expect(keptAfter.controls).toEqual(keptBefore.controls)
  expect(keptAfter.cycles).toEqual(keptBefore.cycles)
  await expectSharedDocument(page, fixture, 'beforeHeatTreatment')
})

test('после переноса: переход из документа и исправление названия до ТО сохраняют исходный этап соседа и специалистов', async ({ page }) => {
  const fixture = await seed('primary')
  const assignment = await openAssignment(page)
  await choices(assignment, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО', exact: true }).check()
  await expect(choices(assignment, 'F882').getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  await assignment.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
  await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
  await expectPackage(fixture.moved.id, 'beforeHeatTreatment')
  await expectPackage(fixture.kept.id, 'primary')
  await expectSharedDocument(page, fixture, 'beforeHeatTreatment')

  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  const transferredRow = await documentGridRow(page, 'CTX-vik-CONCLUSION', 'До ТО')
  await transferredRow.actions.getByTitle('Показать стыки документа в отчете ЛНК', { exact: true }).click()
  await expect(page).toHaveURL(/\/lnk(?:\?|$)/)
  await expect(page.locator(`.ag-row[row-id="${fixture.moved.id}"]`)).toBeVisible()
  await expect(page.locator(`.ag-row[row-id="${fixture.kept.id}"]`)).toHaveCount(0)
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'До ТО', exact: true }).click()
  const manager = dialog(page, 'Редактирование результатов ЛНК до ТО')
  await manager.getByLabel('Вид контроля в реестре').selectOption('ВИК')
  await manager.getByPlaceholder('Стык, линия, заявка или заключение').fill(SOURCE)
  const entry = manager.getByRole('button').filter({ hasText: `${SOURCE} · F881` })
  await expect(entry).toHaveCount(1)
  await expect(manager.getByRole('button').filter({ hasText: `${SOURCE} · F882` })).toHaveCount(0)
  await entry.click()
  const nameInput = manager.getByRole('textbox', { name: 'Наименование заключения', exact: true })
  await expect(nameInput).toHaveValue('CTX-vik-CONCLUSION')

  const documents = () => withE2eDatabase(async db => (await db.query(`select d.id,d.title,d.row_count,d.source_metadata,d.specialists,
    array_agg(a.weld_joint_id order by a.weld_joint_id) as ids
    from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
    where d.type='system:lnkConclusionVik' and a.weld_joint_id=any($1::int[]) group by d.id order by d.id`,
  [[fixture.moved.id, fixture.kept.id]])).rows)
  const beforeDocuments = await documents()
  expect(beforeDocuments).toHaveLength(2)
  const sourceBefore = beforeDocuments.find(document => document.id === fixture.sourceDocumentId)!
  const transferredBefore = beforeDocuments.find(document => document.id !== fixture.sourceDocumentId)!
  const movedBefore = await snapshot(fixture.moved.id)
  const keptBefore = await snapshot(fixture.kept.id)
  const correctedName = 'CTX-vik-CORRECTED-AFTER-TRANSFER'
  // A name-only correction is a supported document edit; dates, the good
  // result, relation identity and the historical specialist pair stay intact.
  await nameInput.fill(correctedName)
  await manager.getByRole('button', { name: 'Сохранить реквизиты', exact: true }).click()
  await expect(page.getByText('Результат НК до ТО обновлен.', { exact: true })).toBeVisible()
  await expect(manager.getByRole('button', { name: 'Сохранить реквизиты', exact: true })).toBeDisabled()
  const movedAfter = await snapshot(fixture.moved.id)
  const controlFacts = (controls: StoredRow[]) => controls.map(({ updated_at: _updatedAt, ...facts }) => facts)
  expect(controlFacts(movedAfter.controls)).toEqual(controlFacts(movedBefore.controls).map(control =>
    control.method === 'ВИК' ? { ...control, conclusion_name: correctedName } : control))
  for (const field of RECORDED_CONTROL_FIELDS) expect(movedAfter.row[field], field).toEqual(movedBefore.row[field])
  expect(movedAfter.cycles).toEqual(movedBefore.cycles)
  expect(await snapshot(fixture.kept.id)).toEqual(keptBefore)
  const afterDocuments = await documents()
  expect(afterDocuments).toHaveLength(2)
  expect(afterDocuments.find(document => document.id === fixture.sourceDocumentId)).toEqual(sourceBefore)
  const corrected = afterDocuments.find(document => document.title === correctedName)!
  expect(corrected).toMatchObject({ row_count: 1, ids: [fixture.moved.id], specialists: historicalSpecialists })
  expect(JSON.parse(corrected.source_metadata)).toMatchObject({
    sourceKind: 'beforeHeatTreatment', sourcePositions: JSON.parse(transferredBefore.source_metadata).sourcePositions,
  })
  expect(sourceBefore.specialists).toEqual(historicalSpecialists)

  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  await documentGridRow(page, correctedName, 'До ТО')
  await documentGridRow(page, 'CTX-vik-CONCLUSION', 'Основной')
})

for (const scenario of ['cancel', 'moveWithPsto'] as const) test(`новый сценарий ${scenario}: заявка ПСТО блокирует перенос только своего стыка, подделка откатывается`, async ({ page }) => {
  const fixture = await seed(scenario === 'cancel' ? 'beforeHeatTreatment' : 'primary')
  if (scenario === 'moveWithPsto') await addTarget(fixture, true)
  await withE2eDatabase(db => db.query("update weld_joints set psto_request='CTX-PSTO-REQUEST',psto_request_date='2026-09-06' where id=$1", [fixture.moved.id]))
  const moveState = scenario === 'moveWithPsto' ? await openMove(page, fixture.moved.id) : null
  const window = moveState?.move ?? await openCancellation(page)
  const label = scenario === 'cancel' ? 'Весь НК до ТО → основной' : 'Весь основной НК → до ТО'
  await expect(choices(window, 'F881').getByRole('radio', { name: label })).toBeDisabled()
  await expect(choices(window, 'F881')).toContainText('заявка или история ПСТО/ТВМТ')
  if (scenario === 'cancel') await expect(choices(window, 'F882').getByRole('radio', { name: label })).toBeEnabled()
  const before = await snapshot(fixture.moved.id)
  let forged = false
  const isSave = (url: string) => url.includes('/_serverFn/') && rpcName(url).startsWith(scenario === 'cancel' ? 'savePstoLineAssignment' : 'updateWeldJoint')
  await page.route('**/_serverFn/**', async route => {
    if (!forged && isSave(route.request().url())) {
      forged = true
      await route.continue({ postData: route.request().postData()!.replaceAll('keepPrimary', scenario === 'cancel' ? 'movePreHeatTreatmentToPrimary' : 'movePrimaryToPreHeatTreatment') })
    } else await route.continue()
  })
  const response = page.waitForResponse(response => isSave(response.url()))
  await window.getByRole('button', { name: scenario === 'cancel' ? 'Отменить ПСТО на линии' : 'Подтвердить перенос', exact: true }).click()
  if (moveState) await moveState.editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect(await (await response).text()).toContain('заявка или история ПСТО/ТВМТ')
  expect(forged).toBe(true)
  expect(await snapshot(fixture.moved.id)).toEqual(before)
})

test('подтверждение очистки не действует после изменения удостоверения; вся отмена откатывается', async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  const targetId = await addTarget(fixture, false, true)
  const cancellation = await openCancellation(page)
  await choices(cancellation, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной' }).check()
  await cancellation.getByRole('checkbox', { name: 'Подтверждаю очистку обеих ролей в объединяемых заключениях' }).check()
  const before = await snapshot(fixture.moved.id)
  await withE2eDatabase(db => db.query(`update generated_documents set specialists=jsonb_set(specialists,'{first,certificate}','"ЕЩЁ НОВЕЕ"'),specialists_revision=specialists_revision+1 where id=$1`, [targetId]))
  await cancellation.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true }).click()
  await expect(cancellation.getByText(/Ничего не изменено. Обновите проверку специалистов/)).toBeVisible()
  expect(await snapshot(fixture.moved.id)).toEqual(before)
  await cancellation.getByRole('button', { name: 'Обновить проверку специалистов' }).click()
  await expect(cancellation.getByRole('checkbox')).not.toBeChecked()
  await cancellation.getByRole('checkbox').check()
  await cancellation.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true }).click()
  await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
  await expectPackage(fixture.moved.id, 'primary')
})

test('предкоммит: удаление старой позиции целевого документа аннулирует подтверждение очистки специалистов', async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  const targetId = await addTarget(fixture, false, true)
  const oldId = await withE2eDatabase(async db => {
    await db.query(`update weld_joints set updated_at='2026-10-10T12:00:00Z',final_status='годен'
      where project_title=$1 and line=$2`, [PROJECT, TARGET])
    return (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,has_vik,vik_request,vik_request_date,vik_result,
      vik_conclusion,vik_conclusion_date,final_status,updated_at)
      values ($1,'CTX',$2,'F884','2026-09-01','действующий','актуальная','С17','да',
        'CTX-vik-REQUEST','2026-09-02','годен','CTX-vik-CONCLUSION','2026-09-03','годен','2026-10-09T12:00:00Z') returning id`, [PROJECT, TARGET])).rows[0].id as number
  })
  const [{ requireDb }, { weldJoints }, { and, eq }, index, mutations] = await Promise.all([
    import('../../src/db'), import('../../src/db/schema'), import('drizzle-orm'),
    import('../../src/server/system-document-index'), import('../../src/server/weld-mutations'),
  ])
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(and(eq(weldJoints.projectTitle, PROJECT), eq(weldJoints.line, TARGET)))
    await index.syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  const cancellation = await openCancellation(page)
  await choices(cancellation, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной' }).check()
  await cancellation.getByRole('checkbox', { name: 'Подтверждаю очистку обеих ролей в объединяемых заключениях' }).check()
  const before = await snapshot(fixture.moved.id)
  const targetBefore = await withE2eDatabase(async db => (await db.query('select updated_at,row_count from generated_documents where id=$1', [targetId])).rows[0])
  expect(targetBefore.row_count).toBe(2)
  const version = await withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [oldId])).rows[0].version)
  // This is a real supported deletion, not direct manipulation of the token.
  await asE2eOwner(mutations.deleteWeldJoint, 'welding.delete')({ data: { id: oldId, version } })
  const targetAfter = await withE2eDatabase(async db => (await db.query('select updated_at,row_count from generated_documents where id=$1', [targetId])).rows[0])
  expect(targetAfter.row_count).toBe(1)
  expect(targetAfter.updated_at).toEqual(targetBefore.updated_at)
  await cancellation.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true }).click()
  await expect(cancellation.getByText(/Ничего не изменено. Обновите проверку специалистов/)).toBeVisible()
  expect(await snapshot(fixture.moved.id)).toEqual(before)
})

test('цепочка на назначенную линию: подтверждение специалистов доходит до сервера, новый R-стык не наследует НК', async ({ page }) => {
  const fixture = await seed('primary')
  const targetId = await addTarget(fixture, true, true)
  const childId = await withE2eDatabase(async db => {
    await db.query("update weld_joints set rk_result='ремонт',lnk_defect_description='Дефект',final_status='не годен' where id=$1", [fixture.moved.id])
    return (await db.query(`insert into weld_joints(project_title,subtitle_code,line,line_program_id,joint,weld_date,connection_type,material_group,welding_method,
      officiality,revision_actuality,d1,d2,t1,t2,wdi,stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,has_rk,has_uzk,has_pvk,category,group_name,weld_control_percent,pvk_control_percent)
      select project_title,subtitle_code,line,line_program_id,'F881R1','2026-09-06',connection_type,material_group,welding_method,
      officiality,revision_actuality,d1,d2,t1,t2,wdi,stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,has_rk,has_uzk,has_pvk,category,group_name,weld_control_percent,pvk_control_percent
      from weld_joints where id=$1 returning id`, [fixture.moved.id])).rows[0].id as number
  })
  const { editor, move } = await openMove(page, fixture.moved.id, true)
  await choices(move, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО' }).check()
  await move.getByRole('checkbox', { name: 'Подтверждаю очистку обеих ролей в объединяемых заключениях' }).check()
  await move.getByRole('button', { name: 'Подтвердить перенос цепочки', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const child = await snapshot(childId)
  expect(child.row.line).toBe(TARGET)
  expect(child.controls).toEqual([])
  expect(child.row.vik_conclusion).toBeNull()
  const parent = await snapshot(fixture.moved.id)
  expect(parent.row.line).toBe(TARGET)
  expect(parent.controls).toHaveLength(4)
  expect(parent.controls.find(row => row.method === 'РК')?.result).toBe('ремонт')
  await withE2eDatabase(async db => {
    expect((await db.query('select specialists from generated_documents where id=$1', [targetId])).rows[0].specialists).toEqual({ first: null, second: null })
  })
})

test('перенос на назначенную линию: основной комплект → до ТО, исходные реквизиты и специалисты сохранены', async ({ page }) => {
  const fixture = await seed('primary')
  await addTarget(fixture, true)
  const { editor, move } = await openMove(page, fixture.moved.id)
  await expect(choices(move, 'F881').getByRole('radio', { name: 'Оставить основной НК' })).toBeChecked()
  await choices(move, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО' }).check()
  await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expectPackage(fixture.moved.id, 'beforeHeatTreatment')
  await expectPackage(fixture.kept.id, 'primary')
  expect((await snapshot(fixture.moved.id)).row.psto_required).toBe('да')
  await expectSharedDocument(page, fixture, 'beforeHeatTreatment')
})

for (const scenario of ['assign', 'moveWithoutPsto', 'cancel', 'moveWithPsto'] as const) {
  test(`специалисты при ${scenario}: предупреждение, явное подтверждение, очистка только объединённого документа`, async ({ page }) => {
    const toPre = scenario === 'assign' || scenario === 'moveWithPsto'
    const fixture = await seed(toPre ? 'primary' : 'beforeHeatTreatment')
    const targetId = await addTarget(fixture, toPre, true)
    const before = await snapshot(fixture.moved.id)
    const editorAndMove = scenario.startsWith('move') ? await openMove(page, fixture.moved.id) : null
    const window = editorAndMove?.move ?? (scenario === 'assign' ? await openAssignment(page) : await openCancellation(page))
    await choices(window, 'F881').getByRole('radio', { name: toPre ? 'Весь основной НК → до ТО' : 'Весь НК до ТО → основной' }).check()
    const submit = window.getByRole('button', { name: scenario === 'assign' ? 'Назначить ПСТО' : scenario === 'cancel' ? 'Отменить ПСТО на линии' : 'Подтвердить перенос', exact: true })
    await expect(window.getByText(/В итоговых заключениях будут очищены обе роли/)).toBeVisible()
    await expect(submit).toBeDisabled()
    expect((await snapshot(fixture.moved.id)).controls).toEqual(before.controls)
    const accept = window.getByRole('checkbox', { name: 'Подтверждаю очистку обеих ролей в объединяемых заключениях' })
    await accept.check()
    await accept.uncheck()
    await expect(submit).toBeDisabled()
    await accept.check()
    await submit.click()
    if (editorAndMove) {
      await editorAndMove.editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(editorAndMove.editor).toBeHidden()
    } else await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
    await expectPackage(fixture.moved.id, toPre ? 'beforeHeatTreatment' : 'primary')
    await withE2eDatabase(async db => {
      const target = (await db.query('select specialists,row_count from generated_documents where id=$1', [targetId])).rows[0]
      expect(target).toEqual({ specialists: { first: null, second: null }, row_count: 2 })
      const source = (await db.query('select specialists,row_count from generated_documents where id=$1', [fixture.sourceDocumentId])).rows[0]
      expect(source).toEqual({ specialists: historicalSpecialists, row_count: 1 })
    })
  })
}

async function expectSharedDocument(page: Page, fixture: Awaited<ReturnType<typeof seed>>, stage: Stage) {
  const documents = await withE2eDatabase(async db => (await db.query(`select d.id,d.row_count,d.source_metadata,d.specialists,
    array_agg(a.weld_joint_id order by a.weld_joint_id) as ids from generated_documents d
    join generated_document_weld_joints a on a.document_id=d.id
    where d.title='CTX-vik-CONCLUSION' group by d.id order by d.id`)).rows)
  expect(documents).toHaveLength(2)
  for (const document of documents) expect(document.specialists).toEqual(historicalSpecialists)
  const remaining = documents.find(document => document.id === fixture.sourceDocumentId)!
  expect(remaining).toMatchObject({ row_count: 1, ids: [fixture.kept.id] })
  const moved = documents.find(document => document.id !== fixture.sourceDocumentId)!
  expect(moved).toMatchObject({ row_count: 1, ids: [fixture.moved.id] })
  expect(JSON.parse(moved.source_metadata).sourceKind ?? 'primary').toBe(stage)
  const pre = stage === 'beforeHeatTreatment' ? moved : remaining
  expect(JSON.parse(pre.source_metadata).sourcePositions).toEqual([
    expect.objectContaining({ kind: 'beforeHeatTreatment', weldJointId: stage === 'beforeHeatTreatment' ? fixture.moved.id : fixture.kept.id, methodCode: 'ВИК' }),
  ])
  // Follow both real document links. Same title/date must not mix the stages or
  // accidentally select both welds. This reads data without requiring a template.
  for (const [label, included, excluded] of [
    [stage === 'primary' ? 'Основной' : 'До ТО', fixture.moved, fixture.kept],
    [stage === 'primary' ? 'До ТО' : 'Основной', fixture.kept, fixture.moved],
  ] as const) {
    await page.goto('/documents')
    await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
    const documentRow = await documentGridRow(page, 'CTX-vik-CONCLUSION', label)
    await expect(documentRow.center.getByText(label, { exact: true })).toBeVisible()
    await documentRow.actions.getByTitle('Показать стыки документа в отчете ЛНК', { exact: true }).click()
    await expect(page).toHaveURL(/\/lnk(?:\?|$)/)
    await expect(page.locator(`.ag-row[row-id="${included.id}"]`)).toBeVisible()
    await expect(page.locator(`.ag-row[row-id="${excluded.id}"]`)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Изменить этап контроля', exact: true })).toHaveCount(0)
  }
}

// Independent acceptance counterexample: a request is already a package even
// without a result. Line-wide waiting/assignment is not a started PSTO cycle.
for (const scenario of ['assign', 'moveWithoutPsto', 'cancel', 'moveWithPsto'] as const) {
  test(`предкоммит ${scenario}: перенос заявок без результатов, отмена окна и повторное открытие`, async ({ page }) => {
    const toPre = scenario === 'assign' || scenario === 'moveWithPsto'
    const fixture = await seed(toPre ? 'primary' : 'beforeHeatTreatment')
    await withE2eDatabase(async db => {
      if (toPre) {
        for (const method of METHODS) await db.query(`update weld_joints set ${method.key}_result='ожидает НК',
          ${method.key}_conclusion=null,${method.key}_conclusion_date=null,${method.defect}=null,
          rk_exposure_confirmed_diameter=null,final_status='ожидает НК' where id=$1`, [fixture.moved.id])
      } else {
        await db.query(`update pre_heat_treatment_controls set result='ожидает НК',conclusion_name=null,
          conclusion_date=null,defect_description=null,rk_exposure_confirmed_diameter=null where weld_joint_id=$1`, [fixture.moved.id])
      }
      await db.query('delete from generated_document_weld_joints where document_id=$1 and weld_joint_id=$2', [fixture.sourceDocumentId, fixture.moved.id])
      // Keep the fixture's indexed composition consistent with the removed
      // result. A stale sourcePositions entry would test damaged storage rather
      // than the approved request-only transfer.
      await db.query(`update generated_documents set row_count=1,source_metadata=(
        source_metadata::jsonb || jsonb_build_object('positionCount',1,'rowIds',jsonb_build_array($3::int)) ||
        case when source_metadata::jsonb ? 'sourcePositions' then jsonb_build_object('sourcePositions',
          (select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(source_metadata::jsonb->'sourcePositions') p
           where (p->>'weldJointId')::int<>$2)) else '{}'::jsonb end
        )::text where id=$1`, [fixture.sourceDocumentId, fixture.moved.id, fixture.kept.id])
    })
    if (scenario === 'moveWithPsto') await addTarget(fixture, true)
    // The raw conversion from completed controls to request-only controls leaves
    // seed()'s persisted final_status stale (notably pre-TO: awaiting request → NK).
    // Settle the normal derived calculation before the cancellation baseline;
    // navigation may refresh the dispatcher but must still preserve the FULL row.
    const [{ requireDb }, { markDispatcherTaskIndexDirty }, { ensureDispatcherTaskIndexFresh }] = await Promise.all([
      import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'),
      import('../../src/server/dispatcher-task-index'),
    ])
    await markDispatcherTaskIndexDirty(requireDb())
    await ensureDispatcherTaskIndexFresh()
    const before = await snapshot(fixture.moved.id)
    // Every required method has a request and no completed result, in either stage.
    expect(before.row.final_status).toBe('ожидает НК')
    const open = async () => {
      const move = scenario.startsWith('move') ? await openMove(page, fixture.moved.id) : null
      return { move, window: move?.move ?? (scenario === 'assign' ? await openAssignment(page) : await openCancellation(page)) }
    }
    let opened = await open()
    const transferLabel = toPre ? 'Весь основной НК → до ТО' : 'Весь НК до ТО → основной'
    await choices(opened.window, 'F881').getByRole('radio', { name: transferLabel, exact: true }).check()
    // Navigation discards the complete unsaved operation, not just a select.
    await page.goto('/journal')
    expect(await snapshot(fixture.moved.id)).toEqual(before)
    opened = await open()
    await expect(choices(opened.window, 'F881').getByRole('radio', { name: toPre ? 'Оставить основной НК' : 'Оставить НК до ТО', exact: true })).toBeChecked()
    await choices(opened.window, 'F881').getByRole('radio', { name: transferLabel, exact: true }).check()
    await opened.window.getByRole('button', { name: scenario === 'assign' ? 'Назначить ПСТО' : scenario === 'cancel' ? 'Отменить ПСТО на линии' : 'Подтвердить перенос', exact: true }).click()
    if (opened.move) {
      await opened.move.editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(opened.move.editor).toBeHidden()
    } else await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
    await page.reload()
    const after = await snapshot(fixture.moved.id)
    expect(after.controls).toHaveLength(toPre ? 4 : 0)
    for (const method of METHODS) {
      const expected = control(method)
      if (toPre) {
        expect(after.controls.find(row => row.method === method.code)).toMatchObject({ request_name: expected.request_name,
          request_date: expected.request_date, conclusion_name: null, conclusion_date: null })
        expect(after.row[`${method.key}_request`]).toBeNull()
      } else expect(after.row).toMatchObject({ [`${method.key}_request`]: expected.request_name,
        [`${method.key}_request_date`]: expected.request_date, [`${method.key}_conclusion`]: null,
        [`${method.key}_conclusion_date`]: null })
    }
    expect(after.documents.filter(document => String(document.title).endsWith('CONCLUSION'))).toEqual([])
    await expectPackage(fixture.kept.id, toPre ? 'primary' : 'beforeHeatTreatment')
  })
}

for (const unnamed of [false, true]) {
test(`назначение ПСТО: ${unnamed ? 'старые пустые имена требуют KEEP' : 'имена заполнены'}, весь комплект одного стыка и сохранность общего документа`, async ({ page }, testInfo) => {
  const fixture = await seed('primary')
  if (unnamed) await clearOptionalNames(fixture.moved.id, 'primary')
  const assignment = await openAssignment(page)
  for (const joint of ['F881', 'F882']) await expect(choices(assignment, joint).getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  if (unnamed) {
    await expect(choices(assignment, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО', exact: true })).toBeDisabled()
    await expect(choices(assignment, 'F881')).toContainText('наименование заключения')
    await assignment.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
    await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
    await expectPackage(fixture.moved.id, 'primary', true)
    await expectPackage(fixture.kept.id, 'primary')
    return
  }
  await choices(assignment, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО', exact: true }).check()
  await expect(choices(assignment, 'F882').getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  const screenshot = testInfo.outputPath('assignment-contextual-choice.png')
  await assignment.screenshot({ path: screenshot })
  await testInfo.attach('assignment-contextual-choice', { path: screenshot, contentType: 'image/png' })
  await assignment.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
  await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
  await expectPackage(fixture.moved.id, 'beforeHeatTreatment', unnamed)
  await expectPackage(fixture.kept.id, 'primary')
  expect((await snapshot(fixture.moved.id)).row.psto_required).toBe('да')
  expect((await snapshot(fixture.kept.id)).row.psto_required).toBe('да')
  await expectSharedDocument(page, fixture, 'beforeHeatTreatment')
})

test(`перенос на линию без ПСТО: ${unnamed ? 'старые пустые имена требуют KEEP' : 'имена заполнены'}, сохранность истории`, async ({ page }, testInfo) => {
  const fixture = await seed('beforeHeatTreatment')
  if (unnamed) await clearOptionalNames(fixture.moved.id, 'beforeHeatTreatment')
  const { editor, move } = await openMove(page, fixture.moved.id)
  await expect(choices(move, 'F881').getByRole('radio', { name: 'Оставить НК до ТО', exact: true })).toBeChecked()
  if (unnamed) {
    await expect(choices(move, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true })).toBeDisabled()
    await expect(choices(move, 'F881')).toContainText('наименование заключения')
    await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
    await expectPackage(fixture.moved.id, 'beforeHeatTreatment', true)
    await expectPackage(fixture.kept.id, 'beforeHeatTreatment')
    return
  }
  await choices(move, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true }).check()
  const screenshot = testInfo.outputPath('move-contextual-choice.png')
  await move.screenshot({ path: screenshot })
  await testInfo.attach('move-contextual-choice', { path: screenshot, contentType: 'image/png' })
  await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expectPackage(fixture.moved.id, 'primary', unnamed)
  await expectPackage(fixture.kept.id, 'beforeHeatTreatment')
  expect((await snapshot(fixture.moved.id)).row).toMatchObject({ line: TARGET, psto_required: null })
  expect((await snapshot(fixture.kept.id)).row).toMatchObject({ line: SOURCE, psto_required: 'да' })
  await expectSharedDocument(page, fixture, 'primary')
})
}

test('подтверждённый выбор этапа сохраняется при повторном просмотре и закрытии окна до сохранения карточки', async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  const before = await snapshot(fixture.moved.id)
  const { editor, move } = await openMove(page, fixture.moved.id)
  const promote = choices(move, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true })
  await promote.check()
  await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  await expect(move).toBeHidden()
  // Exercise the controller's actual initialDecisions wiring, not just the
  // dialog component. Reviewing a resolved choice must never revert it to KEEP.
  await editor.getByRole('button', { name: 'Посмотреть', exact: true }).click()
  await expect(promote).toBeChecked()
  await move.getByRole('button', { name: 'Вернуться к форме', exact: true }).click()
  await expect(move).toBeHidden()
  await editor.getByRole('button', { name: 'Посмотреть', exact: true }).click()
  await expect(promote).toBeChecked()
  await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  expect(await snapshot(fixture.moved.id)).toEqual(before)
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expectPackage(fixture.moved.id, 'primary')
  await expectPackage(fixture.kept.id, 'beforeHeatTreatment')
})

test('весь комплект без названий: перенос запрещён, KEEP сохраняет факты без создания заключений', async ({ page }) => {
  const fixture = await seed('primary')
  await withE2eDatabase(async db => {
    await db.query('update weld_joints set vik_conclusion=null,rk_conclusion=null,uzk_conclusion=null,pvk_conclusion=null where id=$1', [fixture.moved.id])
    // This weld never had a named conclusion. The existing shared fixture now
    // belongs only to the sibling; keep that real named history unchanged.
    await db.query('delete from generated_document_weld_joints where document_id=$1 and weld_joint_id=$2', [fixture.sourceDocumentId, fixture.moved.id])
    await db.query("update generated_documents set row_count=1,source_metadata=jsonb_set(source_metadata::jsonb,'{positionCount}','1')::text where id=$1", [fixture.sourceDocumentId])
  })
  const before = await snapshot(fixture.moved.id)
  const sibling = await snapshot(fixture.kept.id)
  const assignment = await openAssignment(page)
  await expect(choices(assignment, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО', exact: true })).toBeDisabled()
  await expect(choices(assignment, 'F881').getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
  await assignment.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
  await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
  const after = await snapshot(fixture.moved.id)
  expect(after.controls).toEqual([])
  for (const field of RECORDED_CONTROL_FIELDS) expect(after.row[field], field).toEqual(before.row[field])
  const conclusions = await withE2eDatabase(async db => (await db.query(`select d.id from generated_documents d
    join generated_document_weld_joints a on a.document_id=d.id where a.weld_joint_id=$1 and d.type like 'system:lnkConclusion%'`, [fixture.moved.id])).rows)
  expect(conclusions).toEqual([])
  const kept = await snapshot(fixture.kept.id)
  // Reindexing may materialize the sibling's other named facts and refresh
  // shared requests with the moved line. The existing conclusion/link survives.
  const retained = kept.documents.find(document => document.id === fixture.sourceDocumentId)!
  expect(retained).toMatchObject({ id: fixture.sourceDocumentId, title: 'CTX-vik-CONCLUSION', row_count: 1 })
  expect(JSON.parse(retained.source_metadata)).toMatchObject({ methodCode: 'ВИК', positionCount: 1, lines: [SOURCE] })
  expect(await withE2eDatabase(async db => (await db.query('select weld_joint_id from generated_document_weld_joints where document_id=$1', [fixture.sourceDocumentId])).rows))
    .toEqual([{ weld_joint_id: fixture.kept.id }])
  for (const field of RECORDED_CONTROL_FIELDS) expect(kept.row[field], field).toEqual(sibling.row[field])
})

test('обновление старого кэша убирает прежнюю диагностику полноты и сохраняет неполную историю до ТО', async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  await withE2eDatabase(db => db.query(`update pre_heat_treatment_controls
    set conclusion_name=null,result=case when weld_joint_id=$1 then 'годен (отменен)' else 'ожидает НК' end
    where weld_joint_id=any($2::int[]) and method='ВИК'`, [fixture.moved.id, [fixture.moved.id, fixture.kept.id]]))
  const [{ requireDb }, dispatcher, { markDispatcherTaskIndexDirty }, read, { DISPATCHER_TASK_CALCULATION_VERSION }] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index'),
    import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/weld-read'),
    import('../../src/lib/dispatcher-task-index-payload'),
  ])
  await markDispatcherTaskIndexDirty(requireDb())
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const before = await snapshot(fixture.moved.id)
  // Simulate an otherwise current cache from the previous application version:
  // no source revision bump, no explicit dirty flag to mask version invalidation.
  await withE2eDatabase(async db => {
    await db.query(`update dispatcher_task_index_state
      set repeated_tasks=jsonb_set(repeated_tasks::jsonb,'{version}',to_jsonb($1::int))::text`, [72])
    await db.query("insert into dispatcher_row_tasks (weld_joint_id,task_key,code) values ($1,'code:СП-11','СП-11') on conflict do nothing", [fixture.moved.id])
    const obsolete = { kind: 'check', key: 'obsolete-sp11', row: fixture.moved, sourceRow: fixture.moved,
      sourceJoint: fixture.moved.joint, targetJoint: fixture.moved.joint, baseJoint: fixture.moved.joint,
      suffix: 'R', reason: 'дозаполнить результат ЛНК', details: 'Старая диагностика СП-11' }
    const stalePage = await db.query(`update dispatcher_task_pages set tasks=(tasks::jsonb || $1::jsonb)::text,task_count=task_count+1
      where (scope_key,page_number)=(select scope_key,page_number from dispatcher_task_pages order by scope_key,page_number limit 1)`, [JSON.stringify([obsolete])])
    expect(stalePage.rowCount).toBe(1)
  })
  const pending = await dispatcher.getDispatcherTaskIndexSnapshot({ scheduleRefresh: false })
  expect(pending).toMatchObject({ isFresh: false, repeatedJointTasks: [], repeatedJointTaskCount: 0, taskFilterOptions: [] })
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const persisted = await withE2eDatabase(async db => ({
    tasks: (await db.query("select weld_joint_id from dispatcher_row_tasks where weld_joint_id=any($1::int[]) and code='СП-11' order by weld_joint_id", [[fixture.moved.id, fixture.kept.id]])).rows,
    version: (await db.query("select (repeated_tasks::jsonb->>'version')::int as version from dispatcher_task_index_state")).rows[0]?.version,
  }))
  expect(persisted).toEqual({ tasks: [], version: DISPATCHER_TASK_CALCULATION_VERSION })
  const stalePages = await withE2eDatabase(db => db.query("select count(*)::int as count from dispatcher_task_pages where tasks like '%obsolete-sp11%'"))
  expect(stalePages.rows[0]?.count).toBe(0)
  const after = await snapshot(fixture.moved.id)
  expect(after.controls).toEqual(before.controls)
  for (const field of RECORDED_CONTROL_FIELDS) expect(after.row[field], field).toEqual(before.row[field])
  const virtual = await read.attachDispatcherTaskCodesToPage([fixture.moved, fixture.kept])
  expect(virtual.map(row => String((row as { dispatcherTasks?: string }).dispatcherTasks).includes('СП-11'))).toEqual([false, false])
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(SOURCE)
  // The pinned joint name opens the same picture without scrolling the
  // actions column underneath another pinned column.
  await expect(page.locator('[data-lnk-grid] .journal-grid-frame')).toHaveAttribute('aria-busy', 'false')
  await page.locator('[data-lnk-grid]').getByRole('button', { name: String(fixture.moved.joint), exact: true }).click()
  await page.getByRole('button', { name: /Открыть задачи по стыку:/ }).click()
  await expect(page.getByRole('region', { name: 'Требует действия', exact: true })).not.toContainText('СП-11')
})

const RECORDED_CONTROL_FIELDS = [
  ...METHODS.flatMap(method => [
    ...['request', 'request_date', 'result', 'conclusion', 'conclusion_date'].map(suffix => `${method.key}_${suffix}`),
    method.defect,
  ]),
  'rk_exposure_confirmed_diameter', 'psto_request', 'psto_request_date', 'psto_date',
  'heat_treatment_diagram', 'psto_result', 'psto_note', 'tvmt_request', 'tvmt_request_date',
  'tvmt_result', 'tvmt_conclusion', 'tvmt_conclusion_date',
]

async function addRecordedHistory(id: number, withRepair: boolean) {
  return withLineProgramFixture(async db => {
    // Fact chronology: pre-control ends 05.09, PSTO 07.09, TVMT 08.09,
    // primary VIK 09.09, other primary methods 10.09. Historical spellings and
    // descriptions are deliberate: changing only the line must not clean them.
    for (const method of METHODS) await db.query(`update weld_joints set
      ${method.key}_request=$2,${method.key}_request_date=$3,${method.key}_result=$4,
      ${method.key}_conclusion=$5,${method.key}_conclusion_date=$6,${method.defect}=$7 where id=$1`,
    [id, `  Основная  заявка ${method.code}  `, method.key === 'vik' ? '2026-09-08' : '2026-09-09',
      withRepair && method.key === 'rk' ? 'ремонт' : 'годен (отменен)',
      `  Основное  заключение ${method.code}  `, method.key === 'vik' ? '2026-09-09' : '2026-09-10',
      `${method.code}: исходное описание\nбез  нормализации`])
    await db.query(`update weld_joints set rk_exposure_confirmed_diameter=108,
      psto_request='  Заявка  ПСТО  ',psto_request_date='2026-09-06',psto_date='2026-09-07',
      heat_treatment_diagram='  Диаграмма  ПСТО  ',psto_result='проведено (отменен)',psto_note=$2,
      tvmt_request='  Заявка  ТВМТ  ',tvmt_request_date='2026-09-07',tvmt_result='годен',
      tvmt_conclusion='  Заключение  ТВМТ  ',tvmt_conclusion_date='2026-09-08' where id=$1`,
    [id, 'ПСТО: исходное примечание\nВторая  строка'])
    if (!withRepair) return null
    // An unwelded repair child makes this a real chain move without inventing
    // performed repair work before its source's rejected RK conclusion.
    return (await db.query<{ id: number }>(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,connection_type,material_group,welding_method,
      officiality,revision_actuality,d1,d2,t1,t2,wdi,has_vik,has_rk,has_uzk,has_pvk,psto_required,
      category,group_name,weld_control_percent,pvk_control_percent)
      select line_program_id,project_title,subtitle_code,line,'F881R1',connection_type,material_group,welding_method,
      officiality,revision_actuality,d1,d2,t1,t2,wdi,has_vik,has_rk,has_uzk,has_pvk,psto_required,
      category,group_name,weld_control_percent,pvk_control_percent from weld_joints where id=$1 returning id`, [id])).rows[0]!.id
  })
}

for (const isChain of [false, true]) test(`KEEP: ${isChain ? 'цепочка' : 'один стык'} меняет линию без нормализации фактов НК, ПСТО и ТВМТ`, async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  const childId = await addRecordedHistory(fixture.moved.id, isChain)
  const before = await snapshot(fixture.moved.id)
  const keptBefore = await snapshot(fixture.kept.id)
  const { editor, move } = await openMove(page, fixture.moved.id, isChain)
  const group = choices(move, 'F881')
  await expect(group.getByRole('radio', { name: 'Оставить НК до ТО', exact: true })).toBeChecked()
  await expect(group.getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true })).toBeDisabled()
  if (isChain) await expect(move.getByText('F881R1', { exact: true })).toBeVisible()
  await move.getByRole('button', { name: isChain ? 'Подтвердить перенос цепочки' : 'Подтвердить перенос', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const after = await snapshot(fixture.moved.id)
  expect(after.row).toMatchObject({ line: TARGET, psto_required: null })
  for (const field of RECORDED_CONTROL_FIELDS) expect(after.row[field], field).toEqual(before.row[field])
  expect(after.controls).toEqual(before.controls)
  expect(after.cycles).toEqual(before.cycles)
  // The other weld's exact source position stays in the shared pre-TO document.
  // Derived line metadata may update, but the document itself is not replaced.
  const original = before.documents.find(document => document.id === fixture.sourceDocumentId)!
  const retained = after.documents.find(document => document.id === fixture.sourceDocumentId)!
  expect(retained).toMatchObject({ id: original.id, title: original.title, row_count: original.row_count })
  expect(JSON.parse(retained.source_metadata).sourcePositions).toEqual(JSON.parse(original.source_metadata).sourcePositions)
  const keptAfter = await snapshot(fixture.kept.id)
  expect(keptAfter.row).toEqual(keptBefore.row)
  expect(keptAfter.controls).toEqual(keptBefore.controls)
  expect(keptAfter.documents.some(document => document.id === fixture.sourceDocumentId)).toBe(true)
  if (childId) {
    const child = await snapshot(childId)
    expect(child.row).toMatchObject({ line: TARGET, psto_required: null, joint: 'F881R1', weld_date: null })
    expect(child.controls).toEqual([])
    expect(child.cycles).toEqual([])
  }
})

test('хронология блокирует исправление этапа даже при разрешённом раннем основном НК', async ({ page }) => {
  const fixture = await seed('primary')
  await withE2eDatabase(async db => {
    await db.query("update weld_joints set vik_request_date='2026-08-31' where id=$1", [fixture.moved.id])
    await db.query("update weld_joints set rk_conclusion_date='2026-09-02' where id=$1", [fixture.kept.id])
  })
  const assignment = await openAssignment(page)
  const before = await Promise.all([snapshot(fixture.moved.id), snapshot(fixture.kept.id)])
  for (const joint of ['F881', 'F882']) {
    const group = choices(assignment, joint)
    await expect(group.getByRole('radio', { name: 'Весь основной НК → до ТО', exact: true })).toBeDisabled()
    await expect(group.getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
    await expect(group.getByText(/Перенос недоступен:/)).toBeVisible()
    await expect(group).toContainText(/дат|раньше|позже|ВИК/i)
  }
  await assignment.getByRole('button', { name: 'Назад', exact: true }).click()
  expect(await Promise.all([snapshot(fixture.moved.id), snapshot(fixture.kept.id)])).toEqual(before)
})

test('перенос сохраняет историческую формулировку результата и описание без нормализации', async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  await withE2eDatabase(db => db.query(`update pre_heat_treatment_controls
    set result='годен (отменен)',defect_description='Историческое описание без замены'
    where weld_joint_id=$1 and method='ВИК'`, [fixture.moved.id]))
  const { editor, move } = await openMove(page, fixture.moved.id)
  await choices(move, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true }).check()
  await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const state = await snapshot(fixture.moved.id)
  expect(state.controls).toEqual([])
  expect(state.row).toMatchObject({ line: TARGET, vik_result: 'годен (отменен)',
    vik_defect_description: 'Историческое описание без замены', vik_conclusion: 'CTX-vik-CONCLUSION',
    vik_request_date: '2026-09-02', vik_conclusion_date: '2026-09-03' })
})

test('одна заявка ПСТО запрещает перенос НК: заблокированный UI и подделанное решение не меняют данные', async ({ page }) => {
  const fixture = await seed('beforeHeatTreatment')
  await clearOptionalNames(fixture.moved.id, 'beforeHeatTreatment')
  await withE2eDatabase(db => db.query("update weld_joints set psto_request='CTX-PSTO-REQUEST',psto_request_date='2026-09-06' where id=$1", [fixture.moved.id]))
  const { editor, move } = await openMove(page, fixture.moved.id)
  const group = choices(move, 'F881')
  await expect(group.getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true })).toBeDisabled()
  await expect(group).toContainText(/заявка|история ПСТО/)
  await expect(group.getByRole('radio', { name: 'Оставить НК до ТО', exact: true })).toBeChecked()
  const before = await snapshot(fixture.moved.id)
  expect(before.row).toMatchObject({ psto_request: 'CTX-PSTO-REQUEST', psto_result: null, psto_date: null, tvmt_request: null, tvmt_result: null })
  let forged = false
  const isSave = (url: string) => url.includes('/_serverFn/') && rpcName(url).startsWith('updateWeldJoint')
  await page.route('**/_serverFn/**', async route => {
    if (!forged && isSave(route.request().url())) {
      const body = route.request().postData()!
      expect(body).toContain('pstoLineMoveDisposition')
      expect(body).toContain('keepPrimary')
      forged = true
      await route.continue({ postData: body.replaceAll('keepPrimary', 'movePreHeatTreatmentToPrimary') })
    } else await route.continue()
  })
  await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  const response = page.waitForResponse(response => isSave(response.url()))
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect(await (await response).text()).toMatch(/заявка или история ПСТО\/ТВМТ/)
  expect(forged).toBe(true)
  await expect(editor).toBeVisible()
  await expect(page.getByText(/Исправление этапа невозможно:/).first()).toBeVisible()
  expect(await snapshot(fixture.moved.id)).toEqual(before)
})
