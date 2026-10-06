import { expect, test } from '@playwright/test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { buildOwnLnkBackfillWhere } from '../../src/server/lnk-system-order-sql'
import { canBackfillOwnLnkResult } from '../../src/lib/lnk-system-order'
import { LNK_METHODS } from '../../src/lib/lnk-report-config'

test('историческое довнесение: PostgreSQL и карточка одинаково понимают прежние записи годности и отмены', async () => {
  // VIK/PVK are good prerequisites. A rejected peer RK permits backfilling UZK;
  // cancellation must neither erase that rejection nor hide a good prerequisite.
  const good = ['годен', ' ГОДЕН ', 'да', 'годен (отменен)', 'годен · назначение отменено']
  const cases = good.flatMap(vikResult => good.flatMap(pvkResult => ['ремонт', 'вырез', 'ремонт · назначение отменено'].map(rkResult => ({
    vikResult, pvkResult, rkResult, hasPvk: 'да', expected: true,
  }))))
  cases.push({ vikResult: 'годен', pvkResult: 'ремонт', rkResult: 'ремонт', hasPvk: 'да', expected: false })
  cases.push({ vikResult: 'ожидает НК', pvkResult: 'годен', rkResult: 'ремонт', hasPvk: 'да', expected: false })
  const records = cases.map((row, index) => ({ id: index + 1, vik_result: row.vikResult, pvk_result: row.pvkResult, rk_result: row.rkResult, uzk_result: null, has_pvk: row.hasPvk }))
  const query = new PgDialect().sqlToQuery(sql`
    with weld_joints as (
      select * from json_to_recordset(${JSON.stringify(records)}::json) as r(id int,vik_result text,pvk_result text,rk_result text,uzk_result text,has_pvk text)
    ) select id,coalesce(${buildOwnLnkBackfillWhere(LNK_METHODS.find(method => method.code === 'УЗК')!)},false) as eligible from weld_joints order by id
  `)
  const actual = await withE2eDatabase(db => db.query(query.sql, query.params))
  for (const [index, row] of cases.entries()) {
    expect(canBackfillOwnLnkResult(row, 'УЗК'), JSON.stringify(row)).toBe(row.expected)
    expect(actual.rows[index].eligible, JSON.stringify(row)).toBe(row.expected)
  }
})
