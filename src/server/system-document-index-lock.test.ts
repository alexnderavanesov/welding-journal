import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import {
  SYSTEM_DOCUMENT_INDEX_LOCK_ORDER,
  lockSystemDocumentIndexes,
} from '@/server/system-document-index'

describe('system document index locks', () => {
  it('deduplicates and locks document types in one canonical query', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await lockSystemDocumentIndexes({ execute } as never, [
      'pstoConclusion',
      'lnkRequest',
      'pstoConclusion',
      'lnkConclusion',
    ])

    expect(execute).toHaveBeenCalledTimes(1)
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0])
    expect(compiled.sql).toContain('pg_advisory_xact_lock')
    expect(compiled.sql).toContain('order by "lock_order"')
    expect(compiled.params).toEqual([
      0,
      'system-document-index:lnkRequest',
      1,
      'system-document-index:lnkConclusion',
      3,
      'system-document-index:pstoConclusion',
    ])
  })

  it('uses the full canonical order by default and skips an empty set', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await lockSystemDocumentIndexes({ execute } as never)
    await lockSystemDocumentIndexes({ execute } as never, [])

    expect(execute).toHaveBeenCalledTimes(1)
    const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0])
    expect(compiled.params.filter((value): value is string => typeof value === 'string')).toEqual(
      SYSTEM_DOCUMENT_INDEX_LOCK_ORDER.map((type) => `system-document-index:${type}`),
    )
  })
})
