import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import type { WeldInput } from '@/lib/weld-fields'
import {
  getRequestDocumentAdvisoryLockKeys,
  getRequestDocumentIdentityLockKeys,
  lockRequestDocumentAdvisoryKeys,
} from '@/server/weld-mutations'

describe('request-document concurrency keys', () => {
  it('serializes the same request identity and keeps LNK separate from PSTO', () => {
    expect(getRequestDocumentIdentityLockKeys([
      { kind: 'psto', name: ' Заявка 1 ', date: '04.09.2026' },
      { kind: 'lnk', name: 'Заявка 1', date: '2026-09-04' },
      { kind: 'lnk', name: ' Заявка 1 ', date: '04.09.2026' },
      { kind: 'lnk', name: '', date: '2026-09-04' },
    ])).toEqual([
      'request-document:lnk:["Заявка 1","2026-09-04"]',
      'request-document:psto:["Заявка 1","2026-09-04"]',
    ])
  })

  it('locks every distinct submitted request before any target row is changed', () => {
    const rows = [
      {
        vikRequest: 'ЛНК-1',
        vikRequestDate: '2026-09-04',
        rkRequest: 'ЛНК-1',
        rkRequestDate: '2026-09-04',
      },
      {
        uzkRequest: 'ЛНК-2',
        uzkRequestDate: '2026-09-05',
      },
    ] as WeldInput[]

    expect(getRequestDocumentAdvisoryLockKeys(rows, 'lnk')).toEqual([
      'request-document:lnk:["ЛНК-1","2026-09-04"]',
      'request-document:lnk:["ЛНК-2","2026-09-05"]',
    ])
    expect(getRequestDocumentAdvisoryLockKeys(rows, 'welding')).toEqual([])
  })

  it.each([2, 100])('locks %i request identities with one ordered query', async (identityCount) => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })

    await lockRequestDocumentAdvisoryKeys(
      { execute } as never,
      Array.from({ length: identityCount }, (_, index) => `request-document:lnk:${index}`),
    )

    expect(execute).toHaveBeenCalledTimes(1)
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]![0])
    expect(compiled.sql).toContain('select pg_advisory_xact_lock')
    expect(compiled.sql).toContain('order by "lock_order"')
  })

  it('keeps the global lock order while chunking a large identity set', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })

    await lockRequestDocumentAdvisoryKeys(
      { execute } as never,
      Array.from({ length: 2_001 }, (_, index) => `request-document:lnk:${String(2_001 - index).padStart(4, '0')}`),
    )

    expect(execute).toHaveBeenCalledTimes(3)
    const compiled = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query))
    expect(compiled.every((query) => query.params.length <= 2_000)).toBe(true)
    expect(String(compiled[0]?.params.at(-1)).localeCompare(String(compiled[1]?.params[1]))).toBeLessThan(0)
    expect(String(compiled[1]?.params.at(-1)).localeCompare(String(compiled[2]?.params[1]))).toBeLessThan(0)
  })
})
