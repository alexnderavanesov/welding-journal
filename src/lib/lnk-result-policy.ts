import { getRepeatedJointRepairCount, parseRepeatedJointName } from './joint-chain'
import { formatJointDiameterLabel, getMinimumJointDiameter, isUnofficialJoint } from './joint-display'
import { LNK_METHODS } from './lnk-report-config'
import { normalizeControlResultText } from './report-value-utils'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'
import type { WeldFieldKey, WeldInput } from './weld-field-definitions'

export const LNK_RESULT_SYSTEM_RULE_CODE = 'СП-07' as const

export type LnkResultRestrictionOptions = {
  systemIndexSettings?: SystemIndexSettings
  /** The optional good-only setting applies to our results, never customer duplicates. */
  scope?: 'own' | 'duplicate'
  pvkGoodOnly?: boolean
  layeredControlSelected?: boolean
  includeAdditionalRestrictions?: boolean
}

export function isOfficialLnkRepairLimitReached(
  row: WeldInput,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  // Officiality and R/W/Y counters keep their established meaning.
  return !isUnofficialJoint(row) &&
    getRepeatedJointRepairCount(parseRepeatedJointName(String(row.joint ?? '').trim(), settings)) >= 2
}

/** The same mandatory result matrix for forms, imports, server writes and diagnostics.
 * No save-check toggle can relax it. Additional process restrictions only narrow it. */
export function getLnkResultRestrictionReasons(
  row: WeldInput,
  methodCode: string,
  result: unknown,
  options: LnkResultRestrictionOptions = {},
): string[] {
  const method = String(methodCode).trim().toLocaleUpperCase('ru-RU').split(/\s/)[0]
  const value = normalizeControlResultText(result)
  if (!LNK_METHODS.some(item => item.code === method) || !['ремонт', 'вырез'].includes(value)) return []
  const reasons: string[] = []
  if (value === 'вырез' && (method === 'ВИК' || method === 'ПВК')) {
    reasons.push(`По ${method} результат «вырез» не допускается.`)
  }
  if (value === 'ремонт') {
    if (method === 'РК' || method === 'УЗК') {
      const diameter = getMinimumJointDiameter(row)
      if (diameter !== null && diameter < 89) {
        reasons.push(`Ремонт по ${method} недоступен при диаметре меньше 89 мм. Минимальный диаметр стыка: ${formatJointDiameterLabel(row)} мм.`)
      }
    }
    if (isOfficialLnkRepairLimitReached(row, options.systemIndexSettings)) {
      reasons.push(`Уже выполнено два ремонта. Третий ремонт не допускается.${method === 'ВИК' || method === 'ПВК' ? ` По ${method} доступен только результат «годен».` : ''}`)
    }
  }
  if (options.includeAdditionalRestrictions !== false) {
    if (row.layeredControlAssigned || options.layeredControlSelected) {
      reasons.push('При послойном контроле доступен только результат «годен».')
    }
    if (method === 'ПВК' && options.pvkGoodOnly && options.scope !== 'duplicate') {
      reasons.push('Включена настройка «ПВК — только годен».')
    }
  }
  return reasons
}

export function getLnkResultRestrictionReason(
  row: WeldInput,
  methodCode: string,
  result: unknown,
  options: LnkResultRestrictionOptions = {},
) {
  return getLnkResultRestrictionReasons(row, methodCode, result, options).join('\n') || undefined
}

export function formatLnkResultRuleReason(reason: string) {
  return reason.startsWith(`${LNK_RESULT_SYSTEM_RULE_CODE} · `) ? reason : `${LNK_RESULT_SYSTEM_RULE_CODE} · ${reason}`
}

export function assertLnkResultAllowed(
  row: WeldInput,
  methodCode: string,
  result: unknown,
  options: LnkResultRestrictionOptions = {},
) {
  const reason = getLnkResultRestrictionReason(row, methodCode, result, options)
  if (reason) throw new Error(formatLnkResultRuleReason(reason))
}

export type LnkResultRuleIssue = { message: string; fieldKeys: WeldFieldKey[] }
const preResultKeys = { 'ВИК': 'preVikResult', 'РК': 'preRkResult', 'УЗК': 'preUzkResult', 'ПВК': 'prePvkResult' } as const

export function assertNoLnkResultRuleIssues(
  rows: readonly WeldInput[],
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  const message = rows.flatMap(row => getLnkResultRuleIssues(row, settings)).map(issue => issue.message).join('\n')
  if (message) throw new Error(message)
}

/** Inspect facts without rewriting them, including stored disabled-stage history.
 * A dormant stage is not a way to make an impossible result valid. */
export function getLnkResultRuleIssues(
  row: WeldInput,
  systemIndexSettings: SystemIndexSettings = loadSystemIndexSettings(),
): LnkResultRuleIssue[] {
  const issues: LnkResultRuleIssue[] = []
  const add = (method: string, label: string, result: unknown, resultKey: WeldFieldKey) => {
    const reasons = getLnkResultRestrictionReasons(row, method, result, {
      systemIndexSettings, includeAdditionalRestrictions: false,
    })
    if (!reasons.length) return
    const fieldKeys: WeldFieldKey[] = [resultKey]
    if (reasons.some(reason => reason.includes('диаметре'))) fieldKeys.push('d1', 'd2')
    if (reasons.some(reason => reason.includes('два ремонта'))) fieldKeys.push('joint')
    issues.push({ message: formatLnkResultRuleReason(`${label}: ${reasons.join(' ')}`), fieldKeys })
  }
  const relations = row as WeldInput & {
    preHeatTreatmentControls?: { method: string; result?: unknown }[]
    duplicateControls?: { method: string; result?: unknown }[]
  }
  for (const method of LNK_METHODS) {
    add(method.code, method.code, row[method.resultKey], method.resultKey)
    const before = (relations.preHeatTreatmentControls ?? []).filter(control => control.method === method.code)
    if (before.length) {
      for (const control of before) add(method.code, `${method.code} до ТО`, control.result, preResultKeys[method.code])
    } else {
      add(method.code, `${method.code} до ТО`, row[preResultKeys[method.code]], preResultKeys[method.code])
    }
  }
  for (const control of relations.duplicateControls ?? []) {
    const method = LNK_METHODS.find(item => item.code === String(control.method).trim().toLocaleUpperCase('ru-RU'))
    if (method) add(method.code, `${method.code} (дубль)`, control.result, method.resultKey)
  }
  return issues
}
