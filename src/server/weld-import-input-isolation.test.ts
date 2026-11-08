import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'

const state = vi.hoisted(() => ({ inserted: vi.fn(), synced: vi.fn(), dirty: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: (run: (tx: object) => unknown) => run({}) }) }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: vi.fn(async () => undefined) }))
vi.mock('@/server/control-process-settings', () => ({
  loadControlProcessSettingsFromTransaction: vi.fn(async () => ({ preHeatTreatmentMode: 'selected', pvkGoodOnly: false })),
}))
vi.mock('@/server/weld-line-membership-lock', () => ({ lockWeldLineMemberships: vi.fn(async () => undefined) }))
vi.mock('@/server/line-program-registry', () => ({
  prepareLineProgramWeldRecords: vi.fn(async (_tx: unknown, records: WeldInput[]) => {
    for (const record of records) record.lineProgramId = 7
  }),
}))
vi.mock('@/server/weld-save-validation', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/weld-save-validation')>()
  return { ...actual,
    loadServerWeldValidationContext: vi.fn(async () => ({
      controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS,
      saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS,
      dataListSettings: DEFAULT_DATA_LIST_SETTINGS,
      otherSettings: DEFAULT_OTHER_SETTINGS,
      systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS,
      welderStamps: [], welderStampSuspensions: [], pstoLineAssignments: new Map(),
    })),
    // The unrelated validation refusal happens after the real preparation has
    // assigned server-owned fields, as in an archived official stamp rejection.
    validateServerWeldRecords: vi.fn(({ records }: { records: WeldInput[] }) => {
      if (records.some(row => row.stamp1K === 'ARCHIVED')) throw new Error('Клеймо в архиве')
    }),
  }
})
vi.mock('@/server/weld-mutations', () => ({
  insertWeldJointsInBatches: state.inserted,
  getDispatcherDirtyScopes: () => [],
}))
vi.mock('@/server/system-document-index', () => ({ syncSystemDocumentsForWeldChangesInTransaction: state.synced }))
vi.mock('@/server/dispatcher-task-index-dirty', () => ({ markDispatcherTaskIndexDirty: state.dirty }))

import { importWeldJoints } from './weld-import'

beforeEach(() => {
  vi.clearAllMocks()
  state.inserted.mockImplementation(async (_tx: unknown, records: WeldInput[]) => records.map((row, index) => ({ ...row, id: index + 1 })))
})

it('keeps rejected import input reusable without leaking derived fields into the next request', async () => {
  const input: WeldInput = { projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', stamp1K: 'ARCHIVED' }
  const original = { ...input }
  await expect(importWeldJoints({ data: { records: [input] } })).rejects.toThrow('архиве')
  expect(input).toEqual(original)
  expect(state.inserted).not.toHaveBeenCalled()
  expect(state.synced).not.toHaveBeenCalled()
  expect(state.dirty).not.toHaveBeenCalled()

  const corrected = { ...input, stamp1K: null, stamp1KFact: 'ARCHIVED' }
  const beforeSave = { ...corrected }
  await expect(importWeldJoints({ data: { records: [corrected] } })).resolves.toEqual({ inserted: 1, rows: [{ id: 1 }] })
  expect(corrected).toEqual(beforeSave)
  expect(state.inserted.mock.calls[0][1][0]).toMatchObject({ lineProgramId: 7, preHeatTreatmentRequired: false, stamp1KFact: 'ARCHIVED' })
})

it('still rejects an explicit forged flag before any preparation or write', async () => {
  const forged = { projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', preHeatTreatmentRequired: true }
  await expect(importWeldJoints({ data: { records: [forged] } })).rejects.toThrow('НК до ТО не задаётся импортом')
  expect(forged.preHeatTreatmentRequired).toBe(true)
  expect(state.inserted).not.toHaveBeenCalled()
})
