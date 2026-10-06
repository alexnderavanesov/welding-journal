import type { WeldInput } from './weld-fields'
import type { LnkChronologyIssue } from './lnk-chronology-checks'
import { LNK_METHODS } from './lnk-report-config'
import { normalizeResultStatus } from './weld-status'
import { parseDateLikeToIso, formatDisplayDate } from './date-format'
import { getPreHeatTreatmentControls } from './lnk-control-stage'
import { isPreHeatTreatmentStageEnabled } from './pre-heat-treatment-policy'
import { isControlEnabledValue } from './control-availability-values'

const rejected = (value: unknown) => ['ремонт', 'вырез'].includes(normalizeResultStatus(value) ?? '')
const completed = (value: unknown) => normalizeResultStatus(value) === 'годен' || rejected(value)

type OwnLnkStage = 'primary' | 'beforeHeatTreatment'
const level = (method: string) => method === 'ВИК' ? 0 : method === 'ПВК' ? 1 : 2

/** Availability only: the actual dates and result are checked on the final record. */
export function getSystemLnkPrerequisiteBlockReason(row: WeldInput, method: string, stage: OwnLnkStage = 'primary') {
  const controls = new Map(getPreHeatTreatmentControls(row).map(control => [control.method, control.result]))
  const result = (code: string) => stage === 'beforeHeatTreatment'
    ? controls.get(code)
    : row[LNK_METHODS.find(item => item.code === code)!.resultKey]
  const prerequisites = level(method) === 0 ? [] : ['ВИК',
    ...(level(method) === 2 && (isControlEnabledValue(row.hasPvk) || rejected(result('ПВК'))) ? ['ПВК'] : [])]
  const missing = prerequisites.find(code => normalizeResultStatus(result(code)) !== 'годен')
  return missing ? `Сначала внесите годный результат ${missing}${stage === 'beforeHeatTreatment' ? ' до ТО' : ''}.` : ''
}

/** A "no further need" label does not forbid entering an earlier factual result
 * against an existing request. It must not create a new control obligation. */
export function canBackfillOwnLnkResult(row: WeldInput, method: string, stage: OwnLnkStage = 'primary') {
  const controls = getPreHeatTreatmentControls(row)
  return !getSystemLnkPrerequisiteBlockReason(row, method, stage) &&
    LNK_METHODS.some(item => item.code !== method && level(item.code) >= level(method) &&
      rejected(stage === 'primary' ? row[item.resultKey] : controls.find(control => control.method === item.code)?.result))
}

export function getHistoricalLnkRequestDateReason(row: WeldInput, method: string, requestDate: unknown, stage: OwnLnkStage = 'primary') {
  const controls = getPreHeatTreatmentControls(row)
  const failures = LNK_METHODS.flatMap(item => {
    const stored = controls.find(control => control.method === item.code)
    const result = stage === 'primary' ? row[item.resultKey] : stored?.result
    return rejected(result) ? [{ code: item.code, date: parseDateLikeToIso(stage === 'primary' ? row[item.conclusionDateKey] : stored?.conclusionDate) }] : []
  })
  if (!failures.length) return ''
  const currentMethod = LNK_METHODS.find(item => item.code === method)!
  const currentResult = stage === 'primary' ? row[currentMethod.resultKey] : controls.find(control => control.method === method)?.result
  if (!completed(currentResult) && !canBackfillOwnLnkResult(row, method, stage)) return 'После негодного предшествующего метода дальнейший контроль оформляется на ремонтном стыке.'
  const date = parseDateLikeToIso(requestDate), weld = parseDateLikeToIso(row.weldDate)
  if (!date || !weld) return 'Для исторической заявки укажите корректные даты сварки и заявки.'
  if (date < weld) return 'Дата исторической заявки не может быть раньше даты сварки.'
  const conclusion = parseDateLikeToIso(stage === 'primary' ? row[currentMethod.conclusionDateKey] : controls.find(control => control.method === method)?.conclusionDate)
  if (completed(currentResult) && conclusion && date > conclusion) return 'Дата исторической заявки не может быть позже даты заключения.'
  if (failures.some(failure => failure.date && date > failure.date)) return 'Дата исторической заявки не может быть позже негодного контроля: заключение должно быть не раньше заявки и не позже брака.'
  return ''
}

export function getNewHistoricalLnkRequestIssues(rows: WeldInput[], previousRows: WeldInput[]): LnkChronologyIssue[] {
  const previousById = new Map(previousRows.map(row => [row.id, row]))
  return rows.flatMap(row => {
    const previous = previousById.get(row.id)
    if (!previous) return []
    return LNK_METHODS.flatMap(method => {
      if (!String(row[method.requestKey] ?? '').trim() ||
        (String(previous[method.requestKey] ?? '').trim() && row[method.requestDateKey] === previous[method.requestDateKey])) return []
      const message = getHistoricalLnkRequestDateReason(previous, method.code, row[method.requestDateKey])
      return message ? [{ kind: 'method-order' as const, methodCode: method.code, controlStage: 'primary' as const,
        documentPart: 'request' as const, reason: 'проверить последовательность НК', row, message: `Стык ${row.joint ?? row.id}: ${message}` }] : []
    })
  })
}

export function getNewHistoricalLnkResultIssues(rows: WeldInput[], previousRows: WeldInput[]): LnkChronologyIssue[] {
  const previousById = new Map(previousRows.map(row => [row.id, row]))
  return rows.flatMap(row => {
    const previous = previousById.get(row.id)
    if (!previous) return []
    const stages: OwnLnkStage[] = ['primary', ...(isPreHeatTreatmentStageEnabled(row) ? ['beforeHeatTreatment' as const] : [])]
    return stages.flatMap(stage => {
      const values = (value: WeldInput, code: string) => {
        const method = LNK_METHODS.find(item => item.code === code)!
        const control = getPreHeatTreatmentControls(value).find(item => item.method === code)
        return stage === 'primary'
          ? { result: value[method.resultKey], date: value[method.conclusionDateKey], requestDate: value[method.requestDateKey] }
          : { result: control?.result, date: control?.conclusionDate, requestDate: control?.requestDate }
      }
      return LNK_METHODS.flatMap(method => {
        const before = values(previous, method.code), after = values(row, method.code)
        if (!completed(after.result) || (before.result === after.result && before.date === after.date) ||
          !LNK_METHODS.some(other => other.code !== method.code && rejected(values(previous, other.code).result))) return []
        const weld = parseDateLikeToIso(row.weldDate), request = parseDateLikeToIso(after.requestDate), conclusion = parseDateLikeToIso(after.date)
        if (weld && request && conclusion && weld <= request && request <= conclusion) return []
        return [{ kind: 'method-order' as const, methodCode: method.code, controlStage: stage,
          documentPart: 'result' as const, reason: 'проверить последовательность НК', row,
          message: `Стык ${row.joint ?? row.id}: для довнесения ${method.code}${stage === 'beforeHeatTreatment' ? ' до ТО' : ''} соблюдайте даты: сварка ≤ заявка ≤ заключение.` }]
      })
    })
  })
}

/** Assigning PVK after an existing RK/UZK is allowed for later factual backfill.
 * This exception changes no result and never permits a new downstream result. */
export function isDeferredPvkAssignmentIssue(issue: LnkChronologyIssue, previous?: WeldInput) {
  if (issue.kind !== 'method-order' || issue.missingPrerequisite !== 'ПВК' || !previous ||
    isControlEnabledValue(previous.hasPvk) || !isControlEnabledValue(issue.row.hasPvk)) return false
  const code = issue.methodCode.replace(/ до ТО$/, '')
  const method = LNK_METHODS.find(candidate => candidate.code === code)
  if (!method || !['РК', 'УЗК'].includes(code)) return false
  if (issue.controlStage === 'beforeHeatTreatment') {
    const before = getPreHeatTreatmentControls(previous).find(control => control.method === code)
    const after = getPreHeatTreatmentControls(issue.row).find(control => control.method === code)
    const pvk = getPreHeatTreatmentControls(issue.row).find(control => control.method === 'ПВК')
    return completed(before?.result) && !completed(pvk?.result) &&
      before?.result === after?.result && before?.conclusionDate === after?.conclusionDate && before?.conclusionName === after?.conclusionName
  }
  return issue.controlStage === 'primary' && completed(previous[method.resultKey]) && !completed(issue.row.pvkResult) &&
    [method.resultKey, method.conclusionDateKey, method.conclusionKey].every(key => previous[key] === issue.row[key])
}

/** Mandatory method-level rules, independent of optional inter-stage checks. Dates are
 * facts, not input order. Earlier peer results can therefore be backfilled after rejection.
 */
export function getSystemLnkOrderIssues(row: WeldInput & { id?: number }): LnkChronologyIssue[] {
  const issues: LnkChronologyIssue[] = []
  const label = String(row.joint ?? '').trim() || `ID ${row.id ?? '-'}`
  const stages = ['primary', ...(isPreHeatTreatmentStageEnabled(row) ? ['beforeHeatTreatment' as const] : [])] as const
  const failures: { method: string; stage: 'primary' | 'beforeHeatTreatment'; id?: number }[] = []
  for (const stage of stages) {
    const before = new Map(getPreHeatTreatmentControls(row).map(control => [control.method, control]))
    const controls = LNK_METHODS.map(method => {
      const stored = before.get(method.code)
      return { code: method.code, level: method.code === 'ВИК' ? 0 : method.code === 'ПВК' ? 1 : 2,
        result: stage === 'primary' ? row[method.resultKey] : stored?.result,
        date: parseDateLikeToIso(stage === 'primary' ? row[method.conclusionDateKey] : stored?.conclusionDate),
        id: stage === 'primary' ? undefined : stored?.id }
    })
    const vik = controls.find(control => control.code === 'ВИК')!
    const pvk = controls.find(control => control.code === 'ПВК')!
    const suffix = stage === 'beforeHeatTreatment' ? ' до ТО' : ''
    const add = (control: typeof vik, message: string, missingPrerequisite?: 'ВИК' | 'ПВК') => issues.push({
      kind: 'method-order', methodCode: `${control.code}${suffix}`, controlStage: stage,
      documentPart: 'result', relationId: control.id, reason: 'проверить последовательность НК', row,
      message: `Стык ${label}: ${message}`,
      ...(missingPrerequisite ? { missingPrerequisite } : {}),
    })
    for (const control of controls) {
      if (rejected(control.result)) failures.push({ method: control.code, stage, id: control.id })
      if (!completed(control.result)) continue
      const prerequisites = control.level === 0 ? [] : [vik,
        ...(control.level === 2 && (isControlEnabledValue(row.hasPvk) || rejected(pvk.result)) ? [pvk] : [])]
      for (const prerequisite of prerequisites) {
        if (normalizeResultStatus(prerequisite.result) !== 'годен') {
          add(control, `Перед ${control.code}${suffix} требуется годный ${prerequisite.code}${suffix}. Внесите фактический результат предшествующего метода.`, prerequisite.code as 'ВИК' | 'ПВК')
        } else if (prerequisite.date && control.date && prerequisite.date > control.date) {
          add(control, `${prerequisite.code}${suffix} от ${formatDisplayDate(prerequisite.date)} позже ${control.code}${suffix} от ${formatDisplayDate(control.date)}. Проверьте фактические даты заключений.`)
        }
      }
      for (const failure of controls) {
        if (failure.code === control.code || !rejected(failure.result) || failure.level !== control.level) continue
        if (control.date && failure.date && control.date > failure.date) {
          add(control, `${control.code}${suffix} от ${formatDisplayDate(control.date)} выполнен после негодного ${failure.code}${suffix} от ${formatDisplayDate(failure.date)}. Продолжение контроля оформляется на ремонтном стыке.`)
        }
      }
    }
  }
  if (failures.length > 1) {
    const failure = failures[1]
    issues.push({ kind: 'multiple-rejections', methodCode: failure.method, controlStage: failure.stage,
      documentPart: 'result', relationId: failure.id, reason: 'проверить последовательность НК', row,
      message: `Стык ${label}: у одной записи допускается только один негодный результат нашего ВИК/ПВК/РК/УЗК. Найдены: ${failures.map(item => `${item.method}${item.stage === 'beforeHeatTreatment' ? ' до ТО' : ''}`).join(', ')}.` })
  }
  return issues
}
