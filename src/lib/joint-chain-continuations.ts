import type { JointChainContinuation, WeldRow } from '@/lib/dispatcher-types'
import { normalizeJointChainPart } from '@/lib/joint-chain'
import { buildJointCoilTransitions } from '@/lib/joint-chain-transitions'
import { isUnofficialJoint } from '@/lib/joint-display'
import {
  getExpectedRepeatedJointName,
  getPrimaryRejectedLnkResult,
} from '@/lib/repeated-joint-task-helpers'
import { buildRepeatedJointLookup } from '@/lib/repeated-joint-lookup'
import {
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

type BuildJointChainContinuationsOptions = {
  earlyCoilDecisionSourceRowIds?: ReadonlySet<number>
  systemIndexSettings?: SystemIndexSettings
}

export function buildJointChainContinuations(
  rows: WeldRow[],
  options: BuildJointChainContinuationsOptions = {},
): JointChainContinuation[] {
  const systemIndexSettings = options.systemIndexSettings ?? loadSystemIndexSettings()
  const earlyCoilDecisionSourceRowIds = options.earlyCoilDecisionSourceRowIds ?? new Set<number>()
  const repeatedJointLookup = buildRepeatedJointLookup(
    rows,
    getPrimaryRejectedLnkResult,
    systemIndexSettings,
  )
  const coilTransitionsBySourceRowId = new Map(
    buildJointCoilTransitions(rows, {
      earlyCoilDecisionSourceRowIds,
      getOfficialRejectedJointChainRows: (_rows, sourceRow, sourceJoint) =>
        repeatedJointLookup.getOfficialRejectedJointChainRows(sourceRow, sourceJoint),
      systemIndexSettings,
    })
      .filter(
        (transition) =>
          transition.sourceRowId !== null &&
          transition.mode !== null,
      )
      .map((transition) => [transition.sourceRowId as number, transition] as const),
  )
  const continuations: JointChainContinuation[] = []

  for (const row of rows) {
    const rejection = getPrimaryRejectedLnkResult(row)
    if (!rejection) continue
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) continue

    const coilTransition = coilTransitionsBySourceRowId.get(row.id)
    if (coilTransition) {
      if (coilTransition.targetRowIds.every((rowId) => rowId !== null)) {
        continuations.push(createContinuation(row, {
          kind: 'coil',
          sourceJoint,
          targetJoints: [...coilTransition.targetJoints],
          targetRowIds: coilTransition.targetRowIds as [number, number],
        }))
      }
      continue
    }

    const targetJoint = getExpectedRepeatedJointName(
      row,
      sourceJoint,
      rejection.result,
      systemIndexSettings,
    )
    const targetRow = repeatedJointLookup.findRepeatedJointTarget(row, targetJoint)
    if (!targetRow) continue

    continuations.push(createContinuation(row, {
      kind:
        isUnofficialJoint(row) &&
        normalizeJointChainPart(sourceJoint) === normalizeJointChainPart(targetJoint)
          ? 'official-joint'
          : 'repeated-joint',
      sourceJoint,
      targetJoints: [String(targetRow.joint ?? '').trim() || targetJoint],
      targetRowIds: [targetRow.id],
    }))
  }

  return continuations.sort((left, right) => left.sourceRowId - right.sourceRowId)
}

function createContinuation(
  row: WeldRow,
  continuation: Pick<
    JointChainContinuation,
    'kind' | 'sourceJoint' | 'targetJoints' | 'targetRowIds'
  >,
): JointChainContinuation {
  return {
    ...continuation,
    sourceRowId: row.id,
    projectTitle: String(row.projectTitle ?? '').trim(),
    subtitleCode: String(row.subtitleCode ?? '').trim(),
    line: String(row.line ?? '').trim(),
  }
}
