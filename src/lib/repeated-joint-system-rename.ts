import type { RepeatedJointRenameTask, WeldRow } from '@/lib/dispatcher-types'
import { normalizeJointName, parseJointName } from '@/lib/joint-name'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

export type SystemRepeatedJointRenameRequest = {
  id: number
  currentJoint: string
  targetJoint: string
}

export function isAuthorizedSystemRepeatedJointRename(
  rows: WeldRow[],
  request: SystemRepeatedJointRenameRequest,
  systemIndexSettings: SystemIndexSettings,
) {
  const canonicalRows = rows.map((row) => ({
    ...row,
    joint: toCanonicalSystemJointName(row.joint, systemIndexSettings),
  }))
  const canonicalCurrentJoint = toCanonicalSystemJointName(request.currentJoint, systemIndexSettings)
  const canonicalTargetJoint = toCanonicalSystemJointName(request.targetJoint, systemIndexSettings)

  return buildRepeatedJointTasks(canonicalRows, [], [], {
    includeControlHistoryChecks: false,
    includeIncompleteStampChecks: false,
    includeJointCoreDataChecks: false,
    includeLineConsistencyTasks: false,
    includeLnkResultCompletenessChecks: false,
    includePercentageLineControlTasks: false,
    includePstoResultCompletenessChecks: false,
    includeWelderStampCompatibilityChecks: false,
  }).some(
    (task): task is RepeatedJointRenameTask =>
      task.kind === 'rename' &&
      task.row.id === request.id &&
      normalizeJointName(task.currentJoint).toUpperCase() === canonicalCurrentJoint.toUpperCase() &&
      normalizeJointName(task.targetJoint).toUpperCase() === canonicalTargetJoint.toUpperCase(),
  )
}

export function toCanonicalSystemJointName(
  value: unknown,
  systemIndexSettings: SystemIndexSettings = DEFAULT_SYSTEM_INDEX_SETTINGS,
) {
  const parsed = parseJointName(value, systemIndexSettings)
  if (!parsed.hasRequiredPrefix) return normalizeJointName(value)

  const sourcePrefix = parsed.base.slice(0, 1).toUpperCase()
  const canonicalPrefix = sourcePrefix === systemIndexSettings.shopJoint.toUpperCase() ? 'S' : 'F'
  const canonicalBase = `${canonicalPrefix}${parsed.base.slice(1)}`
  return `${canonicalBase}${parsed.segments.map((segment) => `${segment.suffix}${segment.index}`).join('')}`
}
