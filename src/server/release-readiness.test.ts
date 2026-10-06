import { expect, it, vi } from 'vitest'
import { isDatabaseReleaseReady } from './release-readiness'
import { DATA_RELEASE_VALUE, isCompletedTransition } from '@/lib/release-contract'
import { PgDialect } from 'drizzle-orm/pg-core'

it('requires schema AND both completed data transitions, not just an HTTP 200', async () => {
  for (const [row, expected] of [
    [{ release: DATA_RELEASE_VALUE, transition: '{"status":"complete"}' }, true],
    [{ release: '{"status":"complete","schemaTime":1}', transition: '{"status":"complete"}' }, false],
    [{ release: 'complete', transition: '{"status":"complete"}' }, false],
    [{ release: null, transition: '{"status":"complete"}' }, false],
    [{ release: DATA_RELEASE_VALUE, transition: '{"status":"restored"}' }, false],
    [{ release: DATA_RELEASE_VALUE, transition: 'invalid json' }, false],
  ] as const) {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ available: true }] }).mockResolvedValueOnce({ rows: [row] })
    expect(await isDatabaseReleaseReady({ execute } as never)).toBe(expected)
    expect(execute).toHaveBeenCalledTimes(2)
    for (const [query] of execute.mock.calls) {
      const statement = new PgDialect().sqlToQuery(query).sql
      expect(statement).not.toMatch(/drizzle|weld_joints/)
      expect(statement).toContain('public.app_settings')
    }
  }
})

it('does not select missing tables on an empty database', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ available: false }] })
  expect(await isDatabaseReleaseReady({ execute } as never)).toBe(false)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(isCompletedTransition(null)).toBe(false)
})
