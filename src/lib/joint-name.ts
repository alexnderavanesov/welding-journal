export type JointSystemSuffix = 'R' | 'W' | 'Y'

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

const jointPrefixPattern = /^([SF]\d+)/i
const systemSegmentPattern = /([RWY])(\d+)/gi

export function normalizeJointName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, '')
}

export function parseJointName(value: unknown): ParsedJointName {
  const raw = normalizeJointName(value)
  const prefixMatch = raw.match(jointPrefixPattern)
  if (!prefixMatch) {
    return { raw, base: raw, segments: [], hasRequiredPrefix: false }
  }

  const prefix = prefixMatch[1].toUpperCase()
  const tail = raw.slice(prefixMatch[1].length)
  const firstSystemSegment = tail.search(/[RWY]\d+/i)
  const baseExtra = firstSystemSegment === -1 ? tail : tail.slice(0, firstSystemSegment)
  const systemTail = firstSystemSegment === -1 ? '' : tail.slice(firstSystemSegment)
  const segments = [...systemTail.matchAll(systemSegmentPattern)].map((match) => ({
    suffix: match[1].toUpperCase() as JointSystemSuffix,
    index: Number(match[2]) || 0,
  }))

  return {
    raw,
    base: `${prefix}${baseExtra}`,
    segments,
    hasRequiredPrefix: true,
  }
}

export function validateManualJointName(value: unknown) {
  const normalized = normalizeJointName(value)
  if (!normalized) return 'Укажите номер стыка. Он должен начинаться с S или F и порядкового номера.'

  const prefixMatch = normalized.match(jointPrefixPattern)
  if (!prefixMatch) {
    return 'Стык должен начинаться с S или F и порядкового номера, например S13 или F5.'
  }

  const manualTail = normalized.slice(prefixMatch[1].length)
  if (/[RWY]/i.test(manualTail)) {
    return 'Буквы R, W и Y зарезервированы системой для повторных стыков и катушек. Введите базовое имя без этих индексов.'
  }

  return null
}

export function hasReservedJointSystemPart(value: unknown) {
  const normalized = normalizeJointName(value)
  const prefixMatch = normalized.match(jointPrefixPattern)
  if (!prefixMatch) return false
  return /[RWY]/i.test(normalized.slice(prefixMatch[1].length))
}
