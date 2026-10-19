import { expect, test } from '@playwright/test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { getLnkDisplayValue } from '../../src/lib/lnk-status'
import { calculateWdi, isSystemWdiMode } from '../../src/lib/wdi'
import type { WeldPageRequest } from '../../src/server/weld-contracts'

const project = 'E2E LNK read 200k'
async function cleanup() {
  await withE2eDatabase(db => db.query(`delete from weld_joint_program_states s using weld_joints w where s.weld_joint_id=w.id and w.project_title=$1`,[project]))
  await cleanupLineProgramProjects([project])
}
test.beforeEach(cleanup)
test.afterEach(cleanup)

test('200k ЛНК: both page paths, filters, stages, roots, coils and output use bounded query counts', async ({}, info) => {
  test.setTimeout(300_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,connection_type,d1,t1,wdi,
      officiality,revision_actuality,has_vik,has_rk,psto_required,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
      rk_request,rk_request_date,rk_result,rk_conclusion,rk_conclusion_date)
      select $1,'LNK-READ','LNK-READ-'||lpad(((n-1)/5000+1)::text,2,'0'),
        case when n%100 in (51,52) then 'F'||lpad((n-n%100+50)::text,6,'0')||'Y'||(n%100-50)
          when n%20=0 then 'F'||lpad((n-1)::text,6,'0')||'R1' else 'F'||lpad(n::text,6,'0') end,
        lpad(n::text,6,'0'),'2026-06-01','С17',114,6,case when n%20=0 then 99 else 7 end,
        'действующий','актуальная','да','да',case when n%20=0 then 'да' end,
        'VIK-'||n,'2026-07-01','годен','VIK-C-'||n,'2026-07-02',
        'RK-'||n,'2026-07-02',case when n%100=50 then 'вырез' when n%20=19 then 'ремонт' else 'годен' end,
        'RK-C-'||n,'2026-07-03'::date+n%25 from generate_series(1,200000) n`,[project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,method,'PRE-'||method||'-'||isometry,'2026-06-02',
        case when method='РК' and isometry::int%40=0 then 'ремонт' else 'годен' end,
        'PRE-C-'||method||'-'||isometry,'2026-06-03'
      from weld_joints cross join unnest(array['ВИК','РК']) method where project_title=$1 and isometry::int%20=0`,[project])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side,replaced_by_coil,replacement_coil_ids)
      select id,case when n%100 in (51,52) then 'coil' when n%20=0 then 'repair' else 'primary' end,
        case when n%20=0 then previous_id else id end,case when n%20=0 then previous_id end,
        case when n%100=51 then previous_id when n%100=52 then second_previous_id end,
        case when n%100 in (51,52) then n%100-50 end,n%100=50,
        case when n%100=50 then array[next_id,second_next_id] else array[]::int[] end
      from(select id,isometry::int n,lag(id) over(order by isometry) previous_id,
        lag(id,2) over(order by isometry) second_previous_id,lead(id) over(order by isometry) next_id,
        lead(id,2) over(order by isometry) second_next_id from weld_joints where project_title=$1) fixture`,[project])
    const counts=(await db.query(`select count(*)::int total,count(w.weld_date)::int welded,count(s.weld_joint_id)::int states,
      count(*) filter(where s.kind='repair')::int repairs,count(*) filter(where s.kind='coil')::int sides,
      count(*) filter(where s.replaced_by_coil)::int replaced from weld_joints w
      left join weld_joint_program_states s on s.weld_joint_id=w.id where w.project_title=$1`,[project])).rows[0]
    expect(counts).toEqual({total:200000,welded:200000,states:200000,repairs:10000,sides:4000,replaced:2000})
    for(const table of ['weld_joints','weld_joint_program_states','pre_heat_treatment_controls']) await db.query(`analyze ${table}`)
  })
  // Fixture ordinals determine expected roots independently of persisted states.
  const identities=await withE2eDatabase(async db=>(await db.query<{id:number;n:number}>(
    `select id,isometry::int n from weld_joints where project_title=$1 and isometry::int<=5000 order by isometry`,[project])).rows)
  const byOrdinal=new Map(identities.map(row=>[row.n,row.id]))
  const {listReportPage,normalizeWeldPageRequest,listColumnFilterOptions,normalizeWeldColumnFilterOptionsRequest}=await import('../../src/server/weld-read')
  const {ensureDispatcherTaskIndexFresh,isDispatcherTaskIndexFresh}=await import('../../src/server/dispatcher-task-index')
  const {loadServerOtherSettings}=await import('../../src/server/weld-server-shared')
  expect(isDispatcherTaskIndexFresh(await ensureDispatcherTaskIndexFresh())).toBe(true)
  const settings=await loadServerOtherSettings()
  const rootWdi=isSystemWdiMode(settings)?calculateWdi({connectionType:'С17',d1:'114',t1:'6',d2:null,t2:null},settings):7
  type Statement={sql:string;rows:number|null;columns:number}
  let statements:Statement[]=[]
  const original=pg.Client.prototype.query
  pg.Client.prototype.query=function(this:pg.Client,...args:unknown[]){
    type Callback=(error:Error|null,reply?:pg.QueryResult)=>unknown
    const config=args[0] as string|{text?:string;callback?:Callback}
    const entry:Statement={sql:typeof config==='string'?config:config.text??'',rows:null,columns:0}
    statements.push(entry)
    const capture=(reply:pg.QueryResult)=>{entry.rows=reply.rowCount??0;entry.columns=reply.fields.length}
    const observe=(callback:Callback):Callback=>function(this:unknown,error,reply){if(reply)capture(reply);return callback.call(this,error,reply)}
    if(typeof args[2]==='function')args[2]=observe(args[2] as Callback)
    else if(typeof args[1]==='function')args[1]=observe(args[1] as Callback)
    else if(typeof config==='object'&&config.callback)args[0]={...config,callback:observe(config.callback)}
    const result=(original as (...args:unknown[])=>unknown).apply(this,args)
    return result&&typeof(result as Promise<unknown>).then==='function'?(result as Promise<pg.QueryResult>).then(reply=>{capture(reply);return reply}):result
  } as typeof original
  const measurements:Array<{name:string;rows:number;sql:number;bytes:number;ms:number;widestRead:number}>=[]
  let ordinaryQueries:number|undefined,derivedQueries:number|undefined
  async function measure(name:string,request:WeldPageRequest,ordinals?:number[],derived=false){
    statements=[]
    const started=performance.now()
    const result=await listReportPage('lnk',normalizeWeldPageRequest({projectTitle:project,page:1,pageSize:100,includeTotals:false,
      sort:{fieldKey:'isometry',direction:'asc'},...request}))
    measurements.push({name,rows:result.rows.length,sql:statements.length,bytes:Buffer.byteLength(JSON.stringify(result)),
      ms:Math.round(performance.now()-started),widestRead:Math.max(...statements.filter(s=>s.columns>20).map(s=>s.rows??0),0)})
    if(ordinals)expect(result.rows.map(row=>row.id)).toEqual(ordinals.map(n=>byOrdinal.get(n)))
    // Calculated predicates may publish a bounded page-ID cache. Counts must
    // stay bounded on both cold and warm reads, including narrow ID queries.
    expect(statements.length).toBeLessThanOrEqual(derived ? 26 : 14)
    if (derived) expect(Math.max(...statements.map(statement => statement.rows ?? 0))).toBeLessThanOrEqual(Math.max(1000, result.rows.length * 2))
    const roots=statements.filter(s=>s.sql.includes('"journal_physical_root"'))
    expect(roots).toHaveLength(1)
    expect(roots[0].rows).toBe(result.rows.length)
    for(const row of result.rows){
      const n=Number(row.isometry),root=n%20===0?n-1:n
      // Bulk facts use Node assertions to avoid quadratic trace-step lookup.
      assert.deepEqual(row.groupPhysicalRoot,{id:byOrdinal.get(root),exists:true,wdi:rootWdi,replaced:root%100===50})
      assert.equal(row.programChainState?.physicalRootId,byOrdinal.get(root))
      assert.equal(row.rkResult,n%100===50?'вырез':n%20===19?'ремонт':'годен')
      if(n%20===0){
        assert.equal(row.preHeatTreatmentControls?.length,2)
        assert.equal(getLnkDisplayValue(row,'preRkResult'),n%40===0?'ремонт':'годен')
        assert.equal(getLnkDisplayValue(row,'rkResult'),'годен')
      }
    }
    if(request.includeTotals!==true&&request.pageSize!=='all'){
      if(derived){derivedQueries??=statements.length;expect(statements.length).toBeLessThanOrEqual(derivedQueries)}
      else{ordinaryQueries??=statements.length;expect(statements.length).toBe(ordinaryQueries)}
    }
    return result
  }
  try{
    const single=await measure('repair with root outside page',{columnFilters:{isometry:buildWeldColumnValueFilter(['000020'])}},[20])
    expect(single.rows[0].groupPhysicalRoot?.id).not.toBe(single.rows[0].id)
    for(const size of [100,1000] as const)await measure(`ordinary ${size}`,{pageSize:size},identities.slice(0,size).map(row=>row.n))
    await measure('second page 1000',{page:2,pageSize:1000},identities.slice(1000,2000).map(row=>row.n))
    const total=await measure('totals and available requests',{includeTotals:true},identities.slice(0,100).map(row=>row.n))
    expect(total.total).toBe(200000)
    expect(total.availableRequestCount).toBe(0)
    const repairs=identities.filter(row=>row.n%20===19)
    await measure('derived global RK repair filter',{columnFilters:{rkResult:buildWeldColumnValueFilter(['ремонт'])}},repairs.slice(0,100).map(row=>row.n),true)
    const preFilter={preRkResult:buildWeldColumnValueFilter(['ремонт'])}
    const pre=identities.filter(row=>row.n%40===0)
    for(const size of [100,1000] as const)await measure(`derived pre-TO ${size}`,{line:'LNK-READ-01',pageSize:size,columnFilters:preFilter},pre.slice(0,size).map(row=>row.n),true)
    for(const direction of ['asc','desc'] as const){
      const sorted=await measure(`RK date ${direction}`,{line:'LNK-READ-01',sort:{fieldKey:'rkConclusionDate',direction}},undefined)
      const dates=sorted.rows.map(row=>String(row.rkConclusionDate))
      expect(dates).toEqual([...dates].sort((a,b)=>direction==='asc'?a.localeCompare(b):b.localeCompare(a)))
      expect(dates[0]).toBe(direction==='asc'?'2026-07-03':'2026-07-27')
    }
    const output=await measure('current output 5000',{pageSize:'all',line:'LNK-READ-01'},identities.map(row=>row.n))
    expect(output.total).toBe(5000)
    expect(output.hasMore).toBe(false)
    for(const fieldKey of ['rkResult','preRkResult'] as const){
      statements=[]
      const started=performance.now()
      const values=await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({report:'lnk',fieldKey,columnFilters:{projectTitle:buildWeldColumnValueFilter([project]),line:buildWeldColumnValueFilter(['LNK-READ-01'])}}))
      measurements.push({name:`facet ${fieldKey}`,rows:values.length,sql:statements.length,bytes:Buffer.byteLength(JSON.stringify(values)),ms:Math.round(performance.now()-started),
        widestRead:Math.max(...statements.filter(s=>s.columns>20).map(s=>s.rows??0),0)})
      expect(values.some(value=>value.value==='ремонт')).toBe(true)
      // Calculated facets aggregate in SQL without hydrating source cards.
      expect(statements.length).toBeLessThanOrEqual(14)
      expect(measurements.at(-1)!.widestRead).toBe(0)
    }
  }finally{
    pg.Client.prototype.query=original
    console.info('LNK 200k:',JSON.stringify(measurements))
    await info.attach('lnk-200k-query-counts.json',{body:JSON.stringify(measurements,null,2),contentType:'application/json'})
  }
})
