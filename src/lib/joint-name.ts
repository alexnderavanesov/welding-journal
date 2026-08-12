import {
  escapeRegExp,
  getSemanticJointChainSuffix,
  getSystemChainSegmentPattern,
  getSystemIndexExampleText,
  getSystemIndexPrefixText,
  getSystemIndexSummaryText,
  loadSystemIndexSettings,
  type JointSystemSuffix,
  type SystemIndexSettings,
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

export function parseJointName(
  value: unknown,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
): ParsedJointName {
  const raw = normalizeJointName(value)
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

export function validateJointNameStructure(
  value: unknown,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const normalized = normalizeJointName(value)
  const startRequirement = getJointNameStartRequirement(settings)
  if (!normalized) return `Укажите номер стыка. Он должен ${startRequirement}.`

  const prefixMatch = normalized.match(getJointPrefixPattern(settings))
  if (!prefixMatch) {
    return `Стык должен ${startRequirement}.`
  }

  const tail = normalized.slice(prefixMatch[1].length)
  const segmentPattern = getSystemChainSegmentPattern(settings)
  const firstSystemSegment = tail.search(new RegExp(`${segmentPattern}\\d+`, 'i'))
  if (firstSystemSegment === -1) {
    if (new RegExp(segmentPattern, 'i').test(tail)) {
      return `После букв ${getSystemIndexSummaryText(settings)} в системной части имени должен стоять номер повторения.`
    }
    return null
  }

  const baseExtra = tail.slice(0, firstSystemSegment)
  const systemTail = tail.slice(firstSystemSegment)
  if (
    new RegExp(segmentPattern, 'i').test(baseExtra) ||
    !new RegExp(`^(?:${segmentPattern}\\d+)+$`, 'i').test(systemTail)
  ) {
    return `Системная часть имени должна состоять только из последовательных индексов ${getSystemIndexSummaryText(settings)} с номерами.`
  }

  return null
}

export function validateManualJointName(
  value: unknown,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const normalized = normalizeJointName(value)
  const structureError = validateJointNameStructure(normalized, settings)
  if (structureError) return structureError

  const prefixMatch = normalized.match(getJointPrefixPattern(settings))!
  if (hasLeadingLetterIndex(normalized, settings) && !settings.allowLeadingLetterIndex) {
    return 'Буквенный индекс перед номером стыка отключен в настройках системных индексов.'
  }

  const manualTail = normalized.slice(prefixMatch[1].length)
  if (new RegExp(getSystemChainSegmentPattern(settings), 'i').test(manualTail)) {
    return `Буквы ${getSystemIndexSummaryText(settings)} зарезервированы системой для повторных стыков и катушек. Введите базовое имя без этих индексов.`
  }

  return null
}

export function hasLeadingLetterIndex(
  value: unknown,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const normalized = normalizeJointName(value)
  return new RegExp(
    `^[${escapeRegExp(settings.shopJoint)}${escapeRegExp(settings.fieldJoint)}][A-Z]\\d+`,
    'i',
  ).test(normalized)
}

export function hasReservedJointSystemPart(
  value: unknown,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const normalized = normalizeJointName(value)
  const prefixMatch = normalized.match(getJointPrefixPattern(settings))
  if (!prefixMatch) return false
  return new RegExp(getSystemChainSegmentPattern(settings), 'i').test(normalized.slice(prefixMatch[1].length))
}

function getJointPrefixPattern(settings = loadSystemIndexSettings()) {
  return new RegExp(`^([${escapeRegExp(settings.shopJoint)}${escapeRegExp(settings.fieldJoint)}](?:[A-Z])?\\d+)`, 'i')
}

function getJointNameStartRequirement(settings: SystemIndexSettings) {
  if (settings.allowLeadingLetterIndex) {
    return `начинаться с ${getSystemIndexPrefixText(settings)}; после него допускается одна латинская буква, затем номер, например ${settings.shopJoint}13 или ${settings.fieldJoint}B05`
  }

  return `начинаться с ${getSystemIndexPrefixText(settings)} и порядкового номера, например ${getSystemIndexExampleText(settings)}`
}
