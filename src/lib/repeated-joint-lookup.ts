import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import { encodeIdentityKey } from '@/lib/identity-key'
import { parseRepeatedJointName } from '@/lib/joint-chain'
import { isUnofficialJoint } from '@/lib/joint-display'
import {
  compareJointChainRows,
  getRepeatedJointIdentity,
} from '@/lib/repeated-joint-row-utils'
import {
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

type RejectionResolver = (row: WeldInput) => unknown

export type RepeatedJointLookup = ReturnType<typeof buildRepeatedJointLookup>

/**
 * Builds the identity indexes shared by dispatcher chain calculations.
 *
 * The previous implementation repeatedly scanned every weld joint for each
 * rejected joint. On a large journal that made a full dispatcher refresh grow
 * quadratically. Keeping the lookup local to one calculation preserves the
 * same matching rules while making target and rejected-chain reads bounded.
 */
export function buildRepeatedJointLookup(
  rows: readonly WeldRow[],
  getRejectedResult: RejectionResolver,
  systemIndexSettings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const rowsById = new Map<number, WeldRow>()
  const rowsByJointIdentity = new Map<string, WeldRow[]>()
  const rejectedRowsByBranchIdentity = new Map<string, WeldRow[]>()
  const officialRejectedRowsByBranchIdentity = new Map<string, WeldRow[]>()

  for (const row of rows) {
    rowsById.set(row.id, row)

    const jointIdentity = getRepeatedJointIdentity(row)
    if (jointIdentity) {
      appendIdentityRow(rowsByJointIdentity, identityKey(jointIdentity), row)
    }

    if (!getRejectedResult(row)) continue
    const branchJoint = parseRepeatedJointName(
      String(row.joint ?? ''),
      systemIndexSettings,
    ).base
    const branchIdentity = getRepeatedJointIdentity(row, branchJoint)
    if (!branchIdentity) continue
    const branchIdentityKey = identityKey(branchIdentity)
    appendIdentityRow(rejectedRowsByBranchIdentity, branchIdentityKey, row)
    if (!isUnofficialJoint(row)) {
      appendIdentityRow(officialRejectedRowsByBranchIdentity, branchIdentityKey, row)
    }
  }

  for (const index of [rejectedRowsByBranchIdentity, officialRejectedRowsByBranchIdentity]) {
    for (const group of index.values()) {
      group.sort((left, right) => compareJointChainRows(left, right, systemIndexSettings))
    }
  }

  const findRepeatedJointTarget = (sourceRow: WeldInput, joint: string) => {
    const targetIdentity = getRepeatedJointIdentity(sourceRow, joint)
    if (!targetIdentity) return null
    const sourceId = typeof (sourceRow as { id?: unknown }).id === 'number'
      ? (sourceRow as { id: number }).id
      : null
    const sourceJointIdentity = getRepeatedJointIdentity(sourceRow)
    const needsOfficialSameNameTarget =
      isUnofficialJoint(sourceRow) &&
      sourceJointIdentity !== null &&
      sourceJointIdentity.joint === targetIdentity.joint

    return rowsByJointIdentity
      .get(identityKey(targetIdentity))
      ?.find((row) => (
        (sourceId === null || row.id !== sourceId) &&
        (!needsOfficialSameNameTarget || !isUnofficialJoint(row))
      )) ?? null
  }

  const findMatchingJointRow = (anchorRow: WeldInput, joint: string) => {
    const targetIdentity = getRepeatedJointIdentity(anchorRow, joint)
    return targetIdentity
      ? rowsByJointIdentity.get(identityKey(targetIdentity))?.[0] ?? null
      : null
  }

  const getOfficialRejectedJointChainRows = (
    sourceRow: WeldInput,
    sourceJoint: string,
  ) => {
    const sourceBranch = parseRepeatedJointName(sourceJoint, systemIndexSettings).base
    const sourceIdentity = getRepeatedJointIdentity(sourceRow, sourceBranch)
    return sourceIdentity
      ? officialRejectedRowsByBranchIdentity.get(identityKey(sourceIdentity)) ?? []
      : []
  }

  const getRejectedJointChainRows = (
    sourceRow: WeldInput,
    sourceJoint: string,
  ) => {
    const sourceBranch = parseRepeatedJointName(sourceJoint, systemIndexSettings).base
    const sourceIdentity = getRepeatedJointIdentity(sourceRow, sourceBranch)
    return sourceIdentity
      ? rejectedRowsByBranchIdentity.get(identityKey(sourceIdentity)) ?? []
      : []
  }

  return {
    findMatchingJointRow,
    findRepeatedJointTarget,
    getOfficialRejectedJointChainRows,
    getRejectedJointChainRows,
    rowsById,
  }
}

function appendIdentityRow(
  index: Map<string, WeldRow[]>,
  key: string,
  row: WeldRow,
) {
  const current = index.get(key)
  if (current) current.push(row)
  else index.set(key, [row])
}

function identityKey(identity: {
  project: string
  subtitle: string
  line: string
  joint: string
}) {
  return encodeIdentityKey([
    identity.project,
    identity.subtitle,
    identity.line,
    identity.joint,
  ])
}
