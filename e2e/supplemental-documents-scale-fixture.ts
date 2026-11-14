import { withE2eDatabase } from './database'
import { withLineProgramFixture } from './line-program-fixtures'

export const EXTRA_DOCUMENT_PROJECT = 'E2E supplementary document registries 2026-11-13'
export const EXTRA_DOCUMENT_PROFILES = [
  { id: 'custom1', label: 'Пользовательский 1', types: ['custom1'], layered: false },
  { id: 'custom2', label: 'Пользовательский 2', types: ['custom2'], layered: false },
  { id: 'layeredVik', label: 'Послойный ВИК', types: ['layeredVikEdges', 'layeredVikLayers'], layered: true },
  { id: 'layeredPvk', label: 'Послойный ПВК', types: ['layeredPvkEdges', 'layeredPvkLayers'], layered: true },
] as const

export function extraDocumentTitle(profile: string, ordinal: number) {
  return `XDS-${profile}-${String(ordinal).padStart(5, '0')}`
}

/** Standalone opt-in runner only. Its database is verified empty by global
 * setup; this second guard rejects reuse of another suite's fixture. The
 * runner owns cleanup, so no destructive preparation or hidden reset occurs. */
export async function seedExtraDocumentBackground() {
  await withE2eDatabase(async db => {
    const { rows: [before] } = await db.query(`select
      (select count(*)::int from weld_joints) joints,
      (select count(*)::int from weld_joints where project_title='E2E проект' and joint='F1' and line='E2E-L1') setup_joints,
      (select count(*)::int from generated_documents) documents,
      (select count(*)::int from app_settings where key='custom-document-names') custom_names`)
    if (before.joints !== 1 || before.setup_joints !== 1 || before.documents !== 0 || before.custom_names !== 0) {
      throw new Error('Supplemental document scale requires a fresh, runner-owned E2E database with only its setup joint')
    }
  })
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,
        connection_type,officiality,revision_actuality,d1,d2,t1,t2,wdi)
      select $1,'XDS','XDS-L-'||lpad(((n-1)/1000)::text,3,'0'),
        'F'||lpad(n::text,6,'0'),'XDS-ISO-'||lpad(n::text,6,'0'),date '2026-10-01'+(n%28),
        'У19','действующий','актуальная',108,108,4,4,0.42
      from generate_series(1,200000) n`, [EXTRA_DOCUMENT_PROJECT])
    await db.query('analyze weld_joints')
  })
}

/** Documents and relation cardinality grow independently of 200k joints.
 * Manual documents mix 1/5/20 positions. Layered documents remain valid
 * one-joint cards, with edges/layers sharing a joint, not fictitious bulk cards. */
export async function growExtraDocumentRegistries(previous: number, count: 1000 | 5000) {
  if (!((previous === 0 && count === 1000) || (previous === 1000 && count === 5000))) throw new Error('Unexpected supplemental fixture growth')
  return withE2eDatabase(async db => {
    await db.query('begin')
    try {
      const before = (await db.query('select count(*)::int n from generated_documents')).rows[0].n
      if (before !== previous * EXTRA_DOCUMENT_PROFILES.length) throw new Error('Supplemental fixture changed outside this runner')
      for (const profile of EXTRA_DOCUMENT_PROFILES) {
        await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,created_at,updated_at)
          select ($1::text[])[case when $2 then (n-1)%2+1 else 1 end],
            $3||lpad(n::text,5,'0'),'fixture.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '2026-10-01','2026-10-28',case when $2 then 1 when n%3=0 then 1 when n%3=1 then 5 else 20 end,
            timestamptz '2026-11-01T09:00:00Z'+n*interval '1 second',timestamptz '2026-11-01T09:00:00Z'+n*interval '1 second'
          from generate_series($4::int+1,$5::int) n`, [profile.types, profile.layered, `XDS-${profile.id}-`, previous, count])
        await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
          select d.id,w.id from generate_series($1::int+1,$2::int) n
          join generated_documents d on d.title=$3||lpad(n::text,5,'0') and d.type=any($4::text[])
          cross join lateral generate_series(1,d.row_count) position_index
          join weld_joints w on w.project_title=$5 and w.isometry='XDS-ISO-'||lpad(
            ((case when $6 then (n-1)/2 else n-1 end)*40+position_index)::text,6,'0')`,
        [previous, count, `XDS-${profile.id}-`, profile.types, EXTRA_DOCUMENT_PROJECT, profile.layered])
      }
      await db.query('analyze generated_documents')
      await db.query('analyze generated_document_weld_joints')
      const manualPositions = Array.from({ length: count }, (_, i) => (i + 1) % 3 === 0 ? 1 : (i + 1) % 3 === 1 ? 5 : 20).reduce((sum, n) => sum + n, 0)
      const { rows: [actual] } = await db.query(`select
        (select count(*)::int from weld_joints where project_title=$1) fixture_joints,
        (select count(*)::int from weld_joints) database_joints,
        (select count(*)::int from generated_documents) documents,
        (select count(*)::int from generated_document_weld_joints) relations,
        (select sum(row_count)::int from generated_documents) declared_positions`, [EXTRA_DOCUMENT_PROJECT])
      const expected = { fixture_joints: 200000, database_joints: 200001, documents: count * 4,
        relations: manualPositions * 2 + count * 2, declared_positions: manualPositions * 2 + count * 2 }
      for (const [key, value] of Object.entries(expected)) if (actual[key] !== value) throw new Error(`Supplemental fixture ${key}: ${actual[key]} != ${value}`)
      const profiles = []
      for (const profile of EXTRA_DOCUMENT_PROFILES) {
        const rows = (await db.query<{ id: number; title: string; type: string; positions: number; lines: string[] }>(`select d.id,d.title,d.type,
          count(a.weld_joint_id)::int positions,array_agg(distinct w.line order by w.line) lines
          from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
          join weld_joints w on w.id=a.weld_joint_id where d.type=any($1::text[])
          group by d.id order by d.title`, [profile.types])).rows
        if (rows.length !== count) throw new Error(`Missing ${profile.id} documents`)
        profiles.push({ ...profile, rows })
      }
      await db.query('commit')
      return { countPerRegistry: count, expected, actual, profiles }
    } catch (error) { await db.query('rollback'); throw error }
  })
}
