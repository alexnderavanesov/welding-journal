import { expect } from '@playwright/test'
import { drizzle } from 'drizzle-orm/node-postgres'
import { invalidateDerivedCalculationCache } from '../src/server/dispatcher-task-index-dirty'
import { withE2eDatabase } from './database'
import { cleanupLineProgramProjects, withLineProgramFixture } from './line-program-fixtures'

export const jointChoiceTotal = 200_000
export const jointChoiceMarker = 'E2E-DEEP-JOINT-CHOICE'
export const jointChoiceIndex = 'e2e_deep_joint_choice_only'
export type JointChoiceProfile = { projects: 4 | 40; distribution: 'repeated' | 'unique' }
export type JointChoicePhase = 'baseline' | 'joint-choice-btree'
export type JointChoiceFact = { id: number; projectTitle: string; subtitleCode: string; line: string; joint: string | null; weldDate: string }
const pad = (n: number, digits: number) => String(n).padStart(digits, '0')
export const jointChoiceNumber = (ordinal: number) => `F${pad(ordinal, 7)}`
export const jointChoiceProject = (ordinal: number) => `${jointChoiceMarker}-PROJECT-${pad(ordinal, 3)}`
export const jointChoiceProjects = (profile: JointChoiceProfile) => Array.from({ length: profile.projects }, (_, n) => jointChoiceProject(n))
export const jointChoiceSelectedProject = (profile: JointChoiceProfile) => jointChoiceProject(16 % profile.projects)
export const normalizedJointChoice = (value: string | null) => (value ?? '').trim().toLowerCase()

/** Independent of SQL, filter builders, report ordering code and HTTP results. */
function fact(n: number, profile: JointChoiceProfile): Omit<JointChoiceFact, 'id'> {
  const edge = n - (jointChoiceTotal - 3)
  return {
    projectTitle: edge >= 0 ? jointChoiceSelectedProject(profile) : jointChoiceProject(n % profile.projects),
    subtitleCode: edge >= 0 ? 'EDGE' : `CODE-${pad(Math.floor(n / profile.projects) % 400, 3)}`,
    line: edge >= 0 ? ['EDGE-NULL', 'EDGE-EMPTY', 'EDGE-SPACE'][edge] : `LINE-${pad(Math.floor(n / 7) % 2000, 4)}`,
    joint: edge >= 0 ? [null, '', '   '][edge] : jointChoiceNumber(profile.distribution === 'unique' ? n + 1 : Math.floor(n / 14_000) * 7 + n % 7 + 1),
    weldDate: `2026-10-${pad(n % 20 + 1, 2)}`,
  }
}
const identity = (row: Omit<JointChoiceFact, 'id'>) => JSON.stringify([row.projectTitle, row.subtitleCode, row.line, row.joint])

export async function inspectJointChoiceFixture() {
  return withE2eDatabase(async db => {
    expect((await db.query('select current_database() as name')).rows[0].name).toBe('welding_tracker_e2e')
    expect((await db.query('select project_title,subtitle_code,line,joint from weld_joints')).rows)
      .toEqual([{ project_title: 'E2E проект', subtitle_code: 'E2E-001', line: 'E2E-L1', joint: 'F1' }])
    const indexes = (await db.query("select indexname,indexdef from pg_indexes where schemaname='public' and tablename='weld_joints' order by indexname")).rows
    expect(indexes.filter(row => row.indexname.startsWith('e2e_')), 'No index left by another diagnostic').toEqual([])
    return { ...(await db.query("select current_database() as database,version(),current_setting('work_mem') as work_mem")).rows[0], indexes }
  })
}

export async function seedJointChoiceFixture(profile: JointChoiceProfile): Promise<JointChoiceFact[]> {
  const expected = Array.from({ length: jointChoiceTotal }, (_, n) => fact(n, profile))
  const byIdentity = new Map(expected.map(row => [identity(row), row]))
  expect(byIdentity.size, 'Joint numbers are unique within project/subtitle/physical line, including explicit legacy controls').toBe(jointChoiceTotal)
  const inserted = await withLineProgramFixture(async db => {
    // Same complete plain VIK/pre-VIK/PSTO/TVMT history as the HTTP fixture.
    // Keep the runner's WDI, dispatcher and business settings unchanged.
    const rows = await db.query<{ id: number; projectTitle: string; subtitleCode: string; line: string; joint: string | null; weldDate: string }>(`
      insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi,officiality,revision_actuality,
        connection_type,d1,t1,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
        psto_required,psto_request,psto_request_date,psto_date,psto_result,
        tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date,final_status,created_at,lnk_created_at,psto_created_at)
      select $1||'-PROJECT-'||lpad((case when n >= $2-3 then 16%$3 else n%$3 end)::text,3,'0'),
        case when n >= $2-3 then 'EDGE' else 'CODE-'||lpad(((n/$3)%400)::text,3,'0') end,
        case when n >= $2-3 then (array['EDGE-NULL','EDGE-EMPTY','EDGE-SPACE'])[n-($2-3)+1]
          else 'LINE-'||lpad(((n/7)%2000)::text,4,'0') end,
        case when n >= $2-3 then (array[null::text,'','   '])[n-($2-3)+1]
          else 'F'||lpad((case when $4::text='unique' then n+1 else (n/14000)*7+n%7+1 end)::text,7,'0') end,
        date '2026-10-01'+n%20,1,'действующий','актуальная','С17',108,4,
        'да','JOINT-CHOICE-VIK',date '2026-10-21','годен','JOINT-CHOICE-VIK-CONCLUSION',date '2026-10-22',
        'да','JOINT-CHOICE-PSTO',date '2026-10-21',date '2026-10-22','проведено',
        'JOINT-CHOICE-TVMT',date '2026-10-23','годен','JOINT-CHOICE-TVMT-CONCLUSION',date '2026-10-24','годен',
        timestamp with time zone '2026-10-20 12:00:00+00',timestamp with time zone '2026-10-20 12:00:00+00',timestamp with time zone '2026-10-20 12:00:00+00'
      from generate_series(0,$2::int-1) n
      returning id,project_title as "projectTitle",subtitle_code as "subtitleCode",line,joint,weld_date::text as "weldDate"`,
    [jointChoiceMarker, jointChoiceTotal, profile.projects, profile.distribution])
    const projects = jointChoiceProjects(profile)
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=any($1::text[])`, [projects])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','JOINT-CHOICE-PRE-VIK',date '2026-10-20','годен','JOINT-CHOICE-PRE-CONCLUSION',date '2026-10-20'
      from weld_joints where project_title=any($1::text[])`, [projects])
    for (const table of ['weld_joints', 'weld_joint_program_states', 'pre_heat_treatment_controls']) await db.query(`analyze ${table}`)
    return rows.rows
  })
  expect(inserted).toHaveLength(jointChoiceTotal)
  const facts = inserted.map(row => {
    const key = identity(row), expectedRow = byIdentity.get(key)
    if (!expectedRow || row.weldDate !== expectedRow.weldDate) throw Error(`Unexpected fixture identity/date for weld ${row.id}`)
    byIdentity.delete(key)
    return { ...expectedRow, id: row.id }
  })
  expect(byIdentity.size).toBe(0)
  return facts
}

export async function jointChoiceSignature(profile: JointChoiceProfile) {
  return withE2eDatabase(async db => (await db.query(`select
    (select md5(coalesce(string_agg(row(key,value)::text,',' order by key),'')) from app_settings) as settings,
    count(*)::int as rows, count(distinct lower(trim(coalesce(joint,''))))::int as choices,
    md5(string_agg(md5(to_jsonb(w)::text),'' order by id)) as facts
    from weld_joints w where project_title=any($1::text[])`, [jointChoiceProjects(profile)])).rows[0])
}

/** Only called after inspectJointChoiceFixture claimed the absent test name. */
export async function setJointChoiceIndex(phase: JointChoicePhase) {
  return withE2eDatabase(async db => {
    const started = performance.now()
    await db.query(`drop index if exists public.${jointChoiceIndex}`)
    if (phase === 'joint-choice-btree') await db.query(`create index ${jointChoiceIndex}
      on public.weld_joints (lower(trim(coalesce(joint::text,''))))`)
    const buildMs = performance.now() - started
    await db.query('analyze weld_joints')
    const indexes = (await db.query(`select indexrelname,pg_get_indexdef(indexrelid) as definition,pg_relation_size(indexrelid)::int as bytes
      from pg_stat_user_indexes where schemaname='public' and indexrelname=$1`, [jointChoiceIndex])).rows
    expect(indexes).toHaveLength(phase === 'baseline' ? 0 : 1)
    // Fact-preserving fixture cache reset, never a dispatcher/business switch.
    await invalidateDerivedCalculationCache(drizzle(db))
    return { buildMs, indexes }
  })
}

export async function removeJointChoiceIndex() {
  await withE2eDatabase(async db => {
    await db.query(`drop index if exists public.${jointChoiceIndex}`)
    expect((await db.query("select indexname from pg_indexes where schemaname='public' and indexname=$1", [jointChoiceIndex])).rows).toEqual([])
  })
}
export const cleanupJointChoiceFixture = (profile: JointChoiceProfile) => cleanupLineProgramProjects(jointChoiceProjects(profile))
