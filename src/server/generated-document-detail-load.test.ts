import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { requireDb } from '@/db'
import { loadRemoteGeneratedDocument } from '@/server/generated-documents'

vi.mock('@/db', () => ({ requireDb: vi.fn() }))

describe('single document live metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([1, 200_000])('uses two scoped queries and one aggregate record for %i welds', async rowCount => {
    const record = { id: 42, type: 'weldingJournal', title: 'ЖСР', rowCount,
      periodFrom: '2026-09-02', periodTo: '2026-09-02', wdiTotal: rowCount * 2,
      projects: ['П1'], subtitleCodes: ['Ш1'], lines: ['Л1'],
      createdAt: '2026-09-02T12:00:00.000Z', updatedAt: '2026-09-02T12:00:00.000Z' }
    const execute = vi.fn().mockResolvedValue({ rows: [{ documents: [record], total: 1 }] })
    const limit = vi.fn().mockResolvedValue([])
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }))
    vi.mocked(requireDb).mockReturnValue({ select, execute } as unknown as ReturnType<typeof requireDb>)

    expect(await loadRemoteGeneratedDocument(42)).toMatchObject(record)
    expect(select).toHaveBeenCalledTimes(1)
    expect(limit).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql).toMatch(/"generated_documents"\."id" = \$\d+/)
    expect(query.params).toContain(42)
    expect(query.sql).toContain('count("generated_document_weld_joints"."weld_joint_id")')
    expect(query.sql).toContain('min("weld_joints"."weld_date")')
    expect(query.sql).toContain('max("weld_joints"."weld_date")')
    expect(query.sql).not.toContain('"generated_documents"."row_count"')
    expect(query.sql).not.toContain('"generated_documents"."period_from"')
  })

  it('returns null for a missing or unsupported document', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ documents: [], total: 0 }] })
    vi.mocked(requireDb).mockReturnValue({ execute,
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    } as unknown as ReturnType<typeof requireDb>)
    expect(await loadRemoteGeneratedDocument(42)).toBeNull()
  })

  it.each([
    ['2026-10-01T23:17:28.517394+00:00', '2026-10-01T23:17:28.517Z'],
    ['2026-10-02T02:17:28.517+03:00', '2026-10-01T23:17:28.517Z'],
    ['2026-10-01T23:17:28+00:00', '2026-10-01T23:17:28.000Z'],
  ])('normalizes PostgreSQL timestamp %s to the server version format', async (value, expected) => {
    vi.mocked(requireDb).mockReturnValue({
      execute: async () => ({ rows: [{ documents: [{ id: 42, type: 'weldingJournal', createdAt: value, updatedAt: value }], total: 1 }] }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    } as unknown as ReturnType<typeof requireDb>)
    expect(await loadRemoteGeneratedDocument(42)).toMatchObject({ createdAt: expected, updatedAt: expected })
  })

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects ID %s before it can fall back to all documents', async id => {
    await expect(loadRemoteGeneratedDocument(id)).rejects.toThrow('ID документа')
    expect(requireDb).not.toHaveBeenCalled()
  })
})
