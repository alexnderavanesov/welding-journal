import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { buildDocumentHistoryGridSql } from '../../src/server/document-history-grid'
import type { DocumentHistoryGridRequest } from '../../src/lib/document-history-grid'

for (const kind of ['generated','system'] as const) test(`${kind}: empty, repeated, mixed and literal group labels retain exact membership and selection`,async()=>{
  const rows=[null,['','   ',null],['A',' A ','A'],['A','B','A'],['B','A'],['Несколько линий'],['(пусто)'],['B']]
    .map((lines,index)=>({id:index+1,lines}))
  const baseQuery=sql`select v.id as "id",v.id as "documentId",v.lines as "filter_line",'D'||v.id as "title"
    from jsonb_to_recordset(${sql.param(JSON.stringify(rows))}::jsonb) as v(id integer,lines text[])`
  const read=async(overrides:Partial<DocumentHistoryGridRequest>={})=>{
    const query=buildDocumentHistoryGridSql({baseQuery,columnFilters:{},filterKeys:['line'],idKind:kind,
      request:{startRow:0,endRow:100,rowGroupCols:['line'],groupKeys:[],sortModel:[],
        selectedIds:[3,4,7].map(id=>kind==='system'?`system-document:${id}`:id),...overrides},
      sortExpressions:{line:sql`("filter_line")[1]`},defaultOrder:sql`"id" desc`})
    return (await requireDb().execute(query)).rows[0] as {rows:any[];rowCount:number;total:number;selectedCount:number}
  }
  const expected=[
    {key:['empty'],ids:[1,2],selected:0}, {key:['multiple'],ids:[4,5],selected:1},
    {key:['value','A'],ids:[3],selected:1}, {key:['value','B'],ids:[8],selected:0},
    {key:['value','Несколько линий'],ids:[6],selected:0}, {key:['value','(пусто)'],ids:[7],selected:1},
  ]
  const grouped=await read()
  expect(grouped).toMatchObject({rowCount:6,total:8,selectedCount:3})
  for(const group of expected){
    expect(grouped.rows.find(row=>JSON.stringify(row.groupKey)===JSON.stringify(group.key)))
      .toMatchObject({childCount:group.ids.length,selectedCount:group.selected})
    const children=await read({groupKeys:[JSON.stringify(group.key)]})
    expect(children.rows.map(row=>row.id).sort((a,b)=>a-b)).toEqual(group.ids)
    expect(children).toMatchObject({rowCount:group.ids.length,total:8,selectedCount:group.selected})
  }
  const counts=await read({countRoutes:expected.map(group=>[JSON.stringify(group.key)])})
  expect(counts).toMatchObject({rowCount:6,total:8,selectedCount:3})
})
