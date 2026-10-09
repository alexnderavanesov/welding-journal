import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { loadLineProgramOverviews } from './line-program'
import type { LineProgramRecord } from '@/lib/line-program'

describe('batched history protection for line summaries', () => {
  it.each([[1, 2], [1000, 2], [600, 20]])('bounds history reads for %i lines of %i joints, preserving complete groups', async (count, perLine) => {
    const programs: LineProgramRecord[] = Array.from({ length: count }, (_, index) => ({
      id: index + 1, projectTitle: 'P', subtitleCode: 'S', line: `L${index}`,
      category: 'II', groupName: 'A', weldControlPercent: 50, pvkControlPercent: 0,
      version: '1', configurationIssue: null,
    }))
    const rows = programs.flatMap((line, index) => Array.from({ length: perLine }, (_, offset) => ({
      id: index * perLine + offset + 1, projectTitle: 'P', subtitleCode: 'S', line: line.line,
      joint: `F${offset}`, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', hasRk: 'да',
    })))
    // A conclusion-only legacy duplicate must agree with the full joint view's protection.
    const duplicates = programs.map((_, index) => ({ id: index + 1, weldJointId: index * perLine + perLine,
      method: 'РК', result: null, conclusion: 'ЗНК', conclusionDate: '2026-09-02', controlDate: '2026-09-02',
    }))
    const results: unknown[][] = [...(count > 1 ? [programs.map(line => ({ id: line.id, joints: perLine }))] : []), [], []]
    const batchSize = Math.floor(10_000 / perLine)
    for (let index = 0; index < count; index += batchSize) {
      results.push(rows.slice(index * perLine, (index + batchSize) * perLine), [], [], duplicates.slice(index, index + batchSize), [], [])
    }
    const where = vi.fn()
    const select = vi.fn(() => {
      const result = results.shift()
      const chain = { from: vi.fn(() => chain), innerJoin: vi.fn(() => chain), where: vi.fn((condition) => {
        where(condition)
        return Object.assign(Promise.resolve(result), { orderBy: () => Promise.resolve(result), groupBy: () => Promise.resolve(result) })
      }) }
      return chain
    })
    const summaries = await loadLineProgramOverviews({ select } as unknown as Parameters<typeof loadLineProgramOverviews>[0], programs)
    // Two settings reads, one compact count query for multiple lines, and six
    // reads per 10k-joint batch. No per-line/per-row SQL or concurrent fan-out.
    expect(select).toHaveBeenCalledTimes(2 + Number(count > 1) + 6 * Math.ceil(count / batchSize))
    expect(summaries).toHaveLength(count)
    expect(summaries.every(line => line.overview.joints === perLine && line.overview.reducible === perLine / 2 && line.overview.common?.excess === perLine / 2)).toBe(true)
    const query = new PgDialect().sqlToQuery(where.mock.calls[5 + Number(count > 1)][0])
    expect(query.sql).toContain('any(')
    expect(query.params[0]).toHaveLength(Math.min(count * perLine, 10_000))
    expect(results).toEqual([])
  })
})
