import { normalizeJointChainPart, parseJointChainName } from '@/lib/joint-chain'
import type { WeldInput } from '@/lib/weld-fields'

export function parseJointDiameterValue(value: unknown) {
  const match = String(value ?? '').trim().replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const diameter = Number(match[0])
  return Number.isFinite(diameter) ? diameter : null
}

export function getMinimumJointDiameter(row: WeldInput) {
  const diameters = [parseJointDiameterValue(row.d1), parseJointDiameterValue(row.d2)].filter(
    (value): value is number => value !== null,
  )
  return diameters.length > 0 ? Math.min(...diameters) : null
}

export function formatJointDiameterValue(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, '')
}

export function formatJointDiameterLabel(row: WeldInput) {
  const diameter = getMinimumJointDiameter(row)
  return diameter === null ? '-' : formatJointDiameterValue(diameter)
}

export function formatJointWdiLabel(row: WeldInput) {
  const value = String(row.wdi ?? '').trim()
  return value || '-'
}

export function isUnofficialJoint(row: WeldInput) {
  return String(row.status ?? '').trim().toLowerCase() === 'неофициальный'
}

export function getJointChainIdentity(row: WeldInput) {
  const joint = String(row.joint ?? '').trim()
  if (!joint) return null
  const parsed = parseJointChainName(joint)
  return {
    project: normalizeJointChainPart(row.projectTitle),
    subtitle: normalizeJointChainPart(row.subtitleCode),
    line: normalizeJointChainPart(row.line),
    baseJoint: normalizeJointChainPart(parsed.base),
  }
}

export function getJointChainSubtitle(row: WeldInput) {
  const project = String(row.projectTitle ?? '').trim() || '-'
  const subtitle = String(row.subtitleCode ?? '').trim() || '-'
  const line = String(row.line ?? '').trim() || '-'
  const base = parseJointChainName(String(row.joint ?? '')).base || '-'
  return `${project} · ${subtitle} · ${line} · базовый стык ${base}`
}
