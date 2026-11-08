import { channel } from 'node:diagnostics_channel'
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { linePrograms } from '../../src/db/schema'
import { parseDispatcherTaskIndexPayload } from '../../src/lib/dispatcher-task-index-payload'
import { ensureDispatcherTaskIndexFresh, markDispatcherTaskIndexDirty } from '../../src/server/dispatcher-task-index'
import { getDispatcherScopeKey } from '../../src/server/dispatcher-weld-rows'
import { saveLineProgramInTransaction } from '../../src/server/line-program'
import { updateWeldJoint } from '../../src/server/weld-mutations'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'

const project = 'E2E dispatcher scope completeness'
const scope = (line: string) => ({ projectTitle: project, subtitleCode: 'DEPENDENCIES', line })
const key = (line: string) => getDispatcherScopeKey(scope(line))
const update = asE2eOwner(updateWeldJoint, 'welding.edit')
const state = () => withE2eDatabase(async db => (await db.query('select * from dispatcher_task_index_state where id=1')).rows[0])

// Include every published page and every joint, not just the affected fixture.
// Publication timestamps/revisions differ by design; business payloads do not.
async function snapshot() {
  return withE2eDatabase(async db => {
    const current = (await db.query('select * from dispatcher_task_index_state where id=1')).rows[0]
    const payload = parseDispatcherTaskIndexPayload(current.repeated_tasks)
    payload.chainContinuations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    payload.taskFilterOptions?.sort((a, b) => a.value.localeCompare(b.value))
    return {
      payload, expiry: JSON.parse(current.welder_stamp_expiry_tasks), duplicates: JSON.parse(current.duplicate_keys).sort(),
      pages: (await db.query('select * from dispatcher_task_pages order by scope_key,page_number')).rows,
      codes: (await db.query('select * from dispatcher_row_tasks order by weld_joint_id,task_key,code')).rows,
      joints: (await db.query('select * from weld_joints order by id')).rows,
    }
  })
}

async function untouched(line: string) {
  return withE2eDatabase(async db => ({
    pages: (await db.query('select *,xmin::text as version from dispatcher_task_pages where scope_key=$1 order by page_number', [key(line)])).rows,
    codes: (await db.query(`select t.*,t.xmin::text as version from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id
      where w.project_title=$1 and w.line=$2 order by t.weld_joint_id,t.task_key,t.code`, [project, line])).rows,
    joints: (await db.query('select *,xmin::text as version from weld_joints where project_title=$1 and line=$2 order by id', [project, line])).rows,
  }))
}

async function fullParity() {
  const scoped = await snapshot()
  await markDispatcherTaskIndexDirty(requireDb())
  const refreshed = await ensureDispatcherTaskIndexFresh()
  expect(refreshed.computedRevision).toBe(refreshed.sourceRevision)
  expect(await snapshot()).toEqual(scoped)
}

test.afterEach(() => cleanupLineProgramProjects([project]))

test('real saves include a moved repair, preserve unrelated lines, and remove the old identity after a large-line rename', async () => {
  test.setTimeout(180_000)
  const fixture = await withLineProgramFixture(async db => {
    const programs = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'DEPENDENCIES',line,'II','Б(а)',0,0 from unnest(array['A','B','UNRELATED']) line returning id,line`, [project])).rows
    const a = programs.find(row => row.line === 'A')!.id
    const root = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,d1,t1,weld_length,
      officiality,revision_actuality,has_vik,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,$2,'DEPENDENCIES','A','ОП1','Т1',57,6,100,'действующий','актуальная','да','II','Б(а)',0,0) returning id`, [a, project])).rows[0].id
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,d1,t1,weld_length,
      officiality,revision_actuality,has_vik,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,$2,'DEPENDENCIES','A','ОП'||n,'Т1',57,6,100,'действующий','актуальная','да','II','Б(а)',0,0
      from generate_series(2,6000) n`, [a, project])
    const other = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,d1,t1,weld_length,
      officiality,revision_actuality,has_vik,category,group_name,weld_control_percent,pvk_control_percent,weld_date,stamp_1_k)
      select p.id,$1,'DEPENDENCIES',p.line,case when p.line='B' then 'ОП1R1' else 'ОП999' end,'Т1',57,6,100,
        'действующий','актуальная','да','II','Б(а)',0,0,'2026-10-01','MISSING-SCOPE'
      from line_programs p where p.project_title=$1 and p.line in ('B','UNRELATED') returning id,line`, [project])).rows
    const repair = other.find(row => row.line === 'B')!.id
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      values($1,'primary',$1,null),($2,'repair',$1,$1)`, [root, repair])
    return { root: Number(root), repair: Number(repair), program: Number(a) }
  })
  await ensureDispatcherTaskIndexFresh()
  const stable = await untouched('UNRELATED'), repairBefore = await untouched('B')
  expect(stable.pages.length).toBeGreaterThan(0)
  expect(repairBefore.pages.length).toBeGreaterThan(0)
  const events: string[] = []
  const listener = (value: unknown) => events.push((value as { outcome: string }).outcome)
  channel('welding.dispatcher.scoped-calculation').subscribe(listener)
  try {
    const version = await withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [fixture.root])).rows[0].version as string)
    // Real application mutation: it, not the test, must register the moved
    // descendant's line. Omitting that registration must fail these assertions.
    await update({ data: { id: fixture.root, expectedVersion: version, weldLength: '200.123456789123456789' } })
    const pending = await state()
    expect(pending.full_rebuild).toBe(false)
    expect(JSON.parse(pending.dirty_scopes).map((item: { line: string }) => item.line).sort()).toEqual(['A', 'B'])
    const saved = await untouched('B')
    expect(saved.joints[0].weld_length).toBe('200.123456789123456789')
    expect(saved.pages).toEqual(repairBefore.pages)
    events.length = 0
    await ensureDispatcherTaskIndexFresh()
    expect(events).toEqual(['completed'])
    expect((await untouched('B')).pages.map(row => row.version)).not.toEqual(repairBefore.pages.map(row => row.version))
    expect(await untouched('UNRELATED')).toEqual(stable)
    await fullParity()

    // All 6000 rows move through the real program save. The emptied identity
    // must remain dirty so its old tasks disappear, while B keeps its own facts.
    const beforeRenameB = await untouched('B'), beforeRenameStable = await untouched('UNRELATED')
    const [program] = await requireDb().select().from(linePrograms).where(eq(linePrograms.id, fixture.program))
    await requireDb().transaction(tx => saveLineProgramInTransaction(tx, {
      ...scope('RENAMED'), id: program.id, version: program.updatedAt.toISOString(), category: program.category,
      groupName: program.groupName, weldControlPercent: program.weldControlPercent, pvkControlPercent: program.pvkControlPercent,
    }))
    const renamed = await state()
    expect(renamed.full_rebuild).toBe(false)
    expect(JSON.parse(renamed.dirty_scopes).map((item: { line: string }) => item.line).sort()).toEqual(['A', 'RENAMED'])
    events.length = 0
    await ensureDispatcherTaskIndexFresh()
    expect(events).toEqual(['completed'])
    expect(await untouched('A')).toEqual({ pages: [], codes: [], joints: [] })
    expect((await untouched('RENAMED')).joints).toHaveLength(6000)
    expect(await untouched('B')).toEqual(beforeRenameB)
    expect(await untouched('UNRELATED')).toEqual(beforeRenameStable)
    await fullParity()
  } finally {
    channel('welding.dispatcher.scoped-calculation').unsubscribe(listener)
  }
})
