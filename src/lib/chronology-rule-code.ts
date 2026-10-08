import type { SystemRuleCode } from './system-rule-catalog'

export function getLnkChronologyRuleCode(kind: string): SystemRuleCode {
  if (kind === 'request-date-missing' || kind === 'request-name-missing') return 'СП-11'
  if (kind === 'post-before-psto-cycle') return 'СП-06'
  if (['method-order', 'multiple-rejections', 'vik-missing-before-other', 'vik-after-other'].includes(kind)) return 'СП-05'
  return 'СП-04'
}

export function getPstoChronologyRuleCode(kind: string): SystemRuleCode {
  if (kind.endsWith('-missing')) return 'СП-11'
  if (kind === 'repeat-without-failed-tvmt') return 'СП-10'
  return 'СП-04'
}
