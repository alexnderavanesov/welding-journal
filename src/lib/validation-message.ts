import type { LnkChronologyIssue } from './lnk-chronology-checks'
import type { PstoChronologyIssue } from './psto-chronology-checks'

export type ValidationMessage = { message: string; publicMessage: string; fields: readonly string[] }
export type ValidationMessageFormatter = (details: ValidationMessage) => string

export function formatValidationMessage(details: ValidationMessage, format?: ValidationMessageFormatter) {
  return format ? format(details) : details.message
}

// Only the final public diagnostic is formatted. The full issue remains intact
// for comparisons with historical violations and for dispatcher calculations.
export function formatLnkChronologyMessage(issue: LnkChronologyIssue, format?: ValidationMessageFormatter) {
  if (!format) return issue.message
  const part = issue.documentPart === 'request' ? 'заявки' : issue.documentPart === 'conclusion' ? 'заключения' : 'результата'
  const reasons: Record<LnkChronologyIssue['kind'], string> = {
    'weld-after-request': `дата заявки ${issue.methodCode} раньше даты сварки`,
    'weld-after-conclusion': `дата заключения ${issue.methodCode} раньше даты сварки`,
    'pre-after-psto': `дата ${part} ${issue.methodCode} позже даты ПСТО`,
    'post-before-psto': `дата заключения ${issue.methodCode} после ТО раньше даты ПСТО`,
    'post-before-tvmt': `дата заключения ${issue.methodCode} после ТО раньше даты ТВМТ`,
    'post-before-psto-cycle': `${issue.methodCode} после ТО оформлен до завершения цикла ПСТО и ТВМТ`,
    'request-after-conclusion': `дата заключения ${issue.methodCode} раньше даты заявки`,
    'vik-after-other': 'нарушен порядок дат ВИК и остальных видов НК',
    'vik-missing-before-other': 'сначала необходимо завершить предшествующие виды НК',
    'method-order': 'нарушен порядок выполнения видов НК',
    'multiple-rejections': 'сохранены несовместимые негодные результаты НК',
    'request-date-missing': `не заполнена дата заявки ${issue.methodCode}`,
    'request-date-invalid': `некорректная дата заявки ${issue.methodCode}`,
    'request-name-missing': `не заполнено наименование заявки ${issue.methodCode}`,
    'conclusion-date-invalid': `некорректная дата заключения ${issue.methodCode}`,
  }
  const fields = ['preHeatTreatmentControls'] // All LNK facts require lnk.view.
  if (issue.kind.startsWith('weld-after-')) fields.push('weldDate')
  if (issue.kind === 'pre-after-psto' || issue.kind.startsWith('post-before-')) fields.push('pstoRepeatCycles')
  return format({ message: issue.message, fields,
    publicMessage: `Стык ${String(issue.row.joint ?? '').trim() || `ID ${issue.row.id ?? '-'}`}: ${reasons[issue.kind]}.` })
}

export function formatPstoChronologyMessage(issue: PstoChronologyIssue, format?: ValidationMessageFormatter) {
  if (!format) return issue.message
  const reasons: Record<PstoChronologyIssue['kind'], string> = {
    'weld-after-request': 'дата заявки ПСТО раньше даты сварки',
    'weld-after-result': 'дата результата ПСТО раньше даты сварки',
    'request-after-result': 'дата результата ПСТО раньше даты заявки',
    'psto-after-tvmt-request': 'дата заявки ТВМТ раньше даты ПСТО',
    'psto-after-tvmt-result': 'дата результата ТВМТ раньше даты ПСТО',
    'tvmt-request-after-result': 'дата результата ТВМТ раньше даты заявки',
    'previous-tvmt-after-repeat-request': 'дата заявки повторной ПСТО раньше предыдущей ТВМТ',
    'repeat-without-failed-tvmt': 'для повторного цикла необходим негодный результат предыдущей ТВМТ',
    'request-date-missing': 'не заполнена дата заявки ПСТО',
    'request-date-invalid': 'некорректная дата заявки ПСТО',
    'request-name-missing': 'не заполнено наименование заявки ПСТО',
    'result-date-invalid': 'некорректная дата результата ПСТО',
    'tvmt-request-date-missing': 'не заполнена дата заявки ТВМТ',
    'tvmt-request-date-invalid': 'некорректная дата заявки ТВМТ',
    'tvmt-request-name-missing': 'не заполнено наименование заявки ТВМТ',
    'tvmt-result-date-invalid': 'некорректная дата результата ТВМТ',
  }
  const fields = ['pstoRepeatCycles']
  if (issue.kind.startsWith('weld-after-')) fields.push('weldDate')
  return format({ message: issue.message, fields,
    publicMessage: `Стык ${String(issue.row.joint ?? '').trim() || `ID ${issue.row.id ?? '-'}`}: ${reasons[issue.kind]}.` })
}
