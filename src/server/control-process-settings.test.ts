import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { loadControlProcessSettingsFromTransaction, prepareControlProcessSettingsChangeInTransaction } from '@/server/control-process-settings'

describe('control process settings transitions', () => {
  it('locks before reading the current setting for mutations', async () => {
    const tx = transaction()
    await loadControlProcessSettingsFromTransaction(tx as never)
    expect(tx.calls).toEqual(['lock', 'lock', 'read'])
  })

  it.each([true, false])('changes availability to %s without scanning or updating weld rows', async (enabled) => {
    const tx = transaction()
    const settings = await prepareControlProcessSettingsChangeInTransaction({
      tx: tx as never,
      currentValue: { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: !enabled },
      nextValue: { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: enabled, allowPrimaryLnkBeforePreviousStagesComplete: true },
    })
    expect(settings.preHeatTreatmentLnkEnabled).toBe(enabled)
    expect(settings.allowPrimaryLnkBeforePreviousStagesComplete).toBe(enabled)
    expect(tx.calls).toEqual(enabled ? ['lock'] : ['lock', 'read'])
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('still blocks disabling with unfinished or rejected pre-TO documents', async () => {
    const tx = transaction(3)
    await expect(prepareControlProcessSettingsChangeInTransaction({
      tx: tx as never,
      currentValue: DEFAULT_CONTROL_PROCESS_SETTINGS,
      nextValue: { ...DEFAULT_CONTROL_PROCESS_SETTINGS, preHeatTreatmentLnkEnabled: false },
    })).rejects.toThrow('незавершенных заявок или негодных результатов — 3')
    expect(tx.update).not.toHaveBeenCalled()
  })
})

function transaction(blockers = 0) {
  const calls: string[] = []
  return {
    calls,
    execute: async () => { calls.push('lock') },
    update: vi.fn(() => { throw new Error('unexpected weld UPDATE') }),
    select: () => {
      calls.push('read')
      return { from: () => ({ where: () => Object.assign(Promise.resolve([{ total: blockers }]), {
        limit: async () => [{ value: JSON.stringify(DEFAULT_CONTROL_PROCESS_SETTINGS) }],
      }) }) }
    },
  }
}
