import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

const state = vi.hoisted(() => ({
  revision: 1_000_000, calculations: 0,
  cache: new Map<string, { revision: number; payload: string }>(), query: vi.fn(),
  gate: undefined as Promise<void> | undefined,
}))
vi.mock('@/db', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  return { requireDb: () => drizzle({ client: { query: state.query } as unknown as Pool }) }
})

import { loadLineProgramPage, loadLineProgramSection, normalizeProgramSectionRequest } from './line-program'

beforeEach(() => {
  state.revision++
  state.calculations = 0
  state.cache.clear()
  state.gate = undefined
  state.query.mockReset().mockImplementation(async (config, params: unknown[] = []) => {
    const text = typeof config === 'string' ? config : config.text
    if (text.includes('with "ensure_state"')) {
      const key = params.find(value => typeof value === 'string' && /line-program-(section|page):/.test(value)) as string | undefined
      const cached = state.cache.get(key ?? '')
      return { rows: [{ sourceRevision: state.revision, payload: cached?.revision === state.revision ? cached.payload : null }] }
    }
    if (text.startsWith('insert into "derived_calculation_cache"')) {
      state.cache.set(String(params[0]), { revision: Number(params[1]), payload: String(params[2]) })
    }
    if (text.startsWith('select "source_revision" from "derived_calculation_state"')) return { rows: [[state.revision]] }
    if (text.includes('select "source_revision" as "sourceRevision"')) return { rows: [{ sourceRevision: state.revision }] }
    if (text.includes('from "line_programs"')) {
      state.calculations++
      await state.gate
    }
    return { rows: [] }
  })
})

describe('shared complete line section cache', () => {
  it('normalizes a literal search and rejects unknown tabs', () => {
    expect(normalizeProgramSectionRequest({ search: '  ЛИНИЯ_%\\  ' })).toEqual({ tab: 'lines', search: 'линия_%\\' })
    expect(() => normalizeProgramSectionRequest({ tab: 'wrong' as 'lines' })).toThrow('Неизвестная вкладка')
    expect(() => normalizeProgramSectionRequest({ tab: '' as 'lines' })).toThrow('Неизвестная вкладка')
  })

  it('isolates early pages from complete section calculations and escapes literal LIKE characters', async () => {
    const data = { tab: 'lines' as const, search: 'a_%\\', page: 99 }
    expect(await loadLineProgramPage(data)).toEqual({ rows: [], total: 0, page: 0, revision: state.revision })
    await loadLineProgramPage(data)
    expect(state.calculations).toBe(1)
    await loadLineProgramSection({ tab: data.tab, search: data.search })
    expect(state.calculations).toBe(2)
    const [query, parameters] = state.query.mock.calls.find(([config]) => config.text?.includes('from "line_programs"'))!
    expect(query.text).toContain(' in (')
    expect(query.text).not.toContain('"line_program_id"')
    expect(parameters).toContain('%a\\_\\%\\\\%')
  })
  it('coalesces concurrent users and reuses the result until the source revision changes', async () => {
    const request = { tab: 'lines' as const, search: '' }
    const results = await Promise.all(Array.from({ length: 5 }, () => loadLineProgramSection(request)))
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ rows: [], revision: state.revision })))
    expect(state.calculations).toBe(1)
    await loadLineProgramSection(request)
    expect(state.calculations).toBe(1)
    state.revision++
    await loadLineProgramSection(request)
    expect(state.calculations).toBe(2)
    const begins = state.query.mock.calls.filter(([config]) => config.text?.startsWith('begin'))
    // Each cold snapshot has its separate short, revision-locked publication.
    expect(begins).toHaveLength(4)
    expect(begins.filter(([config]) => config.text.includes('isolation level repeatable read read only'))).toHaveLength(2)
  })

  it('separates section/search identities', async () => {
    for (const request of [{ tab: 'lines' as const, search: '' }, { tab: 'full' as const, search: '' }, { tab: 'lines' as const, search: 'L1' }]) {
      await loadLineProgramSection(request)
    }
    expect(state.calculations).toBe(3)
  })

  it('does not cache a calculation whose source changed while it was running', async () => {
    let release!: () => void
    state.gate = new Promise<void>(resolve => { release = resolve })
    const request = { tab: 'lines' as const, search: '' }
    const snapshotRevision = state.revision
    const pending = loadLineProgramSection(request)
    await vi.waitFor(() => expect(state.calculations).toBe(1))
    state.revision++
    release()
    expect((await pending).revision).toBe(snapshotRevision)
    expect(state.cache.size).toBe(0)
    state.gate = undefined
    await loadLineProgramSection(request)
    expect(state.calculations).toBe(2)
  })
})
