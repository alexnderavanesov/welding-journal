import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { weldJoints } from '@/db/schema'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'
import { buildPrimaryLnkStageReadyWhere } from '@/server/weld-read'

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

  it('keeps SQL readiness aligned with cancelled PSTO history and pre-TO exemptions', () => {
    const compiled = new PgDialect().sqlToQuery(sql`
      select 1 where ${buildPrimaryLnkStageReadyWhere('ВИК')}
    `)

    expect(compiled.sql).toContain('"weld_joints"."pre_heat_treatment_lnk_exempt"')
    expect(compiled.sql).toContain("in ('не годен', 'негоден', 'ремонт', 'вырез')")
    expect(compiled.sql).toContain('"psto_repeat_cycles"."weld_joint_id" = "weld_joints"."id"')
  })
})
