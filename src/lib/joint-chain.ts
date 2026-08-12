import { parseJointName } from '@/lib/joint-name'
import {
  getConfiguredJointChainSuffix,
  getSemanticJointChainSuffix,
  loadSystemIndexSettings,
  type JointSystemSuffix,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

export type RepeatedJointSegment = {
  suffix: 'R' | 'W'
  index: number
}

export type JointChainSegment = {
  suffix: JointSystemSuffix
  index: number
}

export type ParsedRepeatedJointName = {
  base: string
  segments: RepeatedJointSegment[]
  suffix: 'R' | 'W' | null
  index: number
}

export function parseRepeatedJointName(
  joint: string,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
): ParsedRepeatedJointName {
  const parsed = parseJointName(joint, settings)
  const lastCoilIndex = findLastIndex(parsed.segments, (segment) => segment.suffix === 'Y')
  const baseSegments = lastCoilIndex === -1 ? [] : parsed.segments.slice(0, lastCoilIndex + 1)
  const repairSegments = parsed.segments
    .slice(lastCoilIndex + 1)
    .filter((segment): segment is RepeatedJointSegment => segment.suffix === 'R' || segment.suffix === 'W')
  const base = formatRepeatedJointName(parsed.base, baseSegments, settings)
  const lastSegment = repairSegments.at(-1)
  return {
    base,
    segments: repairSegments,
    suffix: lastSegment?.suffix ?? null,
    index: lastSegment?.index ?? 0,
  }
}

export function parseJointChainName(
  joint: string,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const parsed = parseJointName(joint, settings)
  return { base: parsed.base, segments: parsed.segments }
}

export function getRepeatedJointFailureCount(parsed: ParsedRepeatedJointName) {
  return parsed.segments.reduce((total, segment) => total + Math.max(0, segment.index), 0)
}

export function getRepeatedJointRepairCount(parsed: ParsedRepeatedJointName) {
  return parsed.segments.reduce((total, segment) => (segment.suffix === 'R' ? total + Math.max(0, segment.index) : total), 0)
}

export function getCoilJointNames(
  baseJoint: string,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const coilSuffix = getConfiguredJointChainSuffix('Y', settings)
  return [`${baseJoint}${coilSuffix}1`, `${baseJoint}${coilSuffix}2`]
}

export function formatRepeatedJointName(
  base: string,
  segments: JointChainSegment[],
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  return `${base}${segments.map((segment) => `${getConfiguredJointChainSuffix(segment.suffix, settings)}${segment.index}`).join('')}`
}

export function compareJointChainSuffix(
  left: string,
  right: string,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const orderDiff = getJointChainSuffixOrder(left, settings) - getJointChainSuffixOrder(right, settings)
  if (orderDiff !== 0) return orderDiff
  return left.localeCompare(right, 'ru', { numeric: true })
}

export function getJointChainSuffixOrder(
  suffix: string,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const semanticSuffix = getSemanticJointChainSuffix(suffix, settings) ?? suffix.toUpperCase()
  if (semanticSuffix === 'R') return 1
  if (semanticSuffix === 'W') return 2
  if (semanticSuffix === 'Y') return 3
  return 10
}

export function normalizeJointChainPart(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
}

export function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
}
