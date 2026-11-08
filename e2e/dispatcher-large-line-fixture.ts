import assert from 'node:assert/strict'
import { withE2eDatabase } from './database'
import { withLineProgramFixture } from './line-program-fixtures'

export const LARGE_LINE_PROJECT = 'E2E large-line calculation 2026-11-07'
export async function seedDispatcherLargeLineFixture(count: 50000 | 250000) {
  assert([50000, 250000].includes(count))
  await withLineProgramFixture(async db => {
    const { rows: [initial] } = await db.query(`select count(*)::int n from weld_joints`)
    assert.equal(initial.n, 1, 'Only the known setup joint may precede the fixture')
    await db.query(`create temporary table large_line_seed on commit drop as
      select n, case when n<=6000 then 'L-6000' when n<=26000 then 'L-20000' else 'L-'||((n-26001)/100+1)::text end line,
        'Q'||lpad((n%100)::text,3,'0') stamp from generate_series(1,$1::int) n`, [count])
    await db.query(`insert into welder_stamps(naks_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to)
      select 'Q'||lpad(n::text,3,'0'),'Сварщик '||n,'РД','М01','10','1000','1','50','2026-01-01','2027-12-31' from generate_series(0,99) n`)
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,psto_assignment)
      select distinct $1,'S',line,'II','Б(а)',100,'assigned' from large_line_seed`, [LARGE_LINE_PROJECT])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,isometry,weld_date,connection_type,
      officiality,revision_actuality,category,group_name,weld_control_percent,welding_method,material_group,d1,d2,t1,t2,wdi,
      stamp_1_k,stamp_1_z,stamp_1_k_fact,stamp_1_z_fact,
      has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
      has_rk,rk_request,rk_request_date,rk_result,rk_conclusion,rk_conclusion_date,
      psto_required,pre_heat_treatment_required,psto_request,psto_request_date,psto_date,psto_result,heat_treatment_diagram,
      tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date,welding_journal_note)
      select p.id,$1,'S',s.line,'F'||lpad(s.n::text,9,'0'),'ISO-'||s.n,'2026-08-01','С17',
      'действующий','актуальная','II','Б(а)',100,'РД','М01',108,108,4,4,0.42,
      s.stamp,s.stamp,s.stamp,s.stamp,
      'да','V-'||s.n,'2026-09-01','годен','VC-'||s.n,'2026-09-02',
      'да','R-'||s.n,'2026-09-01',case when s.n%31=0 then 'ремонт' else 'годен' end,'RC-'||s.n,'2026-09-02',
      'да',true,'P-'||s.n,'2026-08-22','2026-08-23','проведено','PC-'||s.n,
      'T-'||s.n,'2026-08-23',case when s.n%20=0 then 'не годен' else 'годен' end,'TC-'||s.n,'2026-08-24',
      repeat('Фактические данные и сохранённая история. ',5)
      from large_line_seed s join line_programs p on p.project_title=$1 and p.subtitle_code='S' and p.line=s.line order by s.n`, [LARGE_LINE_PROJECT])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [LARGE_LINE_PROJECT])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,conclusion_name,conclusion_date,result)
      select w.id,m,'PRE-'||w.id,'2026-08-20','PRE-C-'||w.id,'2026-08-21','годен'
      from weld_joints w cross join unnest(array['ВИК','РК']) m where project_title=$1`, [LARGE_LINE_PROJECT])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,heat_treatment_diagram,
      tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
      select id,2,'RP-'||id,'2026-08-25','2026-08-26','проведено','RPC-'||id,'RT-'||id,'2026-08-26','годен','RTC-'||id,'2026-08-27'
      from weld_joints where project_title=$1 and tvmt_result='не годен'`, [LARGE_LINE_PROJECT])
  })
  return withE2eDatabase(async db => {
    await db.query('analyze')
    const { rows: lines } = await db.query(`select line,count(*)::int joints from weld_joints where project_title=$1 group by line order by line`, [LARGE_LINE_PROJECT])
    assert.equal(lines.reduce((sum, row) => sum + row.joints, 0), count)
    assert.equal(lines.find(row => row.line === 'L-6000')?.joints, 6000)
    assert.equal(lines.find(row => row.line === 'L-20000')?.joints, 20000)
    const { rows } = await db.query(`select id,line,joint from weld_joints where project_title=$1 and joint in ('F000000001','F000006001','F000026001') order by id`, [LARGE_LINE_PROJECT])
    return { count, lines: lines.length, targets: rows as { id: number; line: string; joint: string }[] }
  })
}
