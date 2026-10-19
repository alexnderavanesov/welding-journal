import type { WeldRow } from './dispatcher-types'
import { LNK_METHODS } from './lnk-report-config'
import { getLnkDisplayValue, getPendingWeldStatusLabel } from './lnk-status'
import { getPreHeatTreatmentControl, requiresPreHeatTreatmentLnk } from './lnk-control-stage'
import { isPreHeatTreatmentStageEnabled } from './pre-heat-treatment-policy'
import { isControlEnabledValue } from './control-availability-values'
import { normalizeControlResultText } from './report-value-utils'
import { createGroupStageSummarizer } from './weld-group-stage-summary'

const preResults = ['preVikResult', 'preRkResult', 'preUzkResult', 'prePvkResult'] as const
export type LnkGroupResultField = typeof LNK_METHODS[number]['resultKey'] | typeof preResults[number]
const fields: readonly LnkGroupResultField[] = [...LNK_METHODS.map(method => method.resultKey), ...preResults]
const waiting = ['ожидает сварку', 'ожидает ремонт', 'ожидает заявку', 'ожидает НК']

/** Only group presentation: row values, workflow permissions and dispatcher
 * calculations remain authoritative. Never borrow a predecessor's method fact.
 */
export function createLnkGroupSummarizer(rows: readonly WeldRow[]) {
  return createGroupStageSummarizer(rows, fields, row => {
    const values = {} as Record<LnkGroupResultField, string>
    const errors = {} as Record<LnkGroupResultField, boolean>
    LNK_METHODS.forEach((method, index) => {
      const before = getPreHeatTreatmentControl(row, method.code)
      for (const [field, raw, pre] of [[method.resultKey, row[method.resultKey], false], [preResults[index], before?.result, true]] as const) {
        const fact = normalizeControlResultText(raw)
        errors[field] = fact === 'ошибка'
        const displayed = String(getLnkDisplayValue(row, field) ?? '').trim()
        const normalized = normalizeControlResultText(displayed)
        const enabled = isControlEnabledValue(row[method.enabledKey])
        // The global switch suspends this stage. Its retained history remains
        // available to dedicated workflows; it must not create new stage debt.
        values[field] = errors[field] ? 'ошибка'
          : pre && !isPreHeatTreatmentStageEnabled(row) ? 'этап выключен'
            : ['ремонт', 'вырез', 'не годен', 'негоден'].includes(normalized) ? 'не годен'
              : ['годен', 'да', 'годен (отменен)'].includes(normalized)
                ? displayed.includes('отменен') ? 'годен · назначение отменено' : 'годен'
                : normalized === 'отменен' || normalized === 'нет потребности' ? displayed
                  : pre && !requiresPreHeatTreatmentLnk(row) || !enabled ? 'не требуется'
                    : !String(row.weldDate ?? '').trim() ? getPendingWeldStatusLabel(row)
                      : pre ? before?.requestName?.trim() ? 'ожидает НК' : 'ожидает заявку'
                        : displayed || 'ожидает заявку'
      }
    })
    return { ...values, errors }
  }, waiting)
}
