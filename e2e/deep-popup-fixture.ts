import { expect } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from './line-program-fixtures'
import { withE2eDatabase } from './database'

export const popupMarker = 'E2E-DEEP-POPUP'
export const popupRows = Number(process.env.DEEP_POPUP_ROWS ?? 9000)
const pad = (value: number, digits: number) => String(value).padStart(digits, '0')
export const popupProjects = Array.from({ length: 40 }, (_, n) => `${popupMarker}-PROJECT-${pad(n, 3)}`)
export type PopupFact = { id: number; projectTitle: string; subtitleCode: string; line: string; joint: string; weldDate: string; finalStatus: string }
export type PopupField = Exclude<keyof PopupFact, 'id'>
let previousOther: string | undefined
let settingsOwned = false

/** Formula is independent of the filter implementation, SQL choices and RPC results. */
export function popupFact(n: number, id: number): PopupFact {
  return { id, projectTitle: popupProjects[n % 40], subtitleCode: `CODE-${pad(Math.floor(n / 40) % 400, 3)}`,
    line: `LINE-${pad(Math.floor(n / 7) % 2000, 4)}`, joint: `F${pad(n + 1, 7)}`,
    weldDate: `${n % 20 < 10 ? '2025-09' : '2026-10'}-${pad(n % 10 + 1, 2)}`,
    // A factual VIK rejection remains a rejection even with completed later stages.
    finalStatus: n % 5 === 0 ? 'не годен' : 'годен' }
}

export async function setupPopupFixture(): Promise<PopupFact[]> {
  expect([9000, 200000]).toContain(popupRows)
  await withE2eDatabase(async db => {
    const rows = (await db.query('select project_title,subtitle_code,line,joint from weld_joints')).rows
    expect(rows).toEqual([{ project_title: 'E2E проект', subtitle_code: 'E2E-001', line: 'E2E-L1', joint: 'F1' }])
  })
  const facts = await withLineProgramFixture(async db => {
    previousOther = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}')
      on conflict(key) do update set value=excluded.value`)
    settingsOwned = true
    const inserted = await db.query<{ id: number; joint: string }>(`insert into weld_joints(
      project_title,subtitle_code,line,joint,weld_date,wdi,officiality,revision_actuality,connection_type,d1,t1,
      has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
      psto_required,psto_request,psto_request_date,psto_date,psto_result,
      tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date,final_status,
      created_at,lnk_created_at,psto_created_at)
      select $1||'-PROJECT-'||lpad(((n-1)%40)::text,3,'0'),
        'CODE-'||lpad((((n-1)/40)%400)::text,3,'0'),
        'LINE-'||lpad((((n-1)/7)%2000)::text,4,'0'),'F'||lpad(n::text,7,'0'),
        (case when (n-1)%20<10 then date '2025-09-01' else date '2026-10-01' end)+((n-1)%10),
        1,'действующий','актуальная','С17',108,4,
        'да','POPUP-VIK',date '2026-10-21',case when (n-1)%5=0 then 'ремонт' else 'годен' end,'POPUP-VIK-CONCLUSION',date '2026-10-22',
        'да','POPUP-PSTO',date '2026-10-21',date '2026-10-22','проведено',
        'POPUP-TVMT',date '2026-10-23','годен','POPUP-TVMT-CONCLUSION',date '2026-10-24',
        case when (n-1)%5=0 then 'не годен' else 'годен' end,
        timestamp with time zone '2026-10-20 12:00:00+00',timestamp with time zone '2026-10-20 12:00:00+00',timestamp with time zone '2026-10-20 12:00:00+00'
      from generate_series(1,$2::int) n returning id,joint`, [popupMarker, popupRows])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=any($1::text[])`, [popupProjects])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','POPUP-PRE-VIK',date '2026-10-20','годен','POPUP-PRE-VIK-CONCLUSION',date '2026-10-20'
      from weld_joints where project_title=any($1::text[])`, [popupProjects])
    for (const table of ['weld_joints', 'weld_joint_program_states', 'pre_heat_treatment_controls']) await db.query(`analyze ${table}`)
    // Never assume sequence contiguity or derive expected IDs from the tested RPC.
    return inserted.rows.map(row => popupFact(Number(row.joint.slice(1)) - 1, row.id))
  })
  expect(facts).toHaveLength(popupRows)
  return facts
}

export async function cleanupPopupFixture() {
  await cleanupLineProgramProjects(popupProjects)
  if (settingsOwned) await withLineProgramFixture(async db => {
    if (previousOther === undefined) await db.query("delete from app_settings where key='other'")
    else await db.query("update app_settings set value=$1 where key='other'", [previousOther])
  })
}
