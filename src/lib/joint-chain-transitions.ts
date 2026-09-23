import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'
import {
  findLastIndex,
  formatRepeatedJointName,
  getCoilJointNames,
  getRepeatedJointFailureCount,
  normalizeJointChainPart,
  parseJointChainName,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { isUnofficialJoint } from '@/lib/joint-display'
import { compareJointChainRows, getRepeatedJointIdentity } from '@/lib/repeated-joint-row-utils'
import {
  getPrimaryRejectedLnkResult,
} from '@/lib/repeated-joint-task-helpers'
import {
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import { encodeIdentityKey } from '@/lib/identity-key'
import { buildRepeatedJointLookup } from '@/lib/repeated-joint-lookup'

export type JointCoilTransitionMode = 'limit' | 'early-decision'

export type JointCoilTransition = {
  key: string
  parentBranchJoint: string
  sourceRowId: number | null
  sourceJoint: string
  targetJoints: [string, string]
  targetRowIds: [number | null, number | null]
  mode: JointCoilTransitionMode | null
}

type BuildJointCoilTransitionsOptions = {
  earlyCoilDecisionSourceRowIds?: ReadonlySet<number>
  getOfficialRejectedJointChainRows?: (
    rows: WeldRow[],
    sourceRow: WeldInput,
    sourceJoint: string,
    settings?: SystemIndexSettings,
  ) => WeldRow[]
  getPrimaryRejectedLnkResult?: (row: WeldInput) => unknown
  systemIndexSettings?: SystemIndexSettings
}

export function getCoilTransitionModeForSource({
  earlyCoilDecisionSourceRowIds = new Set(),
  officialRejectedRows,
  sourceRow,
  systemIndexSettings = loadSystemIndexSettings(),
}: {
  earlyCoilDecisionSourceRowIds?: ReadonlySet<number>
  officialRejectedRows: readonly WeldRow[]
  sourceRow: WeldRow
  systemIndexSettings?: SystemIndexSettings
}): JointCoilTransitionMode | null {
  if (isUnofficialJoint(sourceRow) || officialRejectedRows.at(-1)?.id !== sourceRow.id) return null
  const inferredRejectedCount = getRepeatedJointFailureCount(
    parseRepeatedJointName(String(sourceRow.joint ?? ''), systemIndexSettings),
  ) + 1
  if (Math.max(officialRejectedRows.length, inferredRejectedCount) > 3) return 'limit'
  return earlyCoilDecisionSourceRowIds.has(sourceRow.id) ? 'early-decision' : null
}

export function getCoilParentBranchJoint(
  joint: unknown,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const parsed = parseJointChainName(String(joint ?? '').trim(), settings)
  const lastCoilIndex = findLastIndex(parsed.segments, (segment) => segment.suffix === 'Y')
  if (lastCoilIndex < 0) return null
  return formatRepeatedJointName(parsed.base, parsed.segments.slice(0, lastCoilIndex), settings)
}

export function buildJointCoilTransitions(
  rows: readonly WeldRow[],
  options: BuildJointCoilTransitionsOptions = {},
): JointCoilTransition[] {
  const settings = options.systemIndexSettings ?? loadSystemIndexSettings()
  const earlyDecisionSourceRowIds = options.earlyCoilDecisionSourceRowIds ?? new Set<number>()
  const rejectionResolver = options.getPrimaryRejectedLnkResult ?? getPrimaryRejectedLnkResult
  const repeatedJointLookup = buildRepeatedJointLookup(rows, rejectionResolver, settings)
  // Custom resolvers are read-only. Copy once rather than once per rejected
  // joint, which otherwise makes a large line allocate quadratically.
  const resolverRows = options.getOfficialRejectedJointChainRows ? [...rows] : null
  const anchorsByParentBranch = new Map<string, { parentBranchJoint: string; row: WeldRow }>()
  const validSourcesByParentBranch = new Map<string, { mode: JointCoilTransitionMode; row: WeldRow }>()

  for (const row of rows) {
    const rowJoint = String(row.joint ?? '').trim()
    if (!rowJoint) continue
    const rowBranch = parseRepeatedJointName(rowJoint, settings).base
    const parentBranch = getCoilParentBranchJoint(rowBranch, settings)
    if (parentBranch) {
      const key = buildTransitionKey(row, parentBranch)
      if (!anchorsByParentBranch.has(key)) {
        anchorsByParentBranch.set(key, { parentBranchJoint: parentBranch, row })
      }
    }

    const rejection = rejectionResolver(row)
    if (!rejection || isUnofficialJoint(row)) continue
    const officialRejectedRows = options.getOfficialRejectedJointChainRows
      ? options.getOfficialRejectedJointChainRows(resolverRows!, row, rowJoint, settings)
      : repeatedJointLookup.getOfficialRejectedJointChainRows(row, rowJoint)
    const mode = getCoilTransitionModeForSource({
      earlyCoilDecisionSourceRowIds: earlyDecisionSourceRowIds,
      officialRejectedRows,
      sourceRow: row,
      systemIndexSettings: settings,
    })
    if (!mode) continue
    const parentBranchJoint = parseRepeatedJointName(rowJoint, settings).base
    const transitionKey = buildTransitionKey(row, parentBranchJoint)
    validSourcesByParentBranch.set(transitionKey, { mode, row })
    if (!anchorsByParentBranch.has(transitionKey)) {
      anchorsByParentBranch.set(transitionKey, { parentBranchJoint, row })
    }
  }

  return [...anchorsByParentBranch.entries()]
    .map(([parentKey, { parentBranchJoint, row: anchorRow }]) => {
      const validSource = validSourcesByParentBranch.get(parentKey)
      const targetJoints = getCoilJointNames(parentBranchJoint, settings) as [string, string]
      const targetRows = targetJoints.map((targetJoint) =>
        repeatedJointLookup.findMatchingJointRow(anchorRow, targetJoint) ?? undefined,
      ) as [WeldRow | undefined, WeldRow | undefined]
      const fallbackSource = repeatedJointLookup
        .getRejectedJointChainRows(anchorRow, parentBranchJoint)
        .at(-1)
      const sourceRow = validSource?.row ?? fallbackSource
      return {
        key: buildTransitionKey(anchorRow, parentBranchJoint),
        parentBranchJoint,
        sourceRowId: validSource?.row.id ?? null,
        sourceJoint: String(sourceRow?.joint ?? '').trim(),
        targetJoints,
        targetRowIds: [targetRows[0]?.id ?? null, targetRows[1]?.id ?? null] as [
          number | null,
          number | null,
        ],
        mode: validSource?.mode ?? null,
      }
    })
    .sort((left, right) => left.parentBranchJoint.localeCompare(right.parentBranchJoint, 'ru', { numeric: true }))
}

export function getJointBranchRows(
  rows: readonly WeldRow[],
  row: WeldRow,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const branchJoint = parseRepeatedJointName(String(row.joint ?? ''), settings).base
  const identity = getRepeatedJointIdentity(row, branchJoint)
  if (!identity) return []
  return rows
    .filter((candidate) => {
      const candidateBranch = parseRepeatedJointName(String(candidate.joint ?? ''), settings).base
      const candidateIdentity = getRepeatedJointIdentity(candidate, candidateBranch)
      return Boolean(
        candidateIdentity &&
          candidateIdentity.project === identity.project &&
          candidateIdentity.subtitle === identity.subtitle &&
          candidateIdentity.line === identity.line &&
          candidateIdentity.joint === identity.joint,
      )
    })
    .sort((left, right) => compareJointChainRows(left, right, settings))
}

export function getJointCoilRelations(
  row: WeldRow,
  rows: readonly WeldRow[],
  transitions: readonly JointCoilTransition[],
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const branchJoint = parseRepeatedJointName(String(row.joint ?? ''), settings).base
  const parentBranchJoint = getCoilParentBranchJoint(branchJoint, settings)
  const incoming = parentBranchJoint
    ? transitions.find((transition) => transition.key === buildTransitionKey(row, parentBranchJoint)) ?? null
    : null
  const outgoing = transitions.find(
    (transition) => transition.key === buildTransitionKey(row, branchJoint),
  ) ?? null
  const currentBranchRoot = findMatchingJointRow(rows, row, branchJoint) ?? null
  const siblingJoint = incoming
    ? incoming.targetJoints.find((joint) => !sameJoint(joint, branchJoint)) ?? ''
    : ''
  const siblingRow = siblingJoint
    ? findMatchingJointRow(rows, row, siblingJoint) ?? null
    : null
  const sourceRow = incoming?.sourceRowId
    ? rows.find((candidate) => candidate.id === incoming.sourceRowId) ?? null
    : null

  return {
    branchJoint,
    currentBranchRoot,
    incoming,
    outgoing,
    parentBranchJoint,
    siblingJoint,
    siblingRow,
    sourceRow,
  }
}

function findMatchingJointRow(rows: readonly WeldRow[], anchorRow: WeldRow, targetJoint: string) {
  const targetIdentity = getRepeatedJointIdentity(anchorRow, targetJoint)
  if (!targetIdentity) return undefined
  return rows.find((candidate) => {
    const candidateIdentity = getRepeatedJointIdentity(candidate)
    return Boolean(
      candidateIdentity &&
        candidateIdentity.project === targetIdentity.project &&
        candidateIdentity.subtitle === targetIdentity.subtitle &&
        candidateIdentity.line === targetIdentity.line &&
        candidateIdentity.joint === targetIdentity.joint,
    )
  })
}

function buildTransitionKey(row: WeldRow, parentBranchJoint: string) {
  const identity = getRepeatedJointIdentity(row, parentBranchJoint)
  return identity
    ? encodeIdentityKey([
        identity.project,
        identity.subtitle,
        identity.line,
        identity.joint,
      ])
    : normalizeJointChainPart(parentBranchJoint)
}

function sameJoint(left: unknown, right: unknown) {
  return normalizeJointChainPart(left) === normalizeJointChainPart(right)
}
