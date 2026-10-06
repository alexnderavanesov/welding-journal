import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { loadLineProgramOverviews } from './line-program'
import type { LineProgramRecord } from '@/lib/line-program'

describe('batched history protection for line summaries', () => {
  it.each([1, 1000])('uses eight batched queries for %i lines, including stable chain states and settings', async count => {
    const programs: LineProgramRecord[] = Array.from({ length: count }, (_, index) => ({
      id: index + 1, projectTitle: 'P', subtitleCode: 'S', line: `L${index}`,
      category: 'II', groupName: 'A', weldControlPercent: 50, pvkControlPercent: 0,
      version: '1', configurationIssue: null,
    }))
    const rows = programs.flatMap((line, index) => [0, 1].map(offset => ({
      id: index * 2 + offset + 1, projectTitle: 'P', subtitleCode: 'S', line: line.line,
      joint: `F${offset}`, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', hasRk: 'да',
    })))
    // A conclusion-only legacy duplicate must agree with the full joint view's protection.
    const duplicates = programs.map((_, index) => ({ id: index + 1, weldJointId: index * 2 + 2,
      method: 'РК', result: null, conclusion: 'ЗНК', conclusionDate: '2026-09-02', controlDate: '2026-09-02',
    }))
    const results = [rows, [], [], duplicates, [], [], [], []]
    const where = vi.fn()
    const select = vi.fn(() => {
      const result = results.shift()
      const chain = { from: vi.fn(() => chain), innerJoin: vi.fn(() => chain), where: vi.fn((condition) => {
        where(condition)
        return Object.assign(Promise.resolve(result), { orderBy: () => Promise.resolve(result) })
      }) }
      return chain
    })
    const summaries = await loadLineProgramOverviews({ select } as unknown as Parameters<typeof loadLineProgramOverviews>[0], programs)
    expect(select).toHaveBeenCalledTimes(8)
    expect(summaries).toHaveLength(count)
    expect(summaries.every(line => line.overview.reducible === 1 && line.overview.common?.excess === 1)).toBe(true)
    const query = new PgDialect().sqlToQuery(where.mock.calls[3][0])
    expect(query.sql).toContain('any(')
    expect(query.params[0]).toHaveLength(count * 2)
  })
})
