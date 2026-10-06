import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { attachDuplicateControlRelations } from './duplicate-control-relations'
import { getUnofficialDuplicateControlBlockReason } from '@/lib/duplicate-control-officiality'
import { getDuplicateControls } from '@/lib/duplicate-control-utils'

describe('officiality duplicate-history load complexity', () => {
  it.each([1, 1_000, 200_000])('hydrates %i rows in one array-bound query, without per-row lookups', async count => {
    const rows = Array.from({ length: count }, (_, index) => ({ id: index + 1, joint: `F${index + 1}` }))
    const record = { id: 9, weldJointId: count, method: 'ВИК', result: '', updatedAt: new Date('2026-10-01T00:00:00Z') }
    const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn().mockResolvedValue([record]) }
    query.from.mockReturnValue(query)
    query.where.mockReturnValue(query)
    const db = { select: vi.fn().mockReturnValue(query) }
    const hydrated = await attachDuplicateControlRelations(rows, db as never)
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(query.orderBy).toHaveBeenCalledTimes(1)
    const sql = new PgDialect().sqlToQuery(query.where.mock.calls[0][0])
    expect(sql.params).toHaveLength(1)
    expect(hydrated).toHaveLength(count)
    expect(getUnofficialDuplicateControlBlockReason(hydrated[count - 1])).toContain('есть дубль-контроль')
    if (count > 1) expect(getUnofficialDuplicateControlBlockReason(hydrated[0])).toBeNull()
    expect(getDuplicateControls(hydrated[count - 1])).toHaveLength(1)
  })
})
