import { afterEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { loadDispatcherDateScopes } from './dispatcher-date-scopes'
import { buildJointCoreDataCheckTasks, buildWelderStampCompatibilityCheckTasks } from '@/lib/repeated-joint-check-tasks'

const scope = { projectTitle: 'P', subtitleCode: 'S', line: 'L' }
const before = new Date('2026-10-13T20:59:59Z'), after = new Date('2026-10-13T21:00:01Z')
afterEach(() => vi.useRealTimers())

describe('business-day dispatcher dependencies', () => {
  it('does not read welds again within one Moscow day', async () => {
    const execute = vi.fn()
    expect(await loadDispatcherDateScopes({ execute } as never, after, [scope], new Date('2026-10-14T10:00:00Z'))).toEqual([scope])
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([[before, after], [after, before]])('uses the earlier date even if the clock moves backwards', async (from, to) => {
    const execute = vi.fn().mockResolvedValue({ rows: [scope] })
    expect(await loadDispatcherDateScopes({ execute } as never, from, [], to)).toEqual([scope])
    expect(execute).toHaveBeenCalledOnce()
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.params).toContain('2026-10-13')
    // Include ALL remaining future dates: the text of their warning changes daily.
    expect(query.sql).toContain('"weld_date" >')
    expect(query.sql).toContain('::date')
    expect(query.sql).not.toContain('"weld_date"::text')
    expect(query.sql).not.toContain('officiality')
    expect(query.sql).not.toContain('stamp_')
    expect(query.sql).not.toContain('select * from "weld_joints"')
    for (const field of ['rk_conclusion_date', 'uzk_conclusion_date', 'conclusion_date', 'control_date']) expect(query.sql).toContain(`"${field}" >`)
    expect(query.sql).toContain('"duplicate_controls"')
    expect(query.sql).toContain('"pre_heat_treatment_controls"')
  })

  it('unions pending mutations with daily dependencies, retaining deleted contexts', async () => {
    const changed = { ...scope, line: 'Changed' }
    const execute = vi.fn().mockResolvedValue({ rows: [scope, { projectTitle: null, subtitleCode: null, line: null }] })
    expect(await loadDispatcherDateScopes({ execute } as never, before, [changed, scope], after)).toEqual([
      changed, scope, { projectTitle: '', subtitleCode: '', line: '' },
    ])
  })

  it('falls back when daily dependencies or their union exceed the whole-context bound', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ ...scope, line: String(i) }))
    const execute = vi.fn().mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: rows.slice(0, 500) })
    expect(await loadDispatcherDateScopes({ execute } as never, before, [], after)).toBeNull()
    expect(await loadDispatcherDateScopes({ execute } as never, before, [scope], after)).toBeNull()
  })

  it('never blesses an unknown calculation date', async () => {
    const execute = vi.fn()
    expect(await loadDispatcherDateScopes({ execute } as never, new Date('invalid'), [], after)).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('retains both future-date and open-suspension transitions, including legacy display dates', () => {
    vi.useFakeTimers()
    const rows = ['2026-10-14', '14.10.2026', '14.10.26'].map((weldDate, i) => ({
      ...scope, id: i + 1, joint: `F${i + 1}`, weldDate,
      materialGroup: 'М01', connectionType: 'С17', weldingMethod: 'РАД', stamp1K: 'AB12',
    }))
    const suspensions = [{ id: 1, naksStamp: 'AB12', suspendedFrom: '2026-10-01', suspendedTo: '' }]
    vi.setSystemTime(before)
    expect(buildJointCoreDataCheckTasks(rows)).toHaveLength(3)
    const oldCompatibility = buildWelderStampCompatibilityCheckTasks(rows, [], suspensions)
    expect(oldCompatibility.some(task => task.details?.includes('отстранено'))).toBe(false)
    vi.setSystemTime(after)
    expect(buildJointCoreDataCheckTasks(rows)).toHaveLength(0)
    const newCompatibility = buildWelderStampCompatibilityCheckTasks(rows, [], suspensions)
    expect(newCompatibility.filter(task => task.details?.includes('отстранено'))).toHaveLength(3)
  })
})
