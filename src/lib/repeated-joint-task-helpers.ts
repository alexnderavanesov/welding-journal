import { type WeldInput } from '@/lib/weld-fields'
import {
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
} from '@/lib/report-config'
import { normalizeSearchText } from '@/lib/report-row-utils'
import { hasText } from '@/lib/report-value-utils'
import {
  findLastIndex,
  formatRepeatedJointName,
  normalizeJointChainPart,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { isUnofficialJoint } from '@/lib/joint-display'
import { isLnkRepairForbiddenByOfficialRepairLimit } from '@/lib/lnk-result-rules'
import { compareJointChainRows, getRepeatedJointIdentity } from '@/lib/repeated-joint-row-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getRejectedDuplicateControls } from '@/lib/duplicate-control-utils'

export function isUnusedRepeatedJointDraft(row: WeldInput) {
  if (hasText(row.weldDate)) return false
  return ![...lnkRequestFieldKeys, ...lnkGeneratedFieldKeys, 'pstoRequest', 'pstoRequestDate', 'pstoDate', 'pstoResult', 'heatTreatmentDiagram'].some((fieldKey) =>
    hasText(row[fieldKey]),
  )
}

export function getPrimaryRejectedLnkResult(row: WeldInput) {
  const cut = LNK_METHODS.find((method) => String(row[method.resultKey] ?? '').trim().toLowerCase() === 'вырез')
  if (cut) return { method: cut, result: 'вырез' as const }
  const repair = LNK_METHODS.find((method) => String(row[method.resultKey] ?? '').trim().toLowerCase() === 'ремонт')
  if (repair) return { method: repair, result: 'ремонт' as const }
  const duplicateCut = getRejectedDuplicateControls(row).find((control) => control.result === 'вырез')
  if (duplicateCut) {
    return {
      method: { code: `${duplicateCut.method} (дубль)`, resultKey: `duplicate:${duplicateCut.id}`, enabledKey: '', requestKey: '' },
      result: 'вырез' as const,
    }
  }
  const duplicateRepair = getRejectedDuplicateControls(row).find((control) => control.result === 'ремонт')
  if (duplicateRepair) {
    return {
      method: { code: `${duplicateRepair.method} (дубль)`, resultKey: `duplicate:${duplicateRepair.id}`, enabledKey: '', requestKey: '' },
      result: 'ремонт' as const,
    }
  }
  return null
}

export function getExpectedRepeatedJointName(sourceRow: WeldInput, sourceJoint: string, result: 'ремонт' | 'вырез') {
  if (isUnofficialJoint(sourceRow)) return sourceJoint.trim()
  const suffix = getExpectedRepeatedJointSuffix(sourceRow, result)
  return getNextRepeatedJointName(sourceJoint, suffix)
}

export function getExpectedRepeatedJointSuffix(sourceRow: WeldInput, result: 'ремонт' | 'вырез'): 'R' | 'W' {
  return result === 'ремонт' && !isLnkRepairForbiddenByOfficialRepairLimit(sourceRow) ? 'R' : 'W'
}

export function getOfficialRejectedJointChainRows(rows: WeldRow[], sourceRow: WeldInput, sourceJoint: string) {
  const parsedSource = parseRepeatedJointName(sourceJoint)
  const sourceIdentity = getRepeatedJointIdentity(sourceRow, parsedSource.base)
  if (!sourceIdentity) return []
  return rows
    .filter((row) => {
      if (isUnofficialJoint(row) || !getPrimaryRejectedLnkResult(row)) return false
      const rowJoint = String(row.joint ?? '').trim()
      if (!rowJoint) return false
      const rowIdentity = getRepeatedJointIdentity(row, parseRepeatedJointName(rowJoint).base)
      if (!rowIdentity) return false
      return (
        rowIdentity.project === sourceIdentity.project &&
        rowIdentity.subtitle === sourceIdentity.subtitle &&
        rowIdentity.line === sourceIdentity.line &&
        rowIdentity.joint === sourceIdentity.joint
      )
    })
    .sort(compareJointChainRows)
}

export function getRepeatedJointSourceCandidates(parsed: ReturnType<typeof parseRepeatedJointName>) {
  return parsed.segments.flatMap((segment, index) => {
    if (segment.index <= 0) return []
    const segments = parsed.segments.map((current) => ({ ...current }))
    if (segment.index > 1) {
      segments[index] = { ...segment, index: segment.index - 1 }
    } else {
      segments.splice(index, 1)
    }
    return [{ sourceJoint: formatRepeatedJointName(parsed.base, segments), suffix: segment.suffix }]
  })
}

export function hasRepeatedJointTarget(rows: WeldRow[], sourceRow: WeldInput, targetJoint: string) {
  return Boolean(findRepeatedJointRow(rows, sourceRow, targetJoint))
}

export function findMatchingJointRows(rows: WeldRow[], sourceRow: WeldInput, joint: string) {
  const normalizedJoint = normalizeSearchText(joint)
  return rows.filter((row) => {
    if (normalizeSearchText(row.joint) !== normalizedJoint) return false
    return (
      normalizeSearchText(row.projectTitle) === normalizeSearchText(sourceRow.projectTitle) &&
      normalizeSearchText(row.subtitleCode) === normalizeSearchText(sourceRow.subtitleCode) &&
      normalizeSearchText(row.line) === normalizeSearchText(sourceRow.line)
    )
  })
}

function getNextRepeatedJointName(sourceJoint: string, suffix: 'R' | 'W') {
  const parsed = parseRepeatedJointName(sourceJoint)
  const segments = parsed.segments.map((segment) => ({ ...segment }))
  const segmentIndex = findLastIndex(segments, (segment) => segment.suffix === suffix)
  if (segmentIndex >= 0) {
    segments[segmentIndex] = { ...segments[segmentIndex], index: segments[segmentIndex].index + 1 }
  } else {
    segments.push({ suffix, index: 1 })
  }
  return formatRepeatedJointName(parsed.base, segments)
}

function findRepeatedJointRow(rows: WeldRow[], sourceRow: WeldInput, joint: string) {
  const sourceIdentity = getRepeatedJointIdentity(sourceRow, joint)
  if (!sourceIdentity) return null
  const sourceId = typeof (sourceRow as { id?: unknown }).id === 'number' ? (sourceRow as { id: number }).id : null
  const sourceJointIdentity = getRepeatedJointIdentity(sourceRow)
  const needsOfficialSameNameTarget =
    isUnofficialJoint(sourceRow) && sourceJointIdentity !== null && sourceJointIdentity.joint === sourceIdentity.joint
  return (
    rows.find((row) => {
      if (sourceId !== null && row.id === sourceId) return false
      if (needsOfficialSameNameTarget && isUnofficialJoint(row)) return false
      const rowIdentity = getRepeatedJointIdentity(row)
      return (
        rowIdentity &&
        rowIdentity.project === sourceIdentity.project &&
        rowIdentity.subtitle === sourceIdentity.subtitle &&
        rowIdentity.line === sourceIdentity.line &&
        rowIdentity.joint === sourceIdentity.joint
      )
    }) ?? null
  )
}
