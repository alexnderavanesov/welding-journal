import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  CONTROL_PROCESS_LOCK_ORDER,
  lockAllControlProcessSettings,
} from '@/server/control-process-settings-lock'

describe('control process settings locks', () => {
  it('locks every process in the shared canonical order', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await lockAllControlProcessSettings({ execute })

    expect(execute).toHaveBeenCalledTimes(CONTROL_PROCESS_LOCK_ORDER.length)
    const dialect = new PgDialect()
    expect(execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).params)).toEqual(
      CONTROL_PROCESS_LOCK_ORDER.map((process) => [
        `${PROJECT_SETTING_KEYS.controlProcesses}:${process}`,
      ]),
    )
    expect(execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql)).toEqual(
      CONTROL_PROCESS_LOCK_ORDER.map(() => expect.stringContaining('pg_advisory_xact_lock_shared')),
    )
  })

  it('uses the same order for an exclusive settings change', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)

    await lockAllControlProcessSettings({ execute }, 'exclusive')

    const dialect = new PgDialect()
    const statements = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql)
    expect(statements).toEqual(
      CONTROL_PROCESS_LOCK_ORDER.map(() => expect.stringContaining('pg_advisory_xact_lock')),
    )
    expect(statements.every((statement) => !statement.includes('pg_advisory_xact_lock_shared'))).toBe(true)
  })
})
