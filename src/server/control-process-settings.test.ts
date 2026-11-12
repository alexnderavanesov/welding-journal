import { describe, expect, it, vi } from 'vitest'
import { weldJoints, preHeatTreatmentControls } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { loadControlProcessSettingsFromTransaction, prepareControlProcessSettingsChangeInTransaction } from './control-process-settings'

describe('control process mode transitions', () => {
  it('locks before reading the current setting for mutations', async () => {
    const tx = transaction()
    await loadControlProcessSettingsFromTransaction(tx as never)
    expect(tx.calls.slice(0, 3)).toEqual(['lock', 'lock', 'read'])
  })
  it('does not initialize old disabled projects or rewrite repeated saves', async () => {
    for (const currentValue of [DEFAULT_CONTROL_PROCESS_SETTINGS, { preHeatTreatmentLnkEnabled: false }]) {
      const tx = transaction()
      const next = await prepareControlProcessSettingsChangeInTransaction({ tx: tx as never, currentValue, nextValue: DEFAULT_CONTROL_PROCESS_SETTINGS })
      expect(next.preHeatTreatmentMode).toBe('selected')
      expect(tx.update).not.toHaveBeenCalled()
    }
  })
  it('ignores retired mode writes; preservation is performed only by the explicit release transition', async () => {
    const tx = transaction([{ id: 1, joint: 'F1', line: 'L', pstoRequired: 'да', preHeatTreatmentRequired: false }], [1])
    await prepareControlProcessSettingsChangeInTransaction({ tx: tx as never, currentValue: { preHeatTreatmentMode: 'allPsto' }, nextValue: DEFAULT_CONTROL_PROCESS_SETTINGS })
    expect(tx.update).not.toHaveBeenCalled()
  })
  it('keeps explicit off choices without history across repeated mode changes', async () => {
    const tx = transaction([{ id: 1, joint: 'F1', line: 'L', pstoRequired: 'да', preHeatTreatmentRequired: false }])
    await prepareControlProcessSettingsChangeInTransaction({ tx: tx as never, currentValue: { preHeatTreatmentMode: 'allPsto' }, nextValue: DEFAULT_CONTROL_PROCESS_SETTINGS })
    expect(tx.update).not.toHaveBeenCalled()
  })
})
function transaction(rows: unknown[] = [], history: number[] = []) {
  const calls: string[] = []
  const set = vi.fn(() => ({ where: async () => {} }))
  const select = () => ({ from: (table: unknown) => {
    calls.push('read')
    const value = table === weldJoints ? rows : table === preHeatTreatmentControls ? history.map(id => ({ id })) : []
    const query: any = { then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(value).then(resolve, reject) }
    for (const method of ['where', 'orderBy', 'limit']) query[method] = () => query
    return query
  } })
  return { calls, set, execute: async () => { calls.push('lock') }, update: vi.fn(() => ({ set })), select, selectDistinct: select }
}
