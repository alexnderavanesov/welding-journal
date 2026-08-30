import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { weldJoints } from '@/db/schema'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'

describe('LNK availability SQL', () => {
  it('treats an empty control assignment as false instead of NULL', () => {
    const compiled = new PgDialect().sqlToQuery(sql`
      select 1 where ${buildNullableControlEnabledWhere(
        weldJoints.pstoRequired,
        ['да', 'дополнительный'],
      )}
    `)

    expect(compiled.sql).toContain('coalesce("weld_joints"."psto_required" in')
    expect(compiled.sql).toContain(', false)')
  })
})
