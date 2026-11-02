import { expect } from '@playwright/test'
import { getTableColumns } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { weldJoints } from '../src/db/schema'
import { markDispatcherTaskIndexDirty } from '../src/server/dispatcher-task-index-dirty'
import { DISPATCHER_BACKGROUND_INDEX_LOCK_ID, DISPATCHER_REFRESH_LOCK_ID } from '../src/server/dispatcher-task-index-constants'
import { withE2eDatabase } from './database'
import { cleanupLineProgramProjects, withLineProgramFixture } from './line-program-fixtures'

export const writeIndexProfile = process.env.DEEP_FILTER_WRITE_INDEX_PROFILE ?? 'coalesce-v1'
export type WriteIndexPhase = 'baseline' | 'coalesce-gin' | 'raw-gin' | 'choice-btree' | 'joint-choice-btree'
export const writeJointChoiceIndex = 'e2e_deep_write_joint_choice_only_v1'
export const writeJointChoiceExpression = "lower(trim(coalesce(joint::text,'')))"
const jointChoiceOnly = writeIndexProfile === 'joint-choice-only-v1'
const ginPhase: WriteIndexPhase = writeIndexProfile === 'raw-v2' ? 'raw-gin' : 'coalesce-gin'
export const writePhaseOrders: WriteIndexPhase[][] = jointChoiceOnly ? [
  ['baseline', 'joint-choice-btree'], ['joint-choice-btree', 'baseline'], ['baseline', 'joint-choice-btree'],
] : [
  ['baseline', ginPhase, 'choice-btree'], [ginPhase, 'choice-btree', 'baseline'], ['choice-btree', 'baseline', ginPhase],
]
const marker = 'E2E-DEEP-WRITE'
export const writeProjects = Array.from({ length: 40 }, (_, n) => `${marker}-PROJECT-${String(n).padStart(3, '0')}`)
export const writeProject = writeProjects[0]
export const writeStamp = 'DHW1'
const card = 'E2E DEEP WRITE ТК'
const fields = ['project_title', 'subtitle_code', 'line', 'joint']
const indexNames = jointChoiceOnly ? [writeJointChoiceIndex]
  : fields.flatMap(field => [`e2e_deep_write_${field}_trgm`, `e2e_deep_write_${field}_raw_trgm`, `e2e_deep_write_${field}_choice`])
export const writeTargets = [
  { mode: 'save', count: 1, line: 'HTTP-WRITE-SAVE', initial: null },
  { mode: 'massFill', count: 100, line: 'HTTP-WRITE-MASS-0100', initial: null },
  { mode: 'massFill', count: 500, line: 'HTTP-WRITE-MASS-0500', initial: null },
  { mode: 'replaceData', count: 100, line: 'HTTP-WRITE-REPLACE-0100', initial: 'BEFORE' },
  { mode: 'replaceData', count: 500, line: 'HTTP-WRITE-REPLACE-0500', initial: 'BEFORE' },
  { mode: 'newRecords', count: 100, line: 'HTTP-WRITE-NEW-0100', initial: null },
  { mode: 'newRecords', count: 500, line: 'HTTP-WRITE-NEW-0500', initial: null },
] as const
export type WriteTarget = typeof writeTargets[number]
const existingTargetRows = writeTargets.reduce((sum, target) => sum + (target.mode === 'newRecords' ? 0 : target.count), 0)

// The same qualification inputs are accepted first by the real create RPC.
// UI new-record imports later use those inputs through their own full preview
// and server validation; no save-check/dispatcher settings are disabled.
export const qualifiedWriteRecord = {
  projectTitle: writeProject, subtitleCode: 'WRITE', connectionType: 'С17', weldingMethod: 'РАД', materialGroup: 'М01',
  weldDate: '2026-10-01', d1: 108, d2: 108, t1: 6, t2: 6,
  stamp1K: writeStamp, stamp1Z: writeStamp, stamp1O: writeStamp,
  stamp1KFact: writeStamp, stamp1ZFact: writeStamp, stamp1OFact: writeStamp,
  technologyCardNumber: card,
}

export async function prepareWriteReferences(total: number) {
  expect(['coalesce-v1', 'raw-v2', 'joint-choice-only-v1']).toContain(writeIndexProfile)
  let ownedExtension = false
  await withE2eDatabase(async db => {
    const seed = (await db.query('select project_title,subtitle_code,line,joint from weld_joints')).rows
    expect(seed).toEqual([{ project_title: 'E2E проект', subtitle_code: 'E2E-001', line: 'E2E-L1', joint: 'F1' }])
    expect((await db.query('select indexname from pg_indexes where indexname=any($1::text[])', [indexNames])).rows).toEqual([])
    if (jointChoiceOnly) {
      const experimentalIndexes = (await db.query("select indexname from pg_indexes where schemaname='public' and tablename='weld_joints'")).rows
        .filter(row => row.indexname.startsWith('e2e_'))
      expect(experimentalIndexes, 'The single-index comparison must not inherit another diagnostic index').toEqual([])
    } else {
      const extension = (await db.query("select installed_version from pg_available_extensions where name='pg_trgm'")).rows
      expect(extension).toHaveLength(1)
      if (!extension[0].installed_version) { await db.query('create extension pg_trgm'); ownedExtension = true }
    }
  })
  await withLineProgramFixture(async db => {
    const permit = { id: 'naks', weldType: 'РАД', materialGroups: 'М01', diameterFrom: '1', diameterTo: '500',
      thicknessFrom: '1', thicknessTo: '20', validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false }
    await db.query('insert into welder_stamps(naks_stamp,welder_name,naks_permits,dls_permits) values($1,$2,$3,$4)',
      [writeStamp, 'HTTP индекс — квалифицированный сварщик', JSON.stringify([permit]), JSON.stringify([{ ...permit, id: 'dls', number: 'ДЛС-DHW1' }])])
    const saved = (await db.query(`insert into technology_cards(name,welding_methods,connection_type,material_groups,
      diameter_from,diameter_to,thickness_from,thickness_to,psto,first_used_at)
      values($1,array['РАД'],'С17',array['М01'],1,500,1,20,'any',now()) returning id`, [card])).rows[0]
    await db.query('insert into technology_card_names(name,technology_card_id) values($1,$2)', [card, saved.id])
    for (const target of writeTargets) await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,
      weld_control_percent,pvk_control_percent,psto_assignment) values($1,'WRITE',$2,'II','Б(а)',0,0,'unassigned')`, [writeProject, target.line])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      select ($1::text[])[n%40+1],'BG-CODE-'||lpad((n%20)::text,3,'0'),'BG-LINE-'||lpad(n::text,4,'0'),'II','Б(а)',0,0,'unassigned'
      from generate_series(0,ceil(($2::int-$3::int)/100.0)::int-1) n`, [writeProjects, total, existingTargetRows])
    await db.query('analyze line_programs')
  })
  return { ownedExtension }
}

export async function cloneCanonicalWriteFixture(prototypeId: number, total: number) {
  return withLineProgramFixture(async db => {
    const columns = Object.values(getTableColumns(weldJoints)).map(column => column.name).filter(name => name !== 'id')
    const destinations = writeTargets.filter(target => target.mode !== 'save' && target.mode !== 'newRecords')
    await db.query(`insert into weld_joints(${columns.map(name => `"${name}"`).join(',')})
      select ${columns.map(name => `record."${name}"`).join(',')}
      from weld_joints prototype cross join (
        select $2::text as project_title,'WRITE' as subtitle_code,target.line,'F'||lpad(n::text,7,'0') as joint,target.initial as isometry
        from jsonb_to_recordset($3::jsonb) target(line text,count integer,initial text) cross join lateral generate_series(1,target.count) n
        union all
        select ($4::text[])[((n-1)/100)%40+1],'BG-CODE-'||lpad((((n-1)/100)%20)::text,3,'0'),
          'BG-LINE-'||lpad(((n-1)/100)::text,4,'0'),'F'||lpad(n::text,7,'0'),'BACKGROUND'
        from generate_series(1,$5::int-$6::int) n
      ) destination
      join line_programs program on program.project_title=destination.project_title
        and program.subtitle_code=destination.subtitle_code and program.line=destination.line
      cross join lateral jsonb_populate_record(null::weld_joints,to_jsonb(prototype)||jsonb_build_object(
        'project_title',destination.project_title,'subtitle_code',destination.subtitle_code,'line',destination.line,
        'line_program_id',program.id,'joint',destination.joint,'isometry',destination.isometry)) record
      where prototype.id=$1`, [prototypeId, writeProject, JSON.stringify(destinations), writeProjects, total, existingTargetRows])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=any($1::text[])
      on conflict(weld_joint_id) do nothing`, [writeProjects])
    const shape = (await db.query('select count(*)::int as n,count(distinct project_title)::int as projects from weld_joints where project_title=any($1::text[])', [writeProjects])).rows[0] as { n: number; projects: number }
    expect(shape.n).toBe(total)
    expect(shape.projects).toBe(40)
    for (const table of ['weld_joints', 'weld_joint_program_states', 'line_programs']) await db.query(`analyze ${table}`)
    return shape
  })
}

/** Fixture reset only. Ordinary measured mutations never use this path. */
export async function resetWriteTargets() {
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      await db.query('select pg_advisory_xact_lock($1)', [DISPATCHER_REFRESH_LOCK_ID])
      await db.query('select pg_advisory_xact_lock($1)', [DISPATCHER_BACKGROUND_INDEX_LOCK_ID])
      for (const target of writeTargets) {
        if (target.mode === 'newRecords') await db.query('delete from weld_joints where project_title=$1 and subtitle_code=$2 and line=$3', [writeProject, 'WRITE', target.line])
        else await db.query('update weld_joints set isometry=$1 where project_title=$2 and subtitle_code=$3 and line=$4', [target.initial, writeProject, 'WRITE', target.line])
      }
      await markDispatcherTaskIndexDirty(drizzle(db), { scopes: writeTargets.map(target => ({ projectTitle: writeProject, subtitleCode: 'WRITE', line: target.line })) })
      await db.query('commit')
    } catch (error) { await db.query('rollback'); throw error }
  })
}

export async function setWriteIndexes(phase: WriteIndexPhase) {
  expect(writePhaseOrders.flat()).toContain(phase)
  return withE2eDatabase(async db => {
    await db.query(`drop index if exists ${indexNames.join(',')}`)
    // The preceding fixture reset is committed. Remove its dead versions in
    // every variant so later phases do not inherit an ever-growing heap. This
    // preparation cost is disclosed separately, never hidden inside a save.
    const vacuumStarted = performance.now()
    await db.query('vacuum (analyze) weld_joints')
    const vacuumMs = performance.now() - vacuumStarted, started = performance.now()
    if (phase === 'joint-choice-btree') await db.query(`create index ${writeJointChoiceIndex} on weld_joints (${writeJointChoiceExpression})`)
    else if (phase !== 'baseline') for (const field of fields) await db.query(phase === 'coalesce-gin'
      ? `create index e2e_deep_write_${field}_trgm on weld_joints using gin (coalesce(${field},'') gin_trgm_ops)`
      : phase === 'raw-gin' ? `create index e2e_deep_write_${field}_raw_trgm on weld_joints using gin (${field} gin_trgm_ops)`
      : `create index e2e_deep_write_${field}_choice on weld_joints (lower(trim(coalesce(${field}::text,''))))`)
    const buildMs = performance.now() - started
    await db.query('analyze weld_joints')
    const indexes = (await db.query(`select indexrelname,pg_get_indexdef(indexrelid) as definition,pg_relation_size(indexrelid)::int as bytes from pg_stat_user_indexes
      where indexrelname=any($1::text[]) order by indexrelname`, [indexNames])).rows
    expect(indexes).toHaveLength(phase === 'baseline' ? 0 : jointChoiceOnly ? 1 : fields.length)
    if (phase === 'joint-choice-btree') expect(indexes[0].indexrelname).toBe(writeJointChoiceIndex)
    return { vacuumMs, buildMs, indexes }
  })
}

export async function finishWriteGinPending(phase: WriteIndexPhase) {
  if (phase !== 'coalesce-gin' && phase !== 'raw-gin') return { milliseconds: 0, pages: [] }
  return withE2eDatabase(async db => {
    const started = performance.now(), pages: number[] = []
    for (const field of fields) pages.push((await db.query('select gin_clean_pending_list($1::regclass)::int as pages', [
      `e2e_deep_write_${field}_${phase === 'raw-gin' ? 'raw_trgm' : 'trgm'}`,
    ])).rows[0].pages)
    return { milliseconds: performance.now() - started, pages }
  })
}

export async function writeStoredFacts(line: string) {
  return withE2eDatabase(async db => (await db.query(`select id,xmin::text as version,to_jsonb(w) as fact from weld_joints w
    where project_title=any($1::text[]) and line=$2 order by id`, [writeProjects, line])).rows as Array<{ id: number; version: string; fact: Record<string, unknown> }>)
}

export async function writeBackgroundSignature() {
  return withE2eDatabase(async db => (await db.query(`select count(*)::int as rows,
    md5(string_agg(md5(to_jsonb(w)::text),'' order by id)) as facts from weld_joints w
    where project_title=any($1::text[]) and line like 'BG-LINE-%'`, [writeProjects])).rows[0])
}

export async function cleanupWriteFixture(ownedExtension: boolean) {
  await withE2eDatabase(async db => {
    await db.query(`drop index if exists ${indexNames.join(',')}`)
    if (ownedExtension) await db.query('drop extension pg_trgm')
  })
  await cleanupLineProgramProjects(writeProjects)
  await withLineProgramFixture(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [writeStamp])
    await db.query('delete from technology_card_names where name=$1', [card])
    await db.query('delete from technology_cards where name=$1', [card])
  })
}
