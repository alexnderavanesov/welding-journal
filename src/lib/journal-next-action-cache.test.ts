import { expect, it, vi } from 'vitest'
import { buildJointNextActions } from './joint-next-actions'
import { journalNextAction } from './journal-next-action-cache'
import type { WeldRow, RepeatedJointTask } from './dispatcher-types'

vi.mock('./joint-next-actions', async importOriginal => {
  const actual = await importOriginal<typeof import('./joint-next-actions')>()
  return { ...actual, buildJointNextActions: vi.fn(actual.buildJointNextActions) }
})

it('reuses immutable rows on remount, but recomputes new row/task/settings snapshots', () => {
  const row = { id: 12, joint: 'F12', weldDate: '' } as WeldRow
  const settings = { preHeatTreatmentLnkEnabled: false, allowPrimaryLnkBeforePreviousStagesComplete: false }
  vi.mocked(buildJointNextActions).mockClear()
  const action = journalNextAction(row, [], settings)
  expect(action?.title).toBe('Заполнить сварку F12')
  for (let mount = 0; mount < 100; mount++) expect(journalNextAction(row, [], { ...settings })).toBe(action)
  expect(buildJointNextActions).toHaveBeenCalledTimes(1)
  expect(journalNextAction({ ...row, joint: 'F13' }, [], settings)?.title).toBe('Заполнить сварку F13')
  journalNextAction(row, [], { ...settings, preHeatTreatmentLnkEnabled: true })
  journalNextAction(row, [], { ...settings, allowPrimaryLnkBeforePreviousStagesComplete: true })
  // Use an unrelated task to exercise task snapshot invalidation independently
  // of the welding action. The full action rules have their own business tests.
  const tasks = [{ kind: 'create', row: { ...row, id: 13 } } as RepeatedJointTask]
  journalNextAction(row, tasks, settings)
  journalNextAction(row, [...tasks], settings)
  expect(buildJointNextActions).toHaveBeenCalledTimes(6)
})
