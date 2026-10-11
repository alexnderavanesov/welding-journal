import { expect, test, type Locator, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const PROJECT = 'E2E contextual PSTO correction'
const SOURCE = 'CTX-PSTO-SOURCE'
const TARGET = 'CTX-PSTO-TARGET'
const STAMP = 'ECPC'
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
  return withE2eDatabase(async db => {
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
  await withE2eDatabase(async db => {
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
  await program.getByLabel('Поиск линий', { exact: true }).fill(SOURCE)
  await expect(program.getByText(SOURCE, { exact: true })).toBeVisible()
  await program.getByRole('button', { name: 'Назначить', exact: true }).click()
  const assignment = dialog(page, 'Назначение ПСТО')
  await expect(choices(assignment, 'F881')).toBeVisible()
  return assignment
}

async function openMove(page: Page, id: number, isChain = false) {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(SOURCE)
  await page.locator(`tr[data-weld-row-id="${id}"]`).getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = dialog(page, 'Редактирование стыка')
  const input = editor.getByText('Линия', { exact: true }).locator('..').getByRole('textbox')
  await input.fill(TARGET)
  await input.press('Tab')
  const move = dialog(page, isChain ? 'Перенос цепочки F881' : 'Перенос стыка на другую линию')
  await expect(choices(move, 'F881')).toBeVisible()
  return { editor, move }
}

async function expectSharedDocument(page: Page, fixture: Awaited<ReturnType<typeof seed>>, stage: Stage) {
  const documents = await withE2eDatabase(async db => (await db.query(`select d.id,d.row_count,d.source_metadata,
    array_agg(a.weld_joint_id order by a.weld_joint_id) as ids from generated_documents d
    join generated_document_weld_joints a on a.document_id=d.id
    where d.title='CTX-vik-CONCLUSION' group by d.id order by d.id`)).rows)
  expect(documents).toHaveLength(2)
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
    const documentRow = page.getByText('CTX-vik-CONCLUSION', { exact: true })
      .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " grid ")][1]')
      .filter({ has: page.getByText(label, { exact: true }) })
    await expect(documentRow).toHaveCount(1)
    await documentRow.getByTitle('Показать стыки документа в отчете ЛНК', { exact: true }).click()
    await expect(page).toHaveURL(/\/lnk(?:\?|$)/)
    await expect(page.locator(`tr[data-weld-row-id="${included.id}"]`)).toBeVisible()
    await expect(page.locator(`tr[data-weld-row-id="${excluded.id}"]`)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Изменить этап контроля', exact: true })).toHaveCount(0)
  }
}

for (const unnamed of [false, true]) {
test(`назначение ПСТО: ${unnamed ? 'необязательные пустые имена' : 'имена заполнены'}, весь комплект одного стыка и сохранность общего документа`, async ({ page }, testInfo) => {
  const fixture = await seed('primary')
  if (unnamed) await clearOptionalNames(fixture.moved.id, 'primary')
  const assignment = await openAssignment(page)
  for (const joint of ['F881', 'F882']) await expect(choices(assignment, joint).getByRole('radio', { name: 'Оставить основной НК', exact: true })).toBeChecked()
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

test(`перенос на линию без ПСТО: ${unnamed ? 'необязательные пустые имена' : 'имена заполнены'}, весь НК до ТО становится основным, общий документ сохранён`, async ({ page }, testInfo) => {
  const fixture = await seed('beforeHeatTreatment')
  if (unnamed) await clearOptionalNames(fixture.moved.id, 'beforeHeatTreatment')
  const { editor, move } = await openMove(page, fixture.moved.id)
  await expect(choices(move, 'F881').getByRole('radio', { name: 'Оставить НК до ТО', exact: true })).toBeChecked()
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

test('весь комплект без названий: назначение ПСТО и обратный перенос сохраняют факты без создания заключений', async ({ page }) => {
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
  await choices(assignment, 'F881').getByRole('radio', { name: 'Весь основной НК → до ТО', exact: true }).check()
  await assignment.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
  await expect(dialog(page, 'Программа ПСТО')).toBeVisible()
  const intermediate = await snapshot(fixture.moved.id)
  expect(intermediate.controls).toHaveLength(4)
  for (const method of METHODS) expect(intermediate.controls.find(row => row.method === method.code))
    .toMatchObject({ ...control(method), conclusion_name: null })

  const { editor, move } = await openMove(page, fixture.moved.id)
  await choices(move, 'F881').getByRole('radio', { name: 'Весь НК до ТО → основной', exact: true }).check()
  await move.getByRole('button', { name: 'Подтвердить перенос', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
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

test('СП-11 восстанавливается из старого кэша для исторического результата до ТО без имени, но не для ожидания', async ({ page }) => {
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
  // Simulate an otherwise current cache from the previous application version:
  // no source revision bump, no explicit dirty flag to mask version invalidation.
  await withE2eDatabase(async db => {
    await db.query(`update dispatcher_task_index_state
      set repeated_tasks=jsonb_set(repeated_tasks::jsonb,'{version}',to_jsonb($1::int))::text`, [DISPATCHER_TASK_CALCULATION_VERSION - 1])
    await db.query("delete from dispatcher_row_tasks where weld_joint_id=any($1::int[]) and code='СП-11'", [[fixture.moved.id, fixture.kept.id]])
  })
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const persisted = await withE2eDatabase(async db => ({
    tasks: (await db.query("select weld_joint_id from dispatcher_row_tasks where weld_joint_id=any($1::int[]) and code='СП-11' order by weld_joint_id", [[fixture.moved.id, fixture.kept.id]])).rows,
    version: (await db.query("select (repeated_tasks::jsonb->>'version')::int as version from dispatcher_task_index_state")).rows[0]?.version,
  }))
  expect(persisted).toEqual({ tasks: [{ weld_joint_id: fixture.moved.id }], version: DISPATCHER_TASK_CALCULATION_VERSION })
  const virtual = await read.attachDispatcherTaskCodesToPage([fixture.moved, fixture.kept])
  expect(virtual.map(row => String((row as { dispatcherTasks?: string }).dispatcherTasks).includes('СП-11'))).toEqual([true, false])
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(SOURCE)
  // Use the operator-facing task view rather than relying on an expanded
  // dispatcher column in the default report layout.
  await page.locator(`tr[data-weld-row-id="${fixture.moved.id}"]`).getByRole('button', { name: /Открыть картину стыка/ }).click()
  await page.getByRole('button', { name: /Открыть задачи по стыку:/ }).click()
  await expect(page.getByRole('region', { name: 'Требует действия', exact: true })).toContainText('СП-11')
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
  return withE2eDatabase(async db => {
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
  await assignment.getByRole('button', { name: 'К линиям', exact: true }).click()
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
