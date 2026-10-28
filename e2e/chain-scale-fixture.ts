import assert from 'node:assert/strict'
import { withE2eDatabase } from './database'
import { withLineProgramFixture } from './line-program-fixtures'

const project = 'E2E chain-scale background'

// An opt-in background for the existing operator workflows, not a substitute
// for their own small, independently asserted chains. The runner owns and
// drops this disposable database; no working database or fixture is reused.
export async function seedChainScaleBackground() {
  await withLineProgramFixture(async db => {
    assert.equal((await db.query('select count(*)::int n from weld_joints')).rows[0].n, 1)
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,weld_type,material_groups,
      diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to)
      values('AUDS','Scale background','РД','М01','1','1000','1','100','2026-01-01','2026-12-31')`)
    const { rows: [card] } = await db.query(`insert into technology_cards(name,welding_methods,connection_type,
      material_groups,diameter_from,diameter_to,thickness_from,thickness_to,psto)
      values($1,array['РД'],'С17',array['М01'],1,1000,1,100,'any') returning id`, [project])
    await db.query('insert into technology_card_names(name,technology_card_id) values($1,$2)', [project, card.id])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'SCALE','CHAIN-SCALE-'||lpad(n::text,4,'0'),'II','Б(а)',0,0 from generate_series(1,1000) n`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,isometry,
      weld_date,officiality,revision_actuality,connection_type,material_group,welding_method,d1,d2,t1,t2,
      category,group_name,weld_control_percent,pvk_control_percent,technology_card_number,
      stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,vik_result,vik_conclusion,vik_conclusion_date,has_rk,rk_result,rk_conclusion,rk_conclusion_date,psto_required)
      select p.id,p.project_title,p.subtitle_code,p.line,'S'||lpad(((n-1)/8+1)::text,6,'0')||
        (array['','R1','R1W1','R1W2','Y1','Y1R1','Y2','Y2R1'])[(n-1)%8+1],n::text,
        '2026-09-01'::date+(n-1)%8,'действующий','актуальная','С17','М01','РД',108,108,4,4,
        'II','Б(а)',0,0,$1,'AUDS','AUDS','AUDS','AUDS','AUDS','AUDS',
        'да','годен','SCALE-VIK-'||n,'2026-09-01'::date+(n-1)%8,'да',
        (array['ремонт','вырез','вырез','вырез','ремонт','годен','ремонт','годен'])[(n-1)%8+1],
        'SCALE-RK-'||n,'2026-09-01'::date+(n-1)%8,'нет'
      from generate_series(1,200000) n join line_programs p
        on p.project_title=$1 and p.line='CHAIN-SCALE-'||lpad(((n-1)/200+1)::text,4,'0')`, [project])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,
      coil_parent_id,coil_side,replaced_by_coil,replacement_coil_ids)
      select id,case when side=0 then 'primary' when side in (4,6) then 'coil' else 'repair' end,
        case when side<4 then ids[1] when side<6 then ids[5] else ids[7] end,
        case when side=0 then null when side<4 then ids[side] when side in (4,6) then ids[4] else ids[side] end,
        case when side in (4,6) then ids[1] end,case when side=4 then 1 when side=6 then 2 end,side=0,
        case when side=0 then array[ids[5],ids[7]] else array[]::int[] end
      from (select id,(isometry::int-1)%8 side,
        array_agg(id) over(partition by (isometry::int-1)/8 order by isometry::int
          rows between unbounded preceding and unbounded following) ids
        from weld_joints where project_title=$1) fixture`, [project])
    for (const table of ['weld_joints', 'line_programs', 'weld_joint_program_states']) await db.query(`analyze ${table}`)
  })
  const before = await backgroundSignature()
  assert.equal(before.count, 200_000)
  console.log('CHAIN_SCALE_BACKGROUND', JSON.stringify(before))
  return async () => {
    // The normal dispatcher may update its derived final status. All stored
    // operator facts and stable chain identities must survive unrelated edits.
    assert.deepEqual(await backgroundSignature(), before)
    console.log('CHAIN_SCALE_BACKGROUND_PRESERVED', JSON.stringify(before))
  }
}

function backgroundSignature() {
  return withE2eDatabase(async db => (await db.query(`select count(*)::int count,
    md5(string_agg(md5((to_jsonb(w)-'final_status')::text),'' order by w.id)) facts,
    md5(string_agg(md5(to_jsonb(s)::text),'' order by w.id)) topology
    from weld_joints w join weld_joint_program_states s on s.weld_joint_id=w.id where w.project_title=$1`, [project])).rows[0])
}
