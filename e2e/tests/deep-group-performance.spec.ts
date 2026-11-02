import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import type { JournalGridRequest, JournalGridResult } from '../../src/lib/journal-server-grid'
import { measurePairedJournalGroups } from '../deep-group-pair'

const enabled = process.env.DEEP_GROUP_PERF === '1'
test.skip(!enabled, 'Serial HTTP group cost experiment on owned local fixtures')
test.use({ trace: 'off', video: 'off' })
const total = process.env.DEEP_GROUP_ROWS === '200000' ? 200000 : 9000
const mixed = process.env.DEEP_GROUP_MIXED === '1'
const project = 'E2E Deep Group Cost'
let previousOther: string | undefined

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(600000)
  await withLineProgramFixture(async db => {
    previousOther = (await db.query("select value from app_settings where key='other'")).rows[0]?.value
    await db.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}') on conflict(key) do update set value=excluded.value`)
    // Every complete eight-row history has three remaining physical joints:
    // independent S1 (WDI 5) and replacement coils S2Y1/S2Y2 (WDI 7/9).
    // Plain and mixed runs have the same cardinality and page/group boundaries.
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi,officiality,revision_actuality,
      connection_type,has_vik,vik_request,vik_request_date,vik_result,psto_required,psto_request,psto_request_date,psto_result,tvmt_request,tvmt_result)
      select $1,'CODE-'||(((n-1)/8)%3),'GROUP-'||lpad(((n-1)/800)::text,4,'0'),
        case when $3 then 'B'||((n-1)/8)||'-'||(array['S1','S2','S2R1','S2R2','S2R3','S2R3W1','S2Y1','S2Y2'])[(n-1)%8+1] else 'F'||n end,
        date '2026-10-01'+((n-1)%8),case when $3 then (array[5,8,99,99,99,99,7,9])[(n-1)%8+1] else 1 end,
        'действующий','актуальная','С17','да','VIK-'||((n-1)/8),date '2026-10-10',
        case when $3 then (array['годен','ремонт','ремонт','ремонт','вырез','вырез','годен','годен'])[(n-1)%8+1] else 'годен' end,
        'да','PSTO-'||((n-1)/8),date '2026-10-11','проведено','TVMT-'||((n-1)/8),'годен'
      from generate_series(1,$2::int) n`, [project,total,mixed])
    await db.query(`create temporary table deep_group_ids on commit drop as
      select id,row_number() over(order by id)::int as n from weld_joints where project_title=$1`,[project])
    if (mixed) {
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side,replaced_by_coil,replacement_coil_ids)
        select a.id,case when (a.n-1)%8 between 2 and 5 then 'repair' when (a.n-1)%8>=6 then 'coil' else 'primary' end,
          case when (a.n-1)%8 between 2 and 5 then root.id else a.id end,
          case when (a.n-1)%8 between 2 and 5 then prev.id when (a.n-1)%8>=6 then cut.id end,
          case when (a.n-1)%8>=6 then root.id end,case when (a.n-1)%8>=6 then (a.n-1)%8-5 end,
          (a.n-1)%8=1,case when (a.n-1)%8=1 then array[c1.id,c2.id] else '{}'::int[] end
        from deep_group_ids a join deep_group_ids root on root.n=((a.n-1)/8)*8+2
        left join deep_group_ids prev on prev.n=a.n-1 join deep_group_ids cut on cut.n=((a.n-1)/8)*8+6
        join deep_group_ids c1 on c1.n=((a.n-1)/8)*8+7 join deep_group_ids c2 on c2.n=((a.n-1)/8)*8+8`)
      // Sparse histories also exercise relation loading; current repeats keep
      // the same successful stage so physical totals remain independently known.
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result)
        select id,'ВИК','PRE',date '2026-09-30','годен' from deep_group_ids where n%80=1`)
      await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_result,tvmt_request,tvmt_result)
        select id,2,'REPEAT',date '2026-10-12','проведено','TVMT-REPEAT','годен' from deep_group_ids where n%80=1`)
    } else await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from deep_group_ids`)
    for(const table of ['weld_joints','weld_joint_program_states','pre_heat_treatment_controls','psto_repeat_cycles']) await db.query(`analyze ${table}`)
  })
})
test.afterAll(async () => {
  if (!enabled) return
  test.setTimeout(600000)
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(db => previousOther===undefined ? db.query("delete from app_settings where key='other'")
    : db.query("update app_settings set value=$1 where key='other'",[previousOther]))
})

test('root, child, filtered and reopened groups preserve complete physical totals', async ({page},info) => {
  test.setTimeout(1800000)
  let observed=''
  page.on('request',request=>{if(rpcName(request.url()).startsWith('readJournalGrid_')) observed=request.url()})
  await page.goto('/journal')
  await page.getByRole('searchbox',{name:'Быстрый поиск по отчету'}).fill(project)
  await expect(page.getByText(`Найдено: ${total}`,{exact:true})).toBeVisible({timeout:300000})
  await page.waitForLoadState('networkidle')
  if (process.env.DEEP_GROUP_PAIR_BUILD) {
    await measurePairedJournalGroups(page, info, { project, total, mixed })
    return
  }
  const samples:object[]=[]
  // One isolated diagnostic outside timings; record sizes, never task contents.
  const payloadSizes=await withE2eDatabase(async db=>(await db.query(`select octet_length(repeated_tasks) as repeated_tasks_bytes,
    octet_length(welder_stamp_expiry_tasks) as expiry_bytes,octet_length(duplicate_keys) as duplicate_keys_bytes,
    octet_length(dirty_scopes) as dirty_scopes_bytes from dispatcher_task_index_state where id=1`)).rows[0])
  const save=()=>writeFile(info.outputPath('group-cost.json'),JSON.stringify({total,mixed,payloadSizes,samples},null,2))
  const request=async(data:JournalGridRequest)=>{
    const response=await page.request.post(siblingRpcUrl(observed,'readJournalGrid_createServerFn_handler'),{
      data:await serializeRpcData(data),headers:{origin:new URL(observed).origin,'sec-fetch-site':'same-origin',
        'content-type':'application/json','x-tsr-serverFn':'true'},timeout:240000})
    expect(response.ok()).toBe(true)
    const result=await deserializeRpcResponse(await response.text()) as {result:JournalGridResult,error?:Error}
    if(result.error) throw result.error
    return result.result
  }
  for(const report of ['weldingJournal','lnk','heatTreatment'] as const) for(const scope of [project,project.toLowerCase(),project.toUpperCase()]) {
    const base:JournalGridRequest={report,columnFilters:{projectTitle:'='+scope},groupBy:[],route:[],start:0,end:1000}
    const cases:{name:string,data:JournalGridRequest,records?:number}[]=[
      {name:'project-cold',data:{...base,groupBy:['projectTitle']},records:total},
      {name:'project-warm',data:{...base,groupBy:['projectTitle']},records:total},
      {name:'project-add-line',data:{...base,groupBy:['projectTitle','line']},records:total},
      {name:'lines-cold',data:{...base,groupBy:['line']},records:total},
      {name:'nested-open',data:{...base,groupBy:['projectTitle','line'],route:[project]},records:total},
      {name:'line-open',data:{...base,groupBy:['line'],route:['GROUP-0000'],end:100},records:800},
      {name:'line-reopen',data:{...base,groupBy:['line'],route:['GROUP-0000'],end:100},records:800},
      {name:'fragment-then-group',data:{...base,columnFilters:{...base.columnFilters,line:'GROUP-0000'},groupBy:['subtitleCode']},records:800},
      {name:'date-groups',data:{...base,groupBy:['weldDate']},records:total},
      {name:'result-groups',data:{...base,groupBy:['finalStatus']},records:total},
      {name:'wdi-groups',data:{...base,groupBy:['wdi']},records:total},
    ]
    for(const item of cases){
      const before=await auditSqlCount(), detailsBefore=await auditSqlDetails()
      const start=performance.now(),result=await request(item.data),milliseconds=performance.now()-start
      const grouped=item.data.groupBy.length>item.data.route.length
      if(grouped){
        expect(result.rows.reduce((n,row)=>n+row.journalGroup!.recordCount,0),item.name).toBe(item.records)
        if(!['date-groups','result-groups','wdi-groups'].includes(item.name)){
          expect(result.rows.reduce((n,row)=>n+row.journalGroup!.summary.joints,0),item.name).toBe(mixed?item.records!*3/8:item.records)
          expect(result.rows.reduce((n,row)=>n+(row.journalGroup!.summary.wdi??0),0),item.name).toBe(mixed?item.records!*21/8:item.records)
        }
      }else expect(result.rowCount).toBe(item.records)
      const after=await auditSqlCount(),detailsAfter=await auditSqlDetails()
      samples.push({report,scope,name:item.name,milliseconds,statements:before===undefined||after===undefined?undefined:after-before,
        detailsBefore,detailsAfter,result:grouped?result.rows.map(row=>row.journalGroup):{rowCount:result.rowCount,ids:result.rows.map(row=>row.id)}})
      await save()
    }
  }
})
