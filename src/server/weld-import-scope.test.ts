import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WELD_IMPORT_MAX_ROWS } from '@/lib/weld-import-limits'

const testState = vi.hoisted(() => ({
  select: vi.fn(),
  assertSecurityScope: vi.fn(async () => undefined),
}))

vi.mock('@/db', () => ({
  requireDb: () => ({ select: testState.select }),
}))

vi.mock('@/lib/wdi', () => ({
  isSystemWdiMode: () => false,
}))

vi.mock('@/server/security-functions', () => ({
  assertSecurityScope: testState.assertSecurityScope,
}))

vi.mock('@/server/dispatcher-task-index', () => ({
  ensureDispatcherTaskIndexFresh: vi.fn(async () => undefined),
}))

vi.mock('@/server/weld-server-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/weld-server-shared')>()
  return {
    ...actual,
    applyCurrentSystemWdi: (rows: unknown[]) => rows,
    buildWhere: () => undefined,
    getColumnFilterOptionFilters: (filters: unknown) => filters,
    hasDispatcherTaskServerFilter: () => false,
    loadServerOtherSettings: vi.fn(async () => ({})),
  }
})

import { listWeldingJournalImportScope } from '@/server/weld-import'

describe('welding journal import scope query lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops after the count query when the filtered scope exceeds the import limit', async () => {
    const where = vi.fn(async () => [{ total: WELD_IMPORT_MAX_ROWS + 1 }])
    testState.select.mockReturnValue({
      from: () => ({ where }),
    })

    await expect(listWeldingJournalImportScope({
      data: { columnFilters: {} },
    })).resolves.toEqual({
      rows: [],
      total: WELD_IMPORT_MAX_ROWS + 1,
      limitExceeded: true,
      fullyAssignedPstoLineKeys: [],
    })

    expect(testState.select).toHaveBeenCalledTimes(1)
    expect(where).toHaveBeenCalledTimes(1)
  })
})
