import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { buildAcceptedWdiTotalQuery } from '@/server/wdi-aggregate-sql'

const dialect = new PgDialect()

describe('accepted WDI aggregate SQL', () => {
  it('uses one aggregate over stored WDI in manual mode', () => {
    const query = dialect.sqlToQuery(buildAcceptedWdiTotalQuery(undefined, DEFAULT_OTHER_SETTINGS))

    expect(query.sql).toContain('sum(coalesce("weld_joints"."wdi", 0))')
    expect(query.sql).toContain('not exists')
    expect(query.sql).not.toContain('current_wdi_dimensions')
  })

  it('calculates formula WDI in SQL without loading weld rows into Node', () => {
    const query = dialect.sqlToQuery(buildAcceptedWdiTotalQuery(undefined, {
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
    }))

    expect(query.sql).toContain('cross join lateral')
    expect(query.sql).toContain('round("current_wdi_dimensions"."diameter" / 25.4, 2)')
    expect(query.sql).toContain("like 'У%'")
  })

  it('uses descending table boundaries so the first match is the same floor cell as the UI calculation', () => {
    const query = dialect.sqlToQuery(buildAcceptedWdiTotalQuery(undefined, {
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'table',
      wdiTable: {
        fileName: 'wdi.xlsx',
        uploadedAt: '2026-09-22T00:00:00.000Z',
        diameters: [100, 200],
        thicknesses: [5, 10],
        values: [[1, 2], [3, null]],
      },
    }))

    expect(query.sql).toContain('"current_wdi_dimensions"."thickness"')
    expect(query.sql).toContain('sum(coalesce(round(case')
    expect(query.params.slice(0, 3)).toEqual([200, 10, 200])
    expect(query.sql).toContain('then null::numeric')
  })
})
