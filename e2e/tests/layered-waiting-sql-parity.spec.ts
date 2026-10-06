import { expect, test } from '@playwright/test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { buildGeneratedDocumentMissingValue } from '../../src/server/weld-server-shared'
import { getLayeredControlWaitingLabel, LAYERED_CONTROL_WAITING_LABEL } from '../../src/lib/layered-control-documents'

test('SQL-фильтр и карточка не возвращают ожидание ПВК из-за пометки отмены завершённого контроля', async () => {
  const complete = ['годен', 'ремонт', 'вырез', 'да', 'проведено', 'годен (отменен)', 'проведено (отменен)']
    .flatMap(result => [result, ` ${result.toUpperCase()} · НАЗНАЧЕНИЕ ОТМЕНЕНО `])
  const cases = [true, false].flatMap(assigned => [
    ...complete.map(result => ({ assigned, result, expected: '' })),
    ...[null, 'ожидает НК', 'ожидает заявку'].map(result => ({ assigned, result, expected: assigned ? LAYERED_CONTROL_WAITING_LABEL : '' })),
  ])
  for (const field of ['layeredVikDocuments', 'layeredPvkDocuments'] as const) {
    const records = cases.map((row, index) => ({ id: index + 1, pvk_result: row.result, layered_control_assigned: row.assigned }))
    const query = new PgDialect().sqlToQuery(sql`with weld_joints as (
      select * from json_to_recordset(${JSON.stringify(records)}::json) as r(id int,pvk_result text,layered_control_assigned boolean)
    ) select id,${buildGeneratedDocumentMissingValue(field)} as value from weld_joints order by id`)
    const actual = await withE2eDatabase(db => db.query(query.sql, query.params))
    for (const [index, row] of cases.entries()) {
      expect(getLayeredControlWaitingLabel({ layeredControlAssigned: row.assigned, pvkResult: row.result }, field), JSON.stringify(row)).toBe(row.expected)
      expect(actual.rows[index].value, JSON.stringify(row)).toBe(row.expected)
    }
  }
})
