import type { RepeatedJointRenameChange, RepeatedJointRenameTask, WeldRow } from '@/lib/dispatcher-types'
import { normalizeJointName, parseJointName } from '@/lib/joint-name'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

export type SystemRepeatedJointRenameRequest = {
  changes: RepeatedJointRenameChange[]
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
  const canonicalChanges = request.changes.map((change) => ({
    rowId: Number(change.rowId),
    currentJoint: toCanonicalSystemJointName(change.currentJoint, systemIndexSettings),
    targetJoint: toCanonicalSystemJointName(change.targetJoint, systemIndexSettings),
  }))
  if (
    canonicalChanges.length === 0 ||
    new Set(canonicalChanges.map((change) => change.rowId)).size !== canonicalChanges.length
  ) return false

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
      isSameRenamePlan(task.changes, canonicalChanges),
  )
}

function isSameRenamePlan(
  expected: readonly RepeatedJointRenameChange[],
  actual: readonly RepeatedJointRenameChange[],
) {
  return expected.length === actual.length && expected.every((change, index) => {
    const candidate = actual[index]
    return Boolean(
      candidate &&
      change.rowId === candidate.rowId &&
      normalizeJointName(change.currentJoint).toUpperCase() === normalizeJointName(candidate.currentJoint).toUpperCase() &&
      normalizeJointName(change.targetJoint).toUpperCase() === normalizeJointName(candidate.targetJoint).toUpperCase()
    )
  })
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
