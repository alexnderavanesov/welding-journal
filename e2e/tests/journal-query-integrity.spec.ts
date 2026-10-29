import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import type { JournalGridRequest, JournalGridResult } from '../../src/lib/journal-server-grid'
import { journalGroupKeysWhere } from '../../src/server/journal-grid'
import { DEFAULT_OTHER_SETTINGS } from '../../src/lib/other-settings'
import { weldJoints } from '../../src/db/schema'

const project = 'E2E query integrity'
test.afterAll(() => cleanupLineProgramProjects([project]))
test('indexed pages preserve natural order, long legacy names, null groups and empty filters', async ({ page }) => {
  // Long incompressible values fit the existing indexes but must not acquire
  // a new write limit from a larger composite natural-sort index.
  const names = [null, '', ' ', 'F1', 'F2', 'f2', 'F02', 'F10', 'F2R1', 'F2R02', 'F2R10', 'F2W1',
    'F2Y1', 'Ф2', 'Ф10', 'F' + '7'.repeat(280), randomBytes(900).toString('hex'), 'F3',
    ...Array.from({ length: 2000 }, (_, index) => 'Z' + (index + 1))]
  await withLineProgramFixture(async db => {
    for (const [index, joint] of names.entries()) {
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,officiality,wdi)
        values($1,'QUERY',$2,$3,'действующий',$4)`, [project, index === 0 ? null : index === 1 ? '' : index === 2 ? ' ' : index === 17 ? 'L'.repeat(300) : 'L', joint, index % 2 ? 1 : 2])
    }
  })
  let observed = ''
  page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
  await page.goto('/journal')
  await page.getByRole('searchbox').fill(project)
  await expect(page.getByText(`Найдено: ${names.length}`, { exact: true })).toBeVisible()
  const call = async (request: JournalGridRequest) => {
    const response = await page.request.post(siblingRpcUrl(observed, 'readJournalGrid_createServerFn_handler'), {
      data: await serializeRpcData(request), headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin',
        'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    const value = await deserializeRpcResponse(await response.text()) as { result: JournalGridResult; error?: Error }
    if (value.error) throw value.error
    return value.result
  }
  for (const direction of ['asc', 'desc'] as const) {
    // Independent copy of the established SQL contract, without the new index
    // helper or candidate-page query. Validate every page boundary and tie.
    const expected = await withE2eDatabase(async db => (await db.query(`select id from weld_joints where project_title=$1 order by
      case when joint is null or btrim(joint)='' then 1 else 0 end asc,
      lower(substring(coalesce(joint,'') from '^[^0-9]*')) ${direction} nulls last,
      (substring(coalesce(joint,'') from '[0-9]+'))::numeric ${direction} nulls ${direction === 'asc' ? 'first' : 'last'},
      lower(substring(regexp_replace(coalesce(joint,''),'^[^0-9]*[0-9]+','') from '^[^0-9]*')) ${direction} nulls last,
      (substring(regexp_replace(coalesce(joint,''),'^[^0-9]*[0-9]+','') from '[0-9]+'))::numeric ${direction} nulls ${direction === 'asc' ? 'first' : 'last'},
      lower(coalesce(joint,'')) ${direction} nulls last, line asc, joint asc, id asc`, [project])).rows.map(row => row.id))
    const edgeIds = await withE2eDatabase(async db => (await db.query(`select id from weld_joints where project_title=$1
      and (octet_length(coalesce(joint,''))>256 or octet_length(coalesce(line,''))>256)`, [project])).rows.map(row => row.id))
    const starts = [...new Set([0, 4, 8, 12, 16, 995, 1000, names.length - 4, ...edgeIds.map(id => Math.max(0, expected.indexOf(id) - 1))])]
    for (const start of starts) {
      const result = await call({ columnFilters: { projectTitle: '=' + project }, groupBy: [], route: [], start, end: start + 4, sort: { fieldKey: 'joint', direction } })
      expect(result.rowCount).toBe(names.length)
      expect(result.rows.map(row => row.id)).toEqual(expected.slice(start, start + 4))
    }
  }
  const base: JournalGridRequest = { columnFilters: { projectTitle: '=' + project }, groupBy: ['line'], route: [], start: 0, end: 100 }
  const groups = await call(base)
  expect(groups.rows.map(row => [row.journalGroup?.key, row.journalGroup?.recordCount])).toEqual([['', 2], [' ', 1], ['L', names.length - 4], ['L'.repeat(300), 1]])
  for (const group of groups.rows) {
    const key = group.journalGroup!.key
    const leaf = await call({ ...base, route: [key] })
    expect(leaf.rowCount).toBe(group.journalGroup!.recordCount)
    expect(leaf.rows.every(row => (row.line ?? '') === key)).toBe(true)
  }
  expect((await call({ ...base, columnFilters: { ...base.columnFilters, line: '=missing' } })).rows).toEqual([])
  // Compare the optimized group predicate with the existing displayed-key
  // equality in actual PostgreSQL, including numeric and empty-key fallbacks.
  await withE2eDatabase(async db => {
    for (const field of ['line', 'joint', 'wdi', 'weldDate'] as const) {
      for (const keys of [[''], [' ', 'L'], ['1', '2'], ['F2']]) {
        const context = { settings: { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' as const }, request: base, base: sql`true` }
        const actual = new PgDialect().sqlToQuery(sql`select ${weldJoints.id} from ${weldJoints}
          where ${weldJoints.projectTitle}=${project} and ${journalGroupKeysWhere(field, keys, context)} order by ${weldJoints.id}`)
        const value = field === 'wdi' ? sql`coalesce(${weldJoints.wdi}::double precision::text, '')` : sql`coalesce(${weldJoints[field]}::text, '')`
        const expected = new PgDialect().sqlToQuery(sql`select ${weldJoints.id} from ${weldJoints}
          where ${weldJoints.projectTitle}=${project} and ${value}=any(${sql.param(keys)}::text[]) order by ${weldJoints.id}`)
        expect((await db.query(actual.sql, actual.params)).rows).toEqual((await db.query(expected.sql, expected.params)).rows)
      }
    }
  })
})
