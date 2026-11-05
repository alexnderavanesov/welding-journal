import { withLineProgramFixture, cleanupLineProgramProjects } from './line-program-fixtures'
export const SMOOTHNESS_PROJECT = 'E2E smoothness 2026-11-05'
export async function seedSmoothnessFixture() {
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'SM-CODE-'||(n%5),'SM-'||lpad(n::text,4,'0'),'II','Б(а)',case when n%3=0 then 100 else 10 end,10
      from generate_series(1,50) n`, [SMOOTHNESS_PROJECT])
    await db.query(`insert into welder_stamps(naks_stamp,internal_stamp,welder_name,weld_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits,dls_permits)
      select 'Q'||lpad((n-1)::text,3,'0'),'SMI'||lpad(n::text,4,'0'),'Сварщик плавности '||lpad(n::text,4,'0'),'РД','М01','10','1000','1','50','2026-01-01','2027-12-31','[]','[]'
      from generate_series(1,1000) n`)
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
      officiality,revision_actuality,welding_method,material_group,d1,d2,t1,t2,weld_length,wdi,stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,psto_required,psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram,tvmt_request,tvmt_result)
      select p.id,p.project_title,p.subtitle_code,p.line,case when n%5=0 then 'ОП' else 'F' end||lpad(n::text,4,'0'),date '2026-10-01'+(n%28),
      case when n%5=0 then 'Т1' when n%5=1 then 'У19' else 'С17' end,'действующий','актуальная','РД','М01',108,108,4,4,
      case when n%5=0 then 600.123 end,case when n%5<>0 then 0.42 end,
      s.naks_stamp,s.naks_stamp,s.naks_stamp,s.naks_stamp,s.naks_stamp,s.naks_stamp,
      'да','SM-V-'||p.line,date '2026-10-01',case when n%7=0 then 'ожидает НК' else 'годен' end,
      case when n%7<>0 then 'SM-C-'||p.line end,case when n%7<>0 then date '2026-10-02' end,
      'да','SM-P-'||p.line,date '2026-10-01','проведено',date '2026-10-02','SM-D-'||p.line,'SM-TV-'||p.line,'годен'
      from line_programs p cross join generate_series(1,100) n join welder_stamps s on s.naks_stamp='Q'||lpad((n-1+((right(p.line,4)::int-1)%10)*100)::text,3,'0')
      where p.project_title=$1`, [SMOOTHNESS_PROJECT])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=$1`, [SMOOTHNESS_PROJECT])
    await db.query(`insert into specialists(name,kind,certificate,methods)
      select 'SM специалист '||lpad(n::text,4,'0'),'inspector','SM-CERT-'||n,array['ВИК','РК','УЗК','ПВК'] from generate_series(1,500) n`)
    await db.query(`insert into technology_cards(name,welding_methods,connection_type,material_groups,diameter_from,diameter_to,thickness_from,thickness_to,psto)
      select 'SM-TK-'||lpad(n::text,4,'0'),array['РД'],'С17',array['М01'],10,1000,1,50,'any' from generate_series(1,500) n`)
    await db.query(`insert into technology_card_names(name,technology_card_id) select name,id from technology_cards where name like 'SM-TK-%'`)
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select kind,'SM-DOC-'||kind||'-'||lpad(n::text,4,'0'),'smoothness.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1
      from unnest(array['weldingJournal','checklist','zni','layeredVikEdges','layeredVikLayers','layeredPvkEdges','layeredPvkLayers']) kind cross join generate_series(1,100) n`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d cross join weld_joints w where d.title like 'SM-DOC-%' and w.project_title=$1 and w.line='SM-0001' and w.joint='F0001'`, [SMOOTHNESS_PROJECT])
    await db.query(`insert into audit_operations(id,actor_name,action,area,source)
      select 'smoothness-'||n,'Проверка плавности','updateWeldJoint','welding','application' from generate_series(1,500) n`)
    await db.query(`insert into audit_changes(operation_id,entity,entity_id,label,area,kind,changes)
      select id,'weld_joints','0','Тестовая запись','welding','update','{"notes":{"before":"","after":"проверка"}}'::jsonb from audit_operations where id like 'smoothness-%'`)
  })
}
export async function cleanupSmoothnessFixture() {
  await cleanupLineProgramProjects([SMOOTHNESS_PROJECT])
  await withLineProgramFixture(async db => {
    await db.query("delete from generated_documents where title like 'SM-DOC-%'")
    await db.query("delete from technology_cards where name like 'SM-TK-%'")
    await db.query("delete from specialists where name like 'SM специалист %'")
    await db.query("delete from welder_stamps where welder_name like 'Сварщик плавности %'")
    await db.query("delete from audit_changes where operation_id like 'smoothness-%'")
    await db.query("delete from audit_operations where id like 'smoothness-%'")
  })
}
