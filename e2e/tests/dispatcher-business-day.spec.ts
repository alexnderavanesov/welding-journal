import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { getBusinessDateIso } from '../../src/lib/business-date'
import { getDispatcherScopeKey } from '../../src/server/dispatcher-weld-rows'
import { parseDispatcherTaskIndexPayload } from '../../src/lib/dispatcher-task-index-payload'
import { getPreHeatTreatmentReportValue, PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS } from '../../src/lib/pre-heat-treatment-report-fields'
import type { WeldInput } from '../../src/lib/weld-fields'

const project = 'E2E dispatcher business day'
const scope = (line: string) => ({ projectTitle: project, subtitleCode: 'DAY', line })
const state = () => withE2eDatabase(async db => (await db.query('select * from dispatcher_task_index_state where id=1')).rows[0])
const pages = () => withE2eDatabase(async db => (await db.query(
  'select scope_key,page_number,tasks,xmin::text as version from dispatcher_task_pages order by scope_key,page_number',
)).rows)
const facts = () => withE2eDatabase(async db => (await db.query(
  "select md5(string_agg((to_jsonb(w)-'final_status')::text,'' order by id)) hash from weld_joints w where project_title=$1", [project],
)).rows[0])

// Only this isolated test worker's pure server calls use a previous date. The
// application/OS clocks and all production code remain untouched.
async function atDate<T>(date: string, run: () => Promise<T>) {
  const OriginalDate = globalThis.Date
  globalThis.Date = new Proxy(OriginalDate, {
    construct: (target, args) => Reflect.construct(target, args.length ? args : [`${date}T12:00:00Z`]),
  })
  try { return await run() } finally { globalThis.Date = OriginalDate }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (!value || typeof value !== 'object') return value
  const record = { ...value } as Record<string, unknown>
  // Full hydration keeps source controls, scoped hydration also supplies virtual
  // report fields. Check every supplied field against its source, then fill only
  // absent derived values so equal semantics do not require equal redundancy.
  if (Number.isSafeInteger(record.id) && Array.isArray(record.preHeatTreatmentControls)) {
    for (const key of PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS) {
      const expected = getPreHeatTreatmentReportValue(record as WeldInput, key)
      if (key in record) expect(record[key]).toEqual(expected)
      if (expected !== undefined) record[key] = expected
    }
  }
  return Object.fromEntries(Object.entries(record).filter(([key, entry]) =>
    !(['duplicateControls', 'preHeatTreatmentControls', 'pstoRepeatCycles'].includes(key) && Array.isArray(entry) && entry.length === 0),
  ).map(([key, entry]) => [key, normalize(entry)]))
}

async function semanticSnapshot() {
  const current = await state(), payload = parseDispatcherTaskIndexPayload(current.repeated_tasks)
  payload.chainContinuations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  payload.taskFilterOptions?.sort((a, b) => a.value.localeCompare(b.value))
  return normalize({ payload, expiry: JSON.parse(current.welder_stamp_expiry_tasks), duplicates: current.duplicate_keys,
    pages: (await pages()).map(({ version: _version, tasks, ...row }) => ({ ...row, tasks: JSON.parse(tasks) })),
    codes: await withE2eDatabase(async db => (await db.query('select weld_joint_id,task_key,code from dispatcher_row_tasks order by weld_joint_id,task_key')).rows),
  })
}

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query("delete from welder_stamp_suspensions where naks_stamp='DAY1'")
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
})

test('new day refreshes complete affected lines, preserves past lines and is equivalent to a full calculation', async ({ page }) => {
  const today = getBusinessDateIso(), date = new Date(`${today}T12:00:00Z`)
  const yesterday = new Date(date.getTime() - 86400_000).toISOString().slice(0, 10)
  const tomorrow = new Date(date.getTime() + 86400_000).toISOString().slice(0, 10)
  await withE2eDatabase(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'DAY',line,'II','Б(а)',0,0 from unnest(array['A1','A 1','B1','C1']) line`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      connection_type,material_group,welding_method,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,stamp_1_k,has_vik)
      select p.id,$1,'DAY',p.line,'F891',case when p.line='A1' then $2::date when p.line='C1' then $3::date else $4::date end,
        'С17','М01','РАД',108,108,6,6,'II','Б(а)',0,0,'DAY1','да'
      from line_programs p where p.project_title=$1`, [project, today, tomorrow, yesterday])
    await db.query("insert into welder_stamp_suspensions(naks_stamp,suspended_from) values('DAY1',$1)", [yesterday])
  })
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
  ])
  await markDispatcherTaskIndexDirty(requireDb())
  await atDate(yesterday, () => dispatcher.ensureDispatcherTaskIndexFresh())
  const oldState = await state(), oldPages = await pages(), originalFacts = await facts()
  const forLine = (rows: Awaited<ReturnType<typeof pages>>, line: string) => rows.filter(row => row.scope_key === getDispatcherScopeKey(scope(line)))
  const tasks = (rows: Awaited<ReturnType<typeof pages>>, line: string) => forLine(rows, line).flatMap(row => JSON.parse(row.tasks))
  expect(tasks(oldPages, 'A1').some(task => task.details?.includes('позже сегодняшней'))).toBe(true)
  expect(tasks(oldPages, 'A1').some(task => task.details?.includes('отстранено'))).toBe(false)
  expect(forLine(oldPages, 'B1').length).toBeGreaterThan(0)

  const fresh = await dispatcher.ensureDispatcherTaskIndexFresh()
  expect(fresh.sourceRevision).toBe(oldState.source_revision + 1)
  expect(dispatcher.isDispatcherTaskIndexFresh(fresh)).toBe(true)
  const dailyPages = await pages()
  expect(forLine(dailyPages, 'B1')).toEqual(forLine(oldPages, 'B1'))
  expect(forLine(dailyPages, 'A 1')).not.toEqual(forLine(oldPages, 'A 1')) // whole whitespace-equivalent context
  expect(tasks(dailyPages, 'A1').some(task => task.details?.includes('позже сегодняшней'))).toBe(false)
  expect(tasks(dailyPages, 'A1').some(task => task.details?.includes('отстранено'))).toBe(true)
  expect(tasks(dailyPages, 'C1').some(task => task.details?.includes(today.split('-').reverse().join('.')))).toBe(true)
  expect(await facts()).toEqual(originalFacts)
  const daily = await semanticSnapshot()
  await markDispatcherTaskIndexDirty(requireDb())
  await dispatcher.ensureDispatcherTaskIndexFresh()
  expect(await semanticSnapshot()).toEqual(daily)
  expect(await facts()).toEqual(originalFacts)

  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await expect(page.getByRole('button', { name: 'F891', exact: true })).toHaveCount(4)
})

test('day-only refresh keeps all stored joint tasks untouched when every weld date is in the past', async () => {
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
  ])
  await markDispatcherTaskIndexDirty(requireDb())
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const beforePages = await pages(), before = await state()
  await withE2eDatabase(db => db.query("update dispatcher_task_index_state set computed_at=computed_at-interval '1 day' where id=1"))
  const fresh = await dispatcher.ensureDispatcherTaskIndexFresh()
  expect(dispatcher.isDispatcherTaskIndexFresh(fresh)).toBe(true)
  expect(fresh.sourceRevision).toBe(before.source_revision + 1)
  expect(fresh.repeatedTasks).toBe(before.repeated_tasks)
  expect(await pages()).toEqual(beforePages)
})

for (const source of ['main', 'duplicate', 'pre-TO'] as const) {
  test(`new day removes suspension proposal based on ${source} control date, even when welding is old`, async () => {
    const today = getBusinessDateIso(), yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400_000).toISOString().slice(0, 10)
    await withE2eDatabase(async db => {
      await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        values($1,'DAY','REJECTED','II','Б(а)',10,0)`, [project])
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
        connection_type,material_group,welding_method,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,stamp_1_k,has_rk,rk_result,rk_conclusion_date)
        select p.id,$1,'DAY',p.line,'F89'||n,'2026-07-01','С17','М01','РАД',108,108,6,6,'II','Б(а)',10,0,'DAY1','да',
          case when $2='main' then 'вырез' else null end,case when $2='main' then $3::date else null end
        from line_programs p cross join generate_series(1,4) n where p.project_title=$1`, [project, source, today])
      if (source === 'duplicate') await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date)
        select id,'РК','вырез',$2 from weld_joints where project_title=$1`, [project, today])
      if (source === 'pre-TO') await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,conclusion_date)
        select id,'РК','вырез',$2 from weld_joints where project_title=$1`, [project, today])
      await db.query("insert into welder_stamp_suspensions(naks_stamp,suspended_from) values('DAY1',$1)", [yesterday])
    })
    const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher] = await Promise.all([
      import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
    ])
    await markDispatcherTaskIndexDirty(requireDb())
    await atDate(yesterday, () => dispatcher.ensureDispatcherTaskIndexFresh())
    const hasProposal = async () => (await pages()).flatMap(row => JSON.parse(row.tasks)).some(task =>
      task.row.projectTitle === project && task.issue === 'suspend-welder')
    expect(await hasProposal()).toBe(true)
    await dispatcher.ensureDispatcherTaskIndexFresh()
    expect(await hasProposal()).toBe(false)
    const daily = await semanticSnapshot()
    await markDispatcherTaskIndexDirty(requireDb())
    await dispatcher.ensureDispatcherTaskIndexFresh()
    expect(await semanticSnapshot()).toEqual(daily)
  })
}
