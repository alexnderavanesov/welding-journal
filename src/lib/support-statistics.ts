import type { WelderStampRecord } from './welder-stamp-types'
import { buildWelderIdentityLookup } from './welder-statistics-summary'
import type { WeldRow } from './dispatcher-types'
import { isTConnectionType } from './connection-type'
import { isActiveOfficialWeld } from './control-assignment-eligibility'
import { getActualLineRows } from './line-summary'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildFinalStatusRowsContext, calculateFinalStatusInRows, normalizeFinalStatus } from './weld-status'
import { parseDateLikeToIso } from './date-format'
import type { SystemIndexSettings } from './system-index-settings'
import type { PrintableReport } from './printable-report'
import { normalizeSupportWeldLength, isPositiveSupportWeldLength } from './support-length-value'

export type SupportStatisticsValue = {
  physical: number; produced: number; rejected: number; repairs: number
  lengthMm: string | null; repairLengthMm: string | null
  missingLength: number; repairMissingLength: number
  rowIds: { physical: number[]; produced: number[]; rejected: number[]; repairs: number[] }
}
export type SupportStatisticsMonth = SupportStatisticsValue & { month: string }
export type SupportWelderStatisticsRow = {
  stamp: string; welderName: string; total: number; good: number; waitingRequest: number
  waitingControl: number; rejected: number; defectPercent: number
}
export type SupportStatisticsSummary = SupportStatisticsValue & { months: SupportStatisticsMonth[]; welders?: SupportWelderStatisticsRow[] }
export const emptySupportStatistics = (): SupportStatisticsSummary => ({ physical: 0, produced: 0, rejected: 0, repairs: 0,
  lengthMm: '0', repairLengthMm: '0', missingLength: 0, repairMissingLength: 0,
  rowIds: { physical: [], produced: [], rejected: [], repairs: [] }, months: [] })

/** Decimal accumulation, without rounding each repair or inventing a zero for missing L. */
function lengthAccumulator() {
  let total = 0n, scale = 0, known = 0, missing = 0
  return {
    add(value: unknown) {
      const raw = normalizeSupportWeldLength(value)
      const match = /^(\d+)(?:\.(\d+))?$/.exec(raw ?? '')
      if (!match || !isPositiveSupportWeldLength(raw)) { missing++; return }
      let digits = BigInt(match[1] + (match[2] ?? ''))
      const fraction = match[2]?.length ?? 0
      const nextScale = Math.max(0, fraction)
      if (fraction < 0) digits *= 10n ** BigInt(-fraction)
      if (nextScale > scale) { total *= 10n ** BigInt(nextScale - scale); scale = nextScale }
      total += digits * 10n ** BigInt(scale - nextScale); known++
    },
    result() {
      if (!known && missing) return { value: null, missing }
      const digits = total.toString().padStart(scale + 1, '0')
      const value = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits
      return { value, missing }
    },
  }
}
export function buildSupportStatistics(input: readonly WeldRow[], from: string, to: string, settings?: SystemIndexSettings, welderStamps: WelderStampRecord[] = []): SupportStatisticsSummary {
  const supportRows = input.filter(row => isTConnectionType(row.connectionType))
  const states = captureProgramChainStates(supportRows, settings)
  const rows = supportRows.map(row => ({ ...row, programChainState: states.get(row.id) }))
  const context = buildFinalStatusRowsContext(rows)
  // Resolve the entire chain before restricting the period. Historical repairs do not add volume.
  const representatives = getActualLineRows(rows, settings)
  const bucket = () => ({ value: emptySupportStatistics(), mainLength: lengthAccumulator(), repairLength: lengthAccumulator() })
  const all = bucket(), months = new Map<string, ReturnType<typeof bucket>>()
  const targets = (date: string) => {
    const key = date.slice(0, 7), month = months.get(key) ?? bucket()
    months.set(key, month); return [all, month]
  }
  const dateInPeriod = (row: WeldRow) => {
    const date = parseDateLikeToIso(row.weldDate)
    return date && (!from || date >= from) && (!to || date <= to) ? date : null
  }
  for (const row of representatives) {
    const date = dateInPeriod(row)
    if (!date) continue
    const rejected = normalizeFinalStatus(calculateFinalStatusInRows(row, rows, context)) === 'не годен'
    for (const item of targets(date)) {
      item.value.physical++; item.value.rowIds.physical.push(row.id)
      if (rejected) { item.value.rejected++; item.value.rowIds.rejected.push(row.id) }
      else { item.value.produced++; item.value.rowIds.produced.push(row.id); item.mainLength.add(row.weldLength) }
    }
  }
  for (const row of rows) {
    if (!isActiveOfficialWeld(row) || row.programChainState?.kind !== 'repair') continue
    const date = dateInPeriod(row)
    if (!date) continue
    for (const item of targets(date)) { item.value.repairs++; item.value.rowIds.repairs.push(row.id); item.repairLength.add(row.weldLength) }
  }
  const finish = (item: ReturnType<typeof bucket>) => {
    const main = item.mainLength.result(), repair = item.repairLength.result()
    const { months: _months, ...value } = item.value
    return { ...value, lengthMm: main.value, missingLength: main.missing, repairLengthMm: repair.value, repairMissingLength: repair.missing }
  }
  return { ...finish(all), welders: buildSupportWelderStatistics(rows, from, to, welderStamps, context), months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, item]) => ({ month, ...finish(item) })) }
}
function buildSupportWelderStatistics(rows: WeldRow[], from: string, to: string, stamps: WelderStampRecord[], context: ReturnType<typeof buildFinalStatusRowsContext>) {
  const identity = buildWelderIdentityLookup(stamps), stats = new Map<string, SupportWelderStatisticsRow>()
  for (const row of rows) {
    const date = parseDateLikeToIso(row.weldDate)
    const rawStamp = [row.stamp1KFact, row.stamp1ZFact, row.stamp1OFact]
      .map(value => String(value ?? '').trim()).find(Boolean)
    if (!date || from && date < from || to && date > to || !rawStamp) continue
    const owner = identity(rawStamp), key = owner.stamp.toLocaleUpperCase('ru')
    const item = stats.get(key) ?? { ...owner, total: 0, good: 0, waitingRequest: 0, waitingControl: 0, rejected: 0, defectPercent: 0 }
    // T has one factual welder. Legacy layer/second-welder fields cannot multiply
    // or fractionally reduce that welder's work; each welded record counts once.
    item.total++
    const status = normalizeFinalStatus(calculateFinalStatusInRows(row, rows, context))
    if (status === 'годен') item.good++
    if (status === 'не годен') item.rejected++
    if ((status === 'ожидает заявку' || status === 'ожидает заявку до ТО')) item.waitingRequest++
    if (['ожидает нк', 'ожидает нк до то'].includes(status?.toLocaleLowerCase('ru') ?? '')) item.waitingControl++
    stats.set(key, item)
  }
  return [...stats.values()].map(item => ({ ...item, defectPercent: item.good + item.rejected ? item.rejected / (item.good + item.rejected) * 100 : 0 }))
    .sort((a, b) => a.defectPercent - b.defectPercent || b.total - a.total || a.stamp.localeCompare(b.stamp, 'ru', { numeric: true }))
}
export const SUPPORT_WELDER_STATISTICS_NOTE = 'По фактическому клейму заполненных слоёв: все сваренные записи Т за выбранный период, включая ремонты и неофициальные записи. Пустой корень не исключает сварку, если клеймо указано в заполнении или облицовке. Одна сварка — одна единица. Процент брака — среди записей с итогом «годен» или «не годен»; ожидание в знаменатель не входит. Записи без фактического клейма в таблицу сварщиков не включаются.'

export function formatSupportLength(value: string | null, missing = 0, display?: { unit: 'mm' | 'm'; decimals: number }) {
  if (value === null) return 'Не указана'
  if (display) {
    // Round the final decimal sum for display only; never lose NUMERIC precision
    // by converting a long mantissa to Number or rounding individual welds.
    const [whole, fraction = ''] = value.split('.')
    const shift = fraction.length + (display.unit === 'm' ? 3 : 0) - display.decimals
    const digits = BigInt(whole + fraction)
    const divisor = 10n ** BigInt(Math.max(0, shift))
    const rounded = shift > 0 ? (digits + divisor / 2n) / divisor : digits * 10n ** BigInt(-shift)
    const text = rounded.toString().padStart(display.decimals + 1, '0')
    value = display.decimals ? `${text.slice(0, -display.decimals)}.${text.slice(-display.decimals)}` : text
  }
  const [integer, fraction] = value.split('.')
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (fraction ? ',' + fraction : '')
  return missing ? `${formatted} (неполная)` : formatted
}
export const SUPPORT_STATISTICS_NOTE = 'Основной объём — сваренные физические ОП без текущей негодности, включая ожидающие контроль. Период определяется датой последнего актуального продолжения. Ремонты учитываются отдельно по собственным датам сварки и полной L каждого ремонта. Пустая L не исключает опору из количества; сумма длины при этом неполна.'
export function buildSupportStatisticsReport(summary: SupportStatisticsSummary, period: string, scope: string): PrintableReport {
  const values = (value: SupportStatisticsValue) => [value.physical, value.produced, value.rejected, formatSupportLength(value.lengthMm, value.missingLength), value.missingLength, value.repairs, formatSupportLength(value.repairLengthMm, value.repairMissingLength), value.repairMissingLength]
  return { title: 'Статистика опор', subtitle: SUPPORT_STATISTICS_NOTE,
    meta: [{ label: 'Период', value: period }, { label: 'Срез', value: scope }, { label: 'Единицы', value: 'Опоры и ремонтные записи, шт.; длина, мм' }],
    tables: [{ title: 'Объём по месяцам', columns: ['Месяц', 'Физические ОП, шт.', 'Основной объём, шт.', 'Текущие негодные, шт.', 'Длина основного объёма, мм', 'Основной объём без L, шт.', 'Ремонты, шт.', 'Длина ремонтов, мм', 'Ремонты без L, шт.'],
      rows: [['Итого', ...values(summary)], ...summary.months.map(month => [month.month, ...values(month)])],
      rowKinds: ['total', ...summary.months.map(() => 'detail' as const)], numericColumns: [1, 2, 3, 5, 6, 8] }, ...(summary.welders?.length ? [{ title: 'Сварщики — опоры',
      columns: ['Клеймо', 'Сварщик', 'Всего', 'Годен', 'Ожидает заявку', 'Ожидает НК', 'Не годен', '% брака'],
      rows: summary.welders.map(row => [row.stamp, row.welderName, row.total, row.good, row.waitingRequest, row.waitingControl, row.rejected, row.defectPercent]),
      numericColumns: [2, 3, 4, 5, 6, 7],
    }] : [])] }
}
