import {
  escapeRegExp,
  getSemanticJointChainSuffix,
  getSystemChainSegmentPattern,
  getSystemIndexExampleText,
  getSystemIndexPrefixText,
  getSystemIndexSummaryText,
  loadSystemIndexSettings,
  type JointSystemSuffix,
} from '@/lib/system-index-settings'

export type { JointSystemSuffix } from '@/lib/system-index-settings'

export type ParsedJointNameSegment = {
  suffix: JointSystemSuffix
  index: number
}

export type ParsedJointName = {
  raw: string
  base: string
  segments: ParsedJointNameSegment[]
  hasRequiredPrefix: boolean
}

export function normalizeJointName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, '')
}

export function parseJointName(value: unknown): ParsedJointName {
  const raw = normalizeJointName(value)
  const settings = loadSystemIndexSettings()
  const jointPrefixPattern = getJointPrefixPattern(settings)
  const prefixMatch = raw.match(jointPrefixPattern)
  if (!prefixMatch) {
    return { raw, base: raw, segments: [], hasRequiredPrefix: false }
  }

  const prefix = prefixMatch[1].toUpperCase()
  const tail = raw.slice(prefixMatch[1].length)
  const segmentPattern = getSystemChainSegmentPattern(settings)
  const firstSystemSegment = tail.search(new RegExp(`${segmentPattern}\\d+`, 'i'))
  const baseExtra = firstSystemSegment === -1 ? tail : tail.slice(0, firstSystemSegment)
  const systemTail = firstSystemSegment === -1 ? '' : tail.slice(firstSystemSegment)
  const systemSegmentPattern = new RegExp(`(${segmentPattern})(\\d+)`, 'gi')
  const segments = [...systemTail.matchAll(systemSegmentPattern)]
    .map((match) => {
      const suffix = getSemanticJointChainSuffix(match[1], settings)
      return suffix ? { suffix, index: Number(match[2]) || 0 } : null
    })
    .filter((segment): segment is ParsedJointNameSegment => Boolean(segment))

  return {
    raw,
    base: `${prefix}${baseExtra}`,
    segments,
    hasRequiredPrefix: true,
  }
}

export function validateManualJointName(value: unknown) {
  const normalized = normalizeJointName(value)
  const settings = loadSystemIndexSettings()
  if (!normalized) return `Укажите номер стыка. Он должен начинаться с ${getSystemIndexPrefixText(settings)} и порядкового номера.`

  const prefixMatch = normalized.match(getJointPrefixPattern(settings))
  if (!prefixMatch) {
    return `Стык должен начинаться с ${getSystemIndexPrefixText(settings)} и порядкового номера, например ${getSystemIndexExampleText(settings)}.`
  }

  const manualTail = normalized.slice(prefixMatch[1].length)
  if (new RegExp(getSystemChainSegmentPattern(settings), 'i').test(manualTail)) {
    return `Буквы ${getSystemIndexSummaryText(settings)} зарезервированы системой для повторных стыков и катушек. Введите базовое имя без этих индексов.`
  }

  return null
}

export function hasReservedJointSystemPart(value: unknown) {
  const normalized = normalizeJointName(value)
  const settings = loadSystemIndexSettings()
  const prefixMatch = normalized.match(getJointPrefixPattern(settings))
  if (!prefixMatch) return false
  return new RegExp(getSystemChainSegmentPattern(settings), 'i').test(normalized.slice(prefixMatch[1].length))
}

function getJointPrefixPattern(settings = loadSystemIndexSettings()) {
  return new RegExp(`^([${escapeRegExp(settings.shopJoint)}${escapeRegExp(settings.fieldJoint)}]\\d+)`, 'i')
}
