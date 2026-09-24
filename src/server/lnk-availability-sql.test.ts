import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { weldJoints } from '@/db/schema'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'
import { buildControlAvailabilityColumnWhere } from '@/server/weld-server-shared'
import {
  buildAvailableLnkRequestWhere,
  buildPrimaryLnkStageReadyWhere,
} from '@/server/weld-read'

describe('LNK availability SQL', () => {
  it('treats an empty control assignment as false instead of NULL', () => {
    const compiled = new PgDialect().sqlToQuery(sql`
      select 1 where ${buildNullableControlEnabledWhere(
        weldJoints.pstoRequired,
        ['да', 'дополнительный'],
      )}
    `)

    expect(compiled.sql).toContain('lower(btrim(coalesce("weld_joints"."psto_required"::text')
    expect(compiled.sql).toContain(', false)')
  })

  it('matches assigned and empty filter choices against legacy spellings', () => {
    const compiled = new PgDialect().sqlToQuery(sql`
      select 1 where ${buildControlAvailabilityColumnWhere(
        weldJoints.pstoRequired,
        ['да', ''],
      )}
    `)

    expect(compiled.params).toEqual(expect.arrayContaining(['да', '1', '', '-', 'нет', '0']))
  })

  it('keeps SQL readiness aligned with cancelled PSTO history without legacy exemptions', () => {
    const compiled = new PgDialect().sqlToQuery(sql`
      select 1 where ${buildPrimaryLnkStageReadyWhere('ВИК')}
    `)

    expect(compiled.sql).not.toContain('"pre_heat_treatment_lnk_exempt"')
    expect(compiled.sql).toContain("in ('не годен', 'негоден', 'ремонт', 'вырез')")
    expect(compiled.sql).toContain('"psto_repeat_cycles"."weld_joint_id" = "weld_joints"."id"')
  })

  it('keeps rejected-control checks without requiring good TVMT for early requests', () => {
    const compiled = new PgDialect().sqlToQuery(sql`
      select 1 where ${buildAvailableLnkRequestWhere()}
    `)

    expect(compiled.sql).not.toContain('"pre_heat_treatment_lnk_exempt"')
    expect(compiled.sql).not.toContain("= 'годен'")
    expect(compiled.sql).toContain('"pre_heat_treatment_controls"')
  })
})
