import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { withE2eDatabase } from '../database'
import { weldJoints } from '../../src/db/schema'
import { buildFinalStatusColumnWhere, getWeldColumnFilterExpression } from '../../src/server/weld-server-shared'

test('common status fragments keep duplicate suffixes, legacy text and LIKE semantics', async () => {
  await withE2eDatabase(async db => {
    await db.query('begin')
    try {
      const statuses = [null, '', 'годен', 'не годен', 'не годен по дублю', ' НЕ ГОДЕН ПО ДУБЛЮ ',
        'ожидает НК', 'ожидает заявку', 'не годен по дублю (stored)']
      const ids: number[] = []
      for (const status of statuses) ids.push((await db.query('insert into weld_joints(final_status) values($1) returning id', [status])).rows[0].id)
      await db.query(`insert into duplicate_controls(weld_joint_id,method,result) values
        ($1,'РК','ремонт'),($1,'custom % _ \\','вырез'),($2,'УЗК','вырез')`, [ids[4], ids[5]])
      const read = async (condition: ReturnType<typeof sql>) => {
        const query = new PgDialect().sqlToQuery(sql`select ${weldJoints.id} from ${weldJoints}
          where ${weldJoints.id} = any(${sql.param(ids)}::int[]) and ${condition} order by ${weldJoints.id}`)
        return (await db.query(query.sql, query.params)).rows.map(row => row.id)
      }
      expect(await read(buildFinalStatusColumnWhere('годен'))).toEqual([ids[2], ids[3], ids[4], ids[5], ids[8]])
      expect(await read(buildFinalStatusColumnWhere('РК'))).toEqual([ids[4]])
      expect(await read(buildFinalStatusColumnWhere('=годен'))).toEqual([ids[2]])
      for (const fragment of ['годен', 'ГОДЕН', 'не годен', 'дуб', 'по дублю', 'ожидает', 'РК', 'УЗК', 'лю (', 'stored', '%', '_', '\\%', '\\\\']) {
        const oldExpression = sql`coalesce(${getWeldColumnFilterExpression('finalStatus')}::text, '') ilike ${`%${fragment}%`}`
        expect(await read(buildFinalStatusColumnWhere(fragment)), fragment).toEqual(await read(oldExpression))
      }
      const common = new PgDialect().sqlToQuery(buildFinalStatusColumnWhere('годен'))
      expect(common.sql).not.toContain('duplicate_controls')
      expect(common.sql).not.toContain('case')
      expect(new PgDialect().sqlToQuery(buildFinalStatusColumnWhere('РК')).sql).toContain('duplicate_controls')
    } finally { await db.query('rollback') }
  })
})
