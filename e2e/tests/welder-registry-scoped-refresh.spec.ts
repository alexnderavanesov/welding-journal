import { expect, test, type Locator } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { DISPATCHER_REFRESH_LOCK_ID } from '../../src/server/dispatcher-task-index-constants'
import { getDispatcherScopeKey } from '../../src/server/dispatcher-weld-rows'
import { getBusinessDateIso } from '../../src/lib/business-date'
import { DISPATCHER_TASK_CALCULATION_VERSION, parseDispatcherTaskIndexPayload } from '../../src/lib/dispatcher-task-index-payload'
import type { RepeatedJointTask, WeldRow } from '../../src/lib/dispatcher-types'

const project = 'E2E registry scoped refresh'
const code = 'ESR1'
const scope = (line: string) => ({ projectTitle: project, subtitleCode: 'SCOPED', line })
const state = () => withE2eDatabase(async db => (await db.query('select * from dispatcher_task_index_state where id=1')).rows[0])

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [code])
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
})
async function fillPermit(editor: Locator) {
  for (const value of ['РАД', 'М01']) await editor.getByRole('button', { name: value, exact: true }).click()
  for (const [label, value] of [['Диаметр от', '1'], ['Диаметр до', '500'], ['Толщина от', '1'], ['Толщина до', '20'],
    ['Срок от', '2026-01-01'], ['Срок до', getBusinessDateIso()]]) await editor.getByLabel(label, { exact: true }).fill(value)
}
const pageVersions = () => withE2eDatabase(async db => (await db.query(
  'select scope_key,page_number,tasks,xmin::text as version from dispatcher_task_pages where scope_key=any($1::text[]) order by scope_key,page_number',
  [['A1', 'A 1', 'B1', 'C1'].map(line => getDispatcherScopeKey(scope(line)))],
)).rows)
const rowVersions = () => withE2eDatabase(async db => (await db.query(
  `select t.weld_joint_id,t.task_key,t.code,t.xmin::text as version from dispatcher_row_tasks t
   join weld_joints w on w.id=t.weld_joint_id where w.project_title=$1 order by t.weld_joint_id,t.task_key`, [project],
)).rows)
const facts = () => withE2eDatabase(async db => (await db.query(
  "select md5(string_agg((to_jsonb(w)-'final_status')::text,'' order by id)) hash from weld_joints w where project_title=$1", [project],
)).rows[0])
function snapshotTaskRow(row: WeldRow): WeldRow {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const normalized = { ...row }
  // In-place full hydration omits empty relations; scoped hydration stores [].
  // getDuplicateControls/getPreHeatTreatmentControls/getRowRepeatCycles read
  // absence as []. Keep null, malformed values and every nonempty relation intact.
  for (const key of ['duplicateControls', 'preHeatTreatmentControls', 'pstoRepeatCycles'] as const) {
    const relations = normalized[key]
    if (Array.isArray(relations) && relations.length === 0) delete normalized[key]
  }
  return normalized
}
function snapshotTask(task: RepeatedJointTask): RepeatedJointTask {
  return 'sourceRow' in task
    ? { ...task, row: snapshotTaskRow(task.row), sourceRow: snapshotTaskRow(task.sourceRow) }
    : { ...task, row: snapshotTaskRow(task.row) }
}
async function semanticSnapshot() {
  const current = await state(), payload = parseDispatcherTaskIndexPayload(current.repeated_tasks)
  // Continuations are a set; scoped publication appends recalculated lines.
  payload.chainContinuations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  payload.tasks = payload.tasks.map(snapshotTask)
  // Full publication uses Map insertion order; scoped GROUP BY has no ORDER BY.
  // The public reader sorts by code. Compare all code/count entries, not storage
  // order; retain duplicates and the distinction between null and an empty list.
  payload.taskFilterOptions?.sort((a, b) => a.value.localeCompare(b.value))
  return { payload, expiry: JSON.parse(current.welder_stamp_expiry_tasks), duplicates: JSON.parse(current.duplicate_keys),
    pages: (await pageVersions()).map(({ version: _version, ...row }) => ({
      ...row, tasks: (JSON.parse(row.tasks) as RepeatedJointTask[]).map(snapshotTask),
    })),
    rows: (await rowVersions()).map(({ version: _version, ...row }) => row),
    statuses: await withE2eDatabase(async db => (await db.query('select id,final_status from weld_joints where project_title=$1 order by id', [project])).rows) }
}

test('UI: no-op/FIO preserve joint indexes; permit edit refreshes complete contexts and matches a full rebuild', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/welder-stamps')
  await page.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Клеймо НАКС', { exact: true }).fill(code)
  await dialog.getByLabel('ФИО сварщика', { exact: true }).fill('До изменения')
  await fillPermit(dialog.locator('[data-permit-editor-id]').first())
  await dialog.getByRole('button', { name: 'Добавить ДЛС', exact: true }).click()
  await dialog.getByLabel('Номер ДЛС', { exact: true }).fill('ДЛС-ESR1')
  await fillPermit(dialog.locator('[data-permit-editor-id]').last())
  await dialog.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  await expect(dialog).toBeHidden()
  await withE2eDatabase(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'SCOPED',line,'II','Б(а)',0,0 from unnest(array['A1','A 1','B1','C1']) line`, [project])
    // A 1 is a different dispatcher scope but shares the chain/status context
    // with A1. It has no changed alias, so reference selection alone is insufficient.
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      connection_type,material_group,welding_method,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,
      stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date)
      select p.id,$1,'SCOPED',p.line,case when p.line='A 1' then 'F981R1' else 'F981' end,'2026-07-01',
        'С17','М01','РАД',case when p.line='C1' then 80 else 108 end,case when p.line='C1' then 80 else 108 end,6,6,'II','Б(а)',0,0,
        v.stamp,v.stamp,v.stamp,v.stamp,v.stamp,v.stamp,'да',
        case when p.line='A1' then 'ремонт' else 'годен' end,'VIK-SCOPE','2026-07-01','VIK-SCOPE-C','2026-07-01'
      from line_programs p cross join lateral (select case when p.line in ('A1','C1') then $2 else 'MISS' end stamp) v
      where p.project_title=$1`, [project, code])
  })
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher, read] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'),
    import('../../src/server/dispatcher-task-index'), import('../../src/server/weld-read'),
  ])
  await markDispatcherTaskIndexDirty(requireDb())
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const beforeFacts = await facts(), beforePages = await pageVersions(), beforeRows = await rowVersions()
  const unaffected = (rows: Awaited<ReturnType<typeof pageVersions>>) => rows.filter(row =>
    ['B1', 'C1'].some(line => row.scope_key === getDispatcherScopeKey(scope(line))))
  expect(unaffected(beforePages).length).toBeGreaterThan(0)
  await page.getByText(code, { exact: true }).first().click()

  async function save(change: () => Promise<void>, verifyPending: (pending: Awaited<ReturnType<typeof state>>) => void) {
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
    await change()
    // Hold only the refresh lock, never the registry/index lock. Real UI saves
    // must complete while a refresh is queued, exposing dirty metadata reliably.
    await withE2eDatabase(async db => {
      await db.query('select pg_advisory_lock($1)', [DISPATCHER_REFRESH_LOCK_ID])
      try {
        await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
        await expect(dialog).toBeHidden()
        verifyPending(await state())
      } finally { await db.query('select pg_advisory_unlock($1)', [DISPATCHER_REFRESH_LOCK_ID]) }
    })
    await dispatcher.ensureDispatcherTaskIndexFresh()
  }
  const beforeNoop = await state()
  await save(async () => {}, pending => {
    expect(pending.source_revision).toBe(beforeNoop.source_revision)
    expect(pending.computed_revision).toBe(beforeNoop.computed_revision)
  })
  expect(await pageVersions()).toEqual(beforePages)
  expect(await rowVersions()).toEqual(beforeRows)

  const beforeName = await state()
  const derivedBefore = await withE2eDatabase(async db => (await db.query('select source_revision from derived_calculation_state where id=1')).rows[0].source_revision)
  await save(() => dialog.getByLabel('ФИО сварщика', { exact: true }).fill('После изменения'), pending => {
    expect(pending.source_revision).toBe(beforeName.source_revision + 1)
    expect(pending.full_rebuild).toBe(false)
    expect(JSON.parse(pending.dirty_scopes)).toEqual([])
  })
  expect(await pageVersions()).toEqual(beforePages)
  expect(await rowVersions()).toEqual(beforeRows)
  expect((await state()).repeated_tasks).toBe(beforeName.repeated_tasks)
  expect(JSON.parse((await state()).welder_stamp_expiry_tasks)).toEqual(expect.arrayContaining([
    expect.objectContaining({ naksStamp: code, stamp: expect.objectContaining({ welderName: 'После изменения' }) }),
  ]))
  expect(await withE2eDatabase(async db => (await db.query('select source_revision from derived_calculation_state where id=1')).rows[0].source_revision)).toBeGreaterThan(derivedBefore)

  // Expanding a real qualification is saved, but every existing use remains
  // eligible. No joint task page should be rewritten just because the card changed.
  await save(async () => {
    for (const editor of await dialog.locator('[data-permit-editor-id]').all()) {
      await editor.getByLabel('Диаметр до', { exact: true }).fill('600')
    }
  }, pending => {
    expect(pending.full_rebuild).toBe(false)
    expect(JSON.parse(pending.dirty_scopes)).toEqual([])
  })
  expect(await pageVersions()).toEqual(beforePages)
  expect(await rowVersions()).toEqual(beforeRows)
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  for (const editor of await dialog.locator('[data-permit-editor-id]').all()) {
    await expect(editor.getByLabel('Диаметр до', { exact: true })).toHaveValue('600')
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  const affected = await withE2eDatabase(async db => (await db.query("select id,joint from weld_joints where project_title=$1 and line='A1'", [project])).rows)
  const compatibilityCodes = async () => (await read.attachDispatcherTaskCodesToPage(affected))
    .map(row => String((row as { dispatcherTasks?: string }).dispatcherTasks ?? ''))
  expect((await compatibilityCodes()).some(value => value.includes('СП-02'))).toBe(false)
  await save(async () => {
    for (const editor of await dialog.locator('[data-permit-editor-id]').all()) {
      await editor.getByLabel('Диаметр до', { exact: true }).fill('100')
    }
  }, pending => {
    expect(pending.full_rebuild).toBe(false)
    expect(JSON.parse(pending.dirty_scopes).sort((a: { line: string }, b: { line: string }) => a.line.localeCompare(b.line)))
      .toEqual([scope('A 1'), scope('A1')].sort((a, b) => a.line.localeCompare(b.line)))
  })
  expect((await compatibilityCodes()).every(value => value.includes('СП-02'))).toBe(true)
  // C1 uses this same card, but its 80 mm joints are still covered by 100 mm.
  const smaller = await withE2eDatabase(async db => (await db.query(
    "select id,joint from weld_joints where project_title=$1 and line='C1'", [project],
  )).rows)
  expect(smaller).toHaveLength(1)
  expect((await read.attachDispatcherTaskCodesToPage(smaller)).every(row =>
    !String((row as { dispatcherTasks?: string }).dispatcherTasks ?? '').includes('СП-02'))).toBe(true)
  expect(unaffected(await pageVersions())).toEqual(unaffected(beforePages))
  expect(await facts()).toEqual(beforeFacts)
  const scoped = await semanticSnapshot()
  await markDispatcherTaskIndexDirty(requireDb())
  await dispatcher.ensureDispatcherTaskIndexFresh()
  expect(await semanticSnapshot()).toEqual(scoped)
  expect(await facts()).toEqual(beforeFacts)
})

test('persisted v71 and ordinary scoped refresh retain the complete same-name repair context without changing facts', async () => {
  test.setTimeout(120_000)
  await withE2eDatabase(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'SCOPED',line,'II','Б(а)',0,0 from unnest(array['A1','A 1','B1']) line`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,weld_date,
      connection_type,material_group,welding_method,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,
      stamp_1_k,has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date)
      select p.id,$1,'SCOPED',p.line,case when p.line='B1' then 'F983' else 'F982' end,
        case when p.line='A 1' then 'неофициальный' else 'действующий' end,
        case when p.line='A1' then null else date '2026-07-01' end,
        'С17','М01','РАД',108,108,6,6,'II','Б(а)',0,0,
        case when p.line='B1' then 'MISS' else null end,
        case when p.line='A1' then null else 'да' end,
        case when p.line='A1' then null when p.line='A 1' then 'ремонт' else 'годен' end,
        case when p.line='A1' then null else 'VIK-CONTEXT' end,
        case when p.line='A1' then null else date '2026-07-01' end,
        case when p.line='A1' then null else 'VIK-CONTEXT-C' end,
        case when p.line='A1' then null else date '2026-07-01' end
      from line_programs p where p.project_title=$1`, [project])
  })
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
  ])
  const targetStatus = () => withE2eDatabase(async db => (await db.query(
    "select final_status from weld_joints where project_title=$1 and line='A1'", [project],
  )).rows[0].final_status)
  const unrelatedPages = async () => (await pageVersions()).filter(row => row.scope_key === getDispatcherScopeKey(scope('B1')))
  await markDispatcherTaskIndexDirty(requireDb())
  await dispatcher.ensureDispatcherTaskIndexFresh()
  expect(await targetStatus()).toBe('ожидает ремонт')
  const beforeFacts = await facts(), complete = await semanticSnapshot(), current = await state()
  const beforeVersionPages = await unrelatedPages()
  expect(beforeVersionPages.length).toBeGreaterThan(0)

  // Model an already-persisted v71 result of refreshing only the official
  // namesake. Equal revisions and today's date must NOT keep this cache fresh.
  await withE2eDatabase(async db => {
    await db.query('begin')
    await db.query("update weld_joints set final_status='ожидает сварку' where project_title=$1 and line='A1'", [project])
    await db.query("update dispatcher_task_index_state set repeated_tasks=jsonb_set(repeated_tasks::jsonb,'{version}','71'::jsonb)::text where id=1")
    await db.query('commit')
  })
  const old = await state()
  expect(old.source_revision).toBe(old.computed_revision)
  expect(old.full_rebuild).toBe(false)
  expect(old.dirty_scopes).toBe('[]')
  expect(getBusinessDateIso(old.computed_at)).toBe(getBusinessDateIso())
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const upgraded = await state()
  expect(parseDispatcherTaskIndexPayload(upgraded.repeated_tasks).version).toBe(DISPATCHER_TASK_CALCULATION_VERSION)
  expect(upgraded.source_revision).toBe(current.source_revision + 1)
  expect(upgraded.computed_revision).toBe(upgraded.source_revision)
  expect(await targetStatus()).toBe('ожидает ремонт')
  expect((await unrelatedPages()).map(row => row.version)).not.toEqual(beforeVersionPages.map(row => row.version))
  expect(await semanticSnapshot()).toEqual(complete)
  expect(await facts()).toEqual(beforeFacts)

  // Ordinary dirty scopes (not the new welder-specific selector) need the same
  // complete context. An isolated A1 read used to overwrite this repair status.
  const beforeScopedPages = await unrelatedPages()
  await markDispatcherTaskIndexDirty(requireDb(), { scopes: [scope('A1')] })
  await dispatcher.ensureDispatcherTaskIndexFresh()
  expect(await targetStatus()).toBe('ожидает ремонт')
  expect(await unrelatedPages()).toEqual(beforeScopedPages)
  expect(await semanticSnapshot()).toEqual(complete)
  expect(await facts()).toEqual(beforeFacts)
})
