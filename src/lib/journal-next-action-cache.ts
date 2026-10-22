import { buildJointNextActions } from './joint-next-actions'
import type { JointNextAction } from './joint-next-actions'
import type { WeldRow, RepeatedJointTask } from './dispatcher-types'
import type { ControlProcessSettings } from './control-process-settings'

type Settings = Pick<ControlProcessSettings, 'preHeatTreatmentLnkEnabled' | 'allowPrimaryLnkBeforePreviousStagesComplete'>
const EMPTY_TASKS: readonly RepeatedJointTask[] = []
const cache = new WeakMap<WeldRow, {
  tasks: readonly RepeatedJointTask[]; preHeat: boolean | undefined; allowEarly: boolean | undefined
  action: JointNextAction | undefined
}>()

/** Journal rows and tasks are immutable query snapshots. Reuse presentation
 * across virtualization remounts, never by ID across refreshed snapshots.
 * Weak keys release evicted blocks; each row retains only its latest variant. */
export function journalNextAction(row: WeldRow, tasks: readonly RepeatedJointTask[], settings?: Settings) {
  const relevant = tasks.length ? tasks : EMPTY_TASKS
  const preHeat = settings?.preHeatTreatmentLnkEnabled, allowEarly = settings?.allowPrimaryLnkBeforePreviousStagesComplete
  const previous = cache.get(row)
  if (previous && previous.tasks === relevant && previous.preHeat === preHeat && previous.allowEarly === allowEarly) return previous.action
  const action = buildJointNextActions(row, tasks, settings)[0]
  cache.set(row, { tasks: relevant, preHeat, allowEarly, action })
  return action
}
