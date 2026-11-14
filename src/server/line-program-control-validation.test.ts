import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { linePrograms } from '@/db/schema'

const state = vi.hoisted(() => ({
  rows: [] as WeldRow[], tx: undefined as any, context: { marker: 'locked validation context' },
  prepare: vi.fn(), validate: vi.fn(), persist: vi.fn(), sync: vi.fn(), dirty: vi.fn(), loadContext: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({ createServerOnlyFn: (fn: unknown) => fn, createServerFn: () => {
  const builder = { validator: () => builder, handler: (handler: unknown) => handler }
  return builder
} }))
vi.mock('@/db', () => ({ requireDb: () => ({ transaction: (run: (tx: unknown) => unknown) => run(state.tx) }) }))
vi.mock('@/server/security-functions', () => ({ assertSecurityScope: vi.fn() }))
vi.mock('@/server/control-process-settings', () => ({ loadControlProcessSettingsFromTransaction: vi.fn() }))
vi.mock('@/server/weld-line-membership-lock', () => ({ lockWeldLineMemberships: vi.fn(),
  lockWeldLineMembershipsForWeldIds: () => state.rows, haveSameWeldLineMemberships: () => true }))
vi.mock('@/server/weld-row-version', () => ({ lockInteractiveWeldRows: () => state.rows, assertExpectedInteractiveWeldVersions: vi.fn() }))
vi.mock('@/server/heat-treatment-control-relations', () => ({ attachHeatTreatmentControlRelations: (rows: unknown) => rows }))
vi.mock('@/server/duplicate-control-relations', () => ({ attachDuplicateControlRelations: (rows: unknown) => rows }))
vi.mock('@/server/line-program', () => ({ loadLineProgramRows: () => state.rows,
  loadLineProgramOverviews: () => [], toLineProgramRecord: (line: unknown) => line }))
vi.mock('@/lib/line-program-workspace', () => ({ previewProgramChanges: () => ({ errors: [], newExcess: [],
  records: state.rows.map(row => ({ ...row, hasUzk: 'да' })) }) }))
vi.mock('@/lib/line-program-repair-requirements', () => ({ attachProgramRepairRequirements: (rows: unknown) => rows }))
vi.mock('@/server/weld-save-validation', () => ({
  loadServerWeldValidationContext: state.loadContext,
  prepareServerWeldRecords: state.prepare, validateServerWeldRecords: state.validate,
}))
vi.mock('@/server/weld-persistence', () => ({ updateWeldJointsInBatches: state.persist }))
vi.mock('@/server/system-document-index', () => ({ syncSystemDocumentsForWeldChangesInTransaction: state.sync, lockSystemDocumentIndexes: vi.fn() }))
vi.mock('@/server/dispatcher-task-index-dirty', () => ({ getDispatcherDirtyScopes: () => [], markDispatcherTaskIndexDirty: state.dirty }))
vi.mock('@/server/control-request-removal-preview', () => ({ loadControlRequestRemovalPreview: () => ({ token: 'requests', removals: [] }) }))
vi.mock('@/server/program-approval-lifecycle', () => ({ deleteChangedProgramApprovals: vi.fn() }))

import { changeLayeredControl, changeProgramInTransaction } from './line-program-control'

const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'I', groupName: 'a',
  weldControlPercent: 10, pvkControlPercent: 5, configurationIssue: null, updatedAt: new Date('2026-11-01T00:00:00Z') }
const input = { lineId: 1, lineVersion: line.updatedAt.toISOString(),
  targets: [{ id: 1, version: 'current' }], changes: [{ id: 1, values: { УЗК: 'да' as const } }] }

beforeEach(() => {
  vi.clearAllMocks()
  state.rows = [{ id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1', lineProgramId: 1,
    connectionType: 'У19', hasVik: 'да', stamp1K: 'AAAA' }]
  state.loadContext.mockResolvedValue(state.context)
  state.persist.mockImplementation(async (_tx, rows) => rows)
  state.prepare.mockReset()
  state.validate.mockReset()
  state.tx = {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const values = table === linePrograms ? [line] : state.rows
      return { then: (resolve: (value: unknown) => unknown) => Promise.resolve(values).then(resolve),
        limit: async () => values, for: async () => values }
    } }) }),
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => state.rows }) }) })),
  }
})

describe('line assignment save validation', () => {
  it('validates the preview once, without writes', async () => {
    await changeProgramInTransaction(state.tx, input, true)
    expect(state.prepare).toHaveBeenCalledTimes(1)
    expect(state.validate).toHaveBeenCalledTimes(1)
    expect(state.persist).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.dirty).not.toHaveBeenCalled()
  })

  it('validates a confirmed commit once against its locked context before persistence', async () => {
    const preview = await changeProgramInTransaction(state.tx, input, true)
    vi.clearAllMocks()
    await changeProgramInTransaction(state.tx, { ...input, previewToken: preview.token }, false)
    expect(state.loadContext).toHaveBeenCalledTimes(1)
    expect(state.prepare).toHaveBeenCalledTimes(1)
    expect(state.validate).toHaveBeenCalledTimes(1)
    expect(state.validate.mock.calls[0][0].context).toBe(state.context)
    expect(state.validate.mock.invocationCallOrder[0]).toBeLessThan(state.persist.mock.invocationCallOrder[0])
    expect(state.persist).toHaveBeenCalledTimes(1)
  })

  it('still validates standalone layered assignment before flag and document writes', async () => {
    await (changeLayeredControl as any)({ data: { targets: input.targets, assigned: true } })
    expect(state.loadContext).toHaveBeenCalledTimes(1)
    expect(state.prepare).toHaveBeenCalledTimes(1)
    expect(state.validate).toHaveBeenCalledTimes(1)
    expect(state.validate.mock.invocationCallOrder[0]).toBeLessThan(state.tx.update.mock.invocationCallOrder[0])
    expect(state.persist).toHaveBeenCalledTimes(1)
  })

  it.each(['preview', 'commit', 'layered'] as const)('does not persist failed %s validation', async mode => {
    const preview = await changeProgramInTransaction(state.tx, input, true)
    vi.clearAllMocks()
    state.validate.mockImplementation(() => { throw new Error('independent save check') })
    const run = mode === 'layered'
      ? (changeLayeredControl as any)({ data: { targets: input.targets, assigned: true } })
      : changeProgramInTransaction(state.tx, { ...input, previewToken: preview.token }, mode === 'preview')
    await expect(run).rejects.toThrow('independent save check')
    expect(state.tx.update).not.toHaveBeenCalled()
    expect(state.persist).not.toHaveBeenCalled()
    expect(state.sync).not.toHaveBeenCalled()
    expect(state.dirty).not.toHaveBeenCalled()
  })
})
