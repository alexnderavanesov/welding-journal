import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { getTableColumns } from 'drizzle-orm'
import { weldJoints } from '../../src/db/schema'
import { WELD_FIELDS, isVirtualWeldField, type WeldFieldKey } from '../../src/lib/weld-fields'
import { getAvailableWeldTableSections } from '../../src/lib/weld-table-sections'
import { getReportHiddenFieldKeys } from '../../src/lib/report-field-state'
import { getLnkVisibleFieldSections } from '../../src/lib/lnk-visible-field-layout'
import { filterWeldRowsByColumns, getWeldColumnFilterRowValues } from '../../src/lib/weld-table-filtering'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { buildDispatcherTaskServerFilters } from '../../src/lib/dispatcher-task-row-codes'
import { getLnkDisplayValue, getWeldingJournalDisplayValue } from '../../src/lib/lnk-status'
import { projectPstoReportDisplayValues } from '../../src/server/report-filter-reference.test-helper'
import type { JournalGridRequest, JournalGridResult } from '../../src/lib/journal-server-grid'
import type { JournalFilterPage } from '../../src/lib/journal-filter-options'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { rpcName, siblingRpcUrl, serializeRpcData, deserializeRpcResponse } from '../rpc'

const enabled = process.env.DEEP_FIELD_MATRIX === '1'
test.skip(!enabled, 'Explicit complete field coverage on an owned local fixture')
test.use({ trace: 'off', video: 'off' })
const marker = 'DEEP-FIELD-MATRIX'
const projects = [0, 1, 2, 3].map(value => `${marker}-${value}`)
const total = process.env.DEEP_MATRIX_ROWS === '9000' ? 9000 : 48
const reports = ['weldingJournal', 'lnk', 'heatTreatment'] as const

test.beforeAll(async () => {
  if (!enabled) return
  test.setTimeout(300_000)
  await withLineProgramFixture(async db => {
    const columns = getTableColumns(weldJoints)
    const physical = WELD_FIELDS.filter(field => !isVirtualWeldField(field) && field.key !== 'id' && field.key in columns)
    // Fill every stored field, rather than checking hundreds of all-empty
    // columns. Domain fields below replace generic text with real meanings.
    const names = physical.map(field => `"${columns[field.key as keyof typeof columns].name}"`)
    const values = physical.map(field => {
      const column = columns[field.key as keyof typeof columns]
      if (column.dataType === 'date') return "timestamp with time zone '2026-10-01 12:00:00+00' + (n%4)*interval '1 day' + (n%2)*interval '1 millisecond'"
      if (field.kind === 'date') return "case when n%4=0 then null else date '2026-10-01'+(n%4)::int end"
      if (field.kind === 'number') return `(case when n%4=0 then null else n%3+1 end)${column.dataType === 'string' ? '::text' : ''}`
      if (field.kind === 'boolean') return "(array['да','отменен',null,'да'])[n%4+1]"
      return "(array['АЛЬФА-2','Альфа-10',null,''])[n%4+1]"
    })
    await db.query(`insert into weld_joints(${names.join(',')}) select ${values.join(',')} from generate_series(1,$1::int) n`, [total])
    const seeded = (await db.query('select id from weld_joints where project_title is null or project_title=any($1::text[]) order by id', [['АЛЬФА-2', 'Альфа-10', '']])).rows.map(row => row.id)
    expect(seeded.length).toBe(total)
    await db.query(`update weld_joints w set project_title=$1||'-'||((s.ordinality-1)%4),subtitle_code='ШИФР-'||((s.ordinality-1)%3),
      line='ЛИНИЯ-'||((s.ordinality-1)%8),joint='F'||s.ordinality,isometry='ISO-'||(s.ordinality%6),
      officiality='действующий',revision_actuality='актуальная',connection_type='С17',welding_method='РД',material_group='M01',
      d1='114',d2='114',t1='6',t2='6',wdi=case when s.ordinality%4=0 then null else 1.235 end,
      weld_date=case when s.ordinality%12=0 then null else date '2026-10-01'+(s.ordinality%4)::int end,
      has_vik='да',has_rk='да',has_uzk='да',has_pvk='да',psto_required='да',
      vik_result='годен',rk_result=case when s.ordinality%6=0 then 'ремонт' else 'годен' end,uzk_result='годен',pvk_result='годен',
      psto_result=case when s.ordinality%3=0 then 'проведено' else null end,
      tvmt_result=case when s.ordinality%5=0 then 'не годен' when s.ordinality%3=0 then 'годен' else null end,
      lnk_defect_description=case when s.ordinality%4=0 then null else '0: ДНО'||chr(10)||'120: ДНО' end,
      rk_exposure_confirmed_diameter=114
      from unnest($2::int[]) with ordinality s(id,ordinality) where w.id=s.id`, [marker, seeded])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where project_title=any($1::text[])`, [projects])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      select id,method,'PRE-'||method,date '2026-09-28',case when id%5=0 then 'ремонт' else 'годен' end,
        'CONCLUSION-'||method,date '2026-09-29','0: ДНО'||chr(10)||'120: ДНО'
      from weld_joints cross join unnest(array['ВИК','РК','УЗК','ПВК']) method
      where project_title=any($1::text[]) and id%3=0`, [projects])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,psto_result,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date)
      select id,s,case when s=2 then 'ПОВТОР-2' end,date '2026-10-10',date '2026-10-11',case when s=2 then 'проведено' end,
        case when s=2 then 'ТВМТ-2' end,date '2026-10-11',case when s=2 then 'годен' end,case when s=2 then 'ТВМТ-З-2' end,date '2026-10-12'
      from weld_joints cross join generate_series(2,3) s where project_title=any($1::text[]) and id%4=0`, [projects])
    for (const [index, type] of ['weldingJournal','checklist','zni','layeredVikEdges','layeredVikLayers','layeredPvkEdges','layeredPvkLayers'].entries()) {
      const document = await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
        values($1,$2,'matrix.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',0) returning id`, [type, `${marker}-ДОК-${index}`])
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select $1,id from weld_joints where project_title=any($2::text[]) and id%3=$3`, [document.rows[0].id, projects, index%3])
    }
    for (const table of ['weld_joints','weld_joint_program_states','pre_heat_treatment_controls','psto_repeat_cycles','generated_documents','generated_document_weld_joints']) await db.query(`analyze ${table}`)
  })
})
test.afterAll(async () => { if (enabled) await cleanupLineProgramProjects(projects) })

test('every available weld-report field preserves exact membership, facets and group partitions', async ({ page }, info) => {
  test.setTimeout(1_200_000)
  let observed = ''
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(marker)
  await expect(page.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible({ timeout: 240_000 })
  await page.waitForLoadState('networkidle')
  const call = async <T,>(name: string, data: unknown): Promise<T> => {
    const response = await page.request.post(siblingRpcUrl(observed, name + '_createServerFn_handler'), {
      data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site':'same-origin',
        'content-type':'application/json','x-tsr-serverFn':'true' }, timeout: 90_000,
    })
    expect(response.ok(), name).toBe(true)
    const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
    if (payload.error) throw payload.error
    return payload.result
  }
  const measures: object[] = [], failures: object[] = []
  const save = () => writeFile(info.outputPath('field-matrix.json'), JSON.stringify({ total, measures, failures }, null, 2))
  const sortedIds = (rows: readonly {id: number}[]) => rows.map(row => row.id).sort((a,b) => a-b)
  // Transport compacts numeric values into numbers and deserializes timestamps
  // into Date. Facet choices deliberately retain PostgreSQL's exact raw text
  // (including scale and subsecond precision); recover that representation
  // independently from stored fixture facts, without calling filter builders.
  const rawColumns = Object.entries(getTableColumns(weldJoints)).filter(([, column]) => column.columnType === 'PgNumericNumber' || column.dataType === 'date')
  const rawRows = await withE2eDatabase(async db => (await db.query(`select id,psto_result as "primaryPstoResult",${rawColumns.map(([key,column]) => `"${column.name}"::text as "${key}"`).join(',')}
    from weld_joints where project_title=any($1::text[])`, [projects])).rows)
  const rawById = new Map(rawRows.map(row => [row.id, row]))
  for (const report of reports) {
    const fields = getAvailableWeldTableSections({ hiddenFieldKeys:getReportHiddenFieldKeys(report),mergePstoSections:report==='heatTreatment',
      ...(report==='lnk' ? { sectionLayout:getLnkVisibleFieldSections() } : {}),
    }).flatMap(section=>section.fields)
    const base: JournalGridRequest = { report,columnFilters:{search:marker},groupBy:[],route:[],start:0,end:1000,sort:{fieldKey:'id',direction:'asc'} }
    const initial = await call<JournalGridResult>('readJournalGrid',base)
    const all: WeldRow[] = [...initial.rows]
    for(let start=1000;start<initial.rowCount;start+=1000) all.push(...(await call<JournalGridResult>('readJournalGrid',{...base,start,end:start+1000,revision:initial.revision})).rows)
    expect(all.length).toBe(initial.rowCount)
    expect(initial.rowCount).toBeGreaterThan(0)
    const displayed = (report==='heatTreatment' ? projectPstoReportDisplayValues(all,fields.map(field=>field.key)) : all)
      .map(row => ({ ...row, ...rawById.get(row.id),
        // Existing journal filter choices use the primary stored PSTO fact;
        // current-cycle selection belongs to the PSTO report. Do not silently
        // change this contract as a performance optimization.
        ...(report==='weldingJournal' ? { pstoResult:rawById.get(row.id)?.primaryPstoResult,
          controlBasisSummary:getWeldingJournalDisplayValue(row,'controlBasisSummary') } : {}),
        ...(report==='lnk' ? { controlBasisSummary:getLnkDisplayValue(row,'controlBasisSummary'),
          rkExposureScheme:getLnkDisplayValue(row,'rkExposureScheme') } : {}),
      })) as WeldRow[]
    for(const field of fields) {
      const timings: Record<string,number> = {}
      try {
        let start=performance.now()
        const facets = await call<JournalFilterPage>('readJournalFilterPage',{report,fieldKey:field.key,search:marker})
        timings.facet=performance.now()-start
        const values=[...facets.options]
        let next=facets.next
        while(next!==undefined) { const part=await call<JournalFilterPage>('readJournalFilterPage',{report,fieldKey:field.key,search:marker,start:next,revision:facets.revision}); values.push(...part.options); next=part.next }
        expect(values.length).toBe(facets.total)
        // Exact-choice membership comes from the displayed records, independently
        // of SQL selection. Dispatcher codes and document titles are multi-valued.
        const expectedValues = new Map<string,number>()
        for(const row of displayed) {
          const rowValues = field.key==='dispatcherTasks' ? String(row.dispatcherTasks??'').split(',').map(code=>code.trim()).filter(Boolean)
            : getWeldColumnFilterRowValues(row,field.key)
          for(const value of new Set(rowValues)) expectedValues.set(value,(expectedValues.get(value)??0)+1)
        }
        expect(new Map(values.map(option=>[option.value,option.count])),`${report}/${field.key} facet counts`).toEqual(expectedValues)
        const choices = [...new Set([values.find(option=>option.value)?.value??'', ...(field.key==='dispatcherTasks' ? [] : ['']), values.at(-1)?.value??''])]
        for(const value of choices) {
          const filter=buildWeldColumnValueFilter([value])
          const expected=sortedIds(filterWeldRowsByColumns(displayed,{[field.key]:filter}))
          start=performance.now()
          const choiceRequest={...base,columnFilters:buildDispatcherTaskServerFilters({...base.columnFilters,[field.key]:filter})}
          // Task filters pin a publication fingerprint in addition to the data
          // revision. A numeric unfiltered revision is not its snapshot token.
          const revision=field.key==='dispatcherTasks' ? (await call<JournalGridResult>('readJournalGrid',choiceRequest)).revision : initial.revision
          const selection=await call<{ids:number[]}>('selectJournalGridRows',{...choiceRequest,revision})
          timings.choice=(timings.choice??0)+performance.now()-start
          expect(selection.ids.slice().sort((a,b)=>a-b),`${report}/${field.key}/${value}`).toEqual(expected)
          expect(values.find(option=>option.value===value)?.count??0).toBe(expected.length)
        }
        if(!isVirtualWeldField(field)) {
          start=performance.now()
          const groups=await call<JournalGridResult>('readJournalGrid',{...base,groupBy:[field.key],sort:null})
          timings.group=performance.now()-start
          const groupRows=[...groups.rows]
          for(let offset=1000;offset<groups.rowCount;offset+=1000) groupRows.push(...(await call<JournalGridResult>('readJournalGrid',{...base,groupBy:[field.key],sort:null,start:offset,end:offset+1000,revision:groups.revision})).rows)
          expect(groupRows.length).toBe(groups.rowCount)
          expect(groupRows.reduce((sum,row)=>sum+row.journalGroup!.recordCount,0)).toBe(all.length)
          const boundaries=[groupRows[0],groupRows.at(-1)].filter(Boolean)
          const counts=await call<{total:number,counts:Record<string,number>}>('countJournalGridSelection',{
            ...base,groupBy:[field.key],ids:all.map(row=>row.id),routes:boundaries.map(row=>row!.journalGroup!.route)})
          expect(counts.total).toBe(all.length)
          for(const row of boundaries) expect(counts.counts[JSON.stringify(row!.journalGroup!.route)]).toBe(row!.journalGroup!.recordCount)
          // Boundary groups must return exactly their claimed records, using a
          // different route predicate from root group enumeration.
          for(const group of [groupRows[0],groupRows.at(-1)].filter(Boolean)) {
            const route=group!.journalGroup!.route
            const members=await call<{ids:number[]}>('selectJournalGridRows',{...base,groupBy:[field.key],route,revision:groups.revision})
            expect(new Set(members.ids).size).toBe(group!.journalGroup!.recordCount)
            expect(members.ids.every(id=>all.some(row=>row.id===id))).toBe(true)
            const range=await call<{ids:number[]}>('selectJournalGridRange',{...base,groupBy:[field.key],revision:groups.revision,
              anchor:field.key,parts:[{route:[],start:group!.journalGroup!.ordinal,end:group!.journalGroup!.ordinal+1,columns:[field.key]}]})
            expect(range.ids.slice().sort((a,b)=>a-b),'range selection uses the same group key and ordering').toEqual(members.ids.slice().sort((a,b)=>a-b))
          }
        }
        measures.push({report,field:field.key,kind:field.kind,groupable:!isVirtualWeldField(field),rows:all.length,options:facets.total,...timings})
      } catch(error) { failures.push({report,field:field.key,message:String(error)}); await save() }
    }
    await save()
  }
  expect(failures,'Complete matrix failures are retained, not skipped').toEqual([])
})
