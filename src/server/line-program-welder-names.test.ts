import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { loadLineProgramWelderNames } from './line-program-welder-names'

describe('opened line welder names', () => {
  it('uses one scoped query for many stamps and ignores blank duplicate certificates', async () => {
    const orderBy = vi.fn().mockResolvedValue([
      { stamp: ' a001 ', name: null }, { stamp: 'A001', name: ' Иванов Иван Иванович ' },
      { stamp: 'A001', name: 'Иванов Иван Иванович' }, { stamp: 'B001', name: 'Петров Пётр' },
    ])
    const where = vi.fn().mockReturnValue({ orderBy })
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const names = await loadLineProgramWelderNames({ select } as unknown as Parameters<typeof loadLineProgramWelderNames>[0], [' a001 ', 'A001', 'B001', ...Array.from({ length: 200 }, (_, i) => 'K' + i)])
    expect(select).toHaveBeenCalledOnce()
    expect(orderBy).toHaveBeenCalledOnce()
    expect([...names]).toEqual([['A001', 'Иванов Иван Иванович'], ['B001', 'Петров Пётр']])
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0])
    expect(query.sql).toContain('upper(btrim("welder_stamps"."naks_stamp")) = any(')
    expect(query.params[0]).toHaveLength(202)
  })
  it('does not query the registry for an empty line or line-wide group', async () => {
    const select = vi.fn()
    expect(await loadLineProgramWelderNames({ select } as unknown as Parameters<typeof loadLineProgramWelderNames>[0], ['', ' '])).toEqual(new Map())
    expect(select).not.toHaveBeenCalled()
  })
})
