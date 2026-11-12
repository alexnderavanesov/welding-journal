import { isControlEnabledValue } from './control-availability-values'

type PreliminaryColumnRow = { preHeatTreatmentRequired?: unknown; pstoRequired?: unknown }
export type PreliminaryColumnValue = 'да' | '' | '—'

/** The stored mark survives a line move. SQL scalar reads already return these display values. */
export function getPreHeatTreatmentColumnValue(row: PreliminaryColumnRow): PreliminaryColumnValue {
  const mark = row.preHeatTreatmentRequired
  if (mark === true || mark === 'да') return 'да'
  if (mark === '' || mark === '—') return mark
  return isControlEnabledValue(row.pstoRequired) ? '' : '—'
}

export function getPreHeatTreatmentColumnText(row: PreliminaryColumnRow) {
  const value = getPreHeatTreatmentColumnValue(row)
  return value === 'да' ? 'Да' : value
}

export function getPreHeatTreatmentFilterLabel(value: string) {
  if (value === 'да') return 'Отметка включена (Да)'
  if (value === '') return 'Отметка выключена (пусто)'
  if (value === '—') return 'Не применяется (—)'
  return value
}

export function getPreHeatTreatmentColumnTooltip(row: PreliminaryColumnRow) {
  const value = getPreHeatTreatmentColumnValue(row)
  if (value === '—') return 'НК до ТО не применяется: ПСТО не назначено.'
  if (value === '') return 'НК до ТО не отмечен. ПСТО назначено, но отметка НК до ТО выключена.'
  return isControlEnabledValue(row.pstoRequired)
    ? 'Отметка НК до ТО включена. «Да» означает необходимость этапа, а не его выполнение.'
    : 'Отметка НК до ТО сохранена. Сейчас ПСТО не назначено, поэтому этап не требуется. Существующие документы и результаты сохраняются.'
}
