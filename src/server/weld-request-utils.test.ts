import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { weldJoints } from '@/db/schema'
import { buildIncludedRowsFirstOrder } from '@/server/weld-request-utils'

describe('weld request SQL helpers', () => {
  it('orders explicitly included rows before a bounded candidate page with one array parameter', () => {
    const query = new PgDialect().sqlToQuery(sql`
      select ${weldJoints.id}
      from ${weldJoints}
      order by ${buildIncludedRowsFirstOrder(weldJoints.id, [900_001, 900_002])}, ${weldJoints.id}
      limit 502
    `)

    expect(query.sql).toContain('order by case when "weld_joints"."id" = any(')
    expect(query.sql).toContain('then 0 else 1 end')
    expect(query.sql).toContain('limit 502')
    expect(query.params).toContainEqual([900_001, 900_002])
  })
})
