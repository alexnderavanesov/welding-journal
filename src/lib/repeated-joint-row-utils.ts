import { type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { compareReportRows } from '@/lib/report-row-utils'
import { compareJointChainSuffix, normalizeJointChainPart, parseJointChainName, parseRepeatedJointName } from '@/lib/joint-chain'
import { getJointChainIdentity, isUnofficialJoint } from '@/lib/joint-display'
import type { WeldRow } from '@/lib/dispatcher-types'

export function getRepeatedJointIdentity(row: WeldInput, jointOverride?: string) {
  const joint = String(jointOverride ?? row.joint ?? '').trim()
  if (!joint) return null
  return {
    project: normalizeJointChainPart(row.projectTitle),
    subtitle: normalizeJointChainPart(row.subtitleCode),
    line: normalizeJointChainPart(row.line),
    joint: normalizeJointChainPart(joint),
  }
}

export function getDuplicateJointKey(row: WeldInput) {
  if (isUnofficialJoint(row)) return null
  const values = ['projectTitle', 'subtitleCode', 'line', 'joint'].map((fieldKey) =>
    normalizeJointChainPart(row[fieldKey as WeldFieldKey]),
  )
  if (values.every((value) => value === '')) return null
  return values.join('|')
}

export function getRepeatedJointBranchKey(row: WeldInput) {
  const joint = String(row.joint ?? '').trim()
  if (!joint) return null
  const branchJoint = parseRepeatedJointName(joint).base
  const identity = getRepeatedJointIdentity(row, branchJoint)
  if (!identity) return null
  return `${identity.project}:${identity.subtitle}:${identity.line}:${identity.joint}`
}

export function compareJointChainRows(left: WeldRow, right: WeldRow) {
  const leftParsed = parseJointChainName(String(left.joint ?? ''))
  const rightParsed = parseJointChainName(String(right.joint ?? ''))
  const leftBase = normalizeJointChainPart(leftParsed.base)
  const rightBase = normalizeJointChainPart(rightParsed.base)
  if (leftBase !== rightBase) return leftBase.localeCompare(rightBase, 'ru', { numeric: true })

  const maxLength = Math.max(leftParsed.segments.length, rightParsed.segments.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftSegment = leftParsed.segments[index]
    const rightSegment = rightParsed.segments[index]
    if (!leftSegment && rightSegment) return -1
    if (leftSegment && !rightSegment) return 1
    if (!leftSegment || !rightSegment) continue
    const suffixDiff = compareJointChainSuffix(leftSegment.suffix, rightSegment.suffix)
    if (suffixDiff !== 0) return suffixDiff
    if (leftSegment.index !== rightSegment.index) return leftSegment.index - rightSegment.index
  }
  return compareReportRows(left, right)
}

export function getJointChainRows(rows: WeldRow[], targetRow: WeldInput) {
  const targetIdentity = getJointChainIdentity(targetRow)
  if (!targetIdentity) return []
  return rows
    .filter((row) => {
      const identity = getJointChainIdentity(row)
      return (
        identity &&
        identity.project === targetIdentity.project &&
        identity.subtitle === targetIdentity.subtitle &&
        identity.line === targetIdentity.line &&
        identity.baseJoint === targetIdentity.baseJoint
      )
    })
    .sort(compareJointChainRows)
}
