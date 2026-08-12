import type { PrintableReportTable } from '@/lib/printable-report'
import { formatPercent, formatStatisticValue, type StatisticsUnit } from '@/lib/statistics-summary'
import type { WelderStatisticsJointFilter } from '@/lib/welder-statistics-summary'
import type { WeldingDynamicsSummary } from '@/lib/welding-dynamics'

export function buildWeldingDynamicsJointTypeTable(
  dynamics: WeldingDynamicsSummary,
  jointFilter: WelderStatisticsJointFilter,
  unit: StatisticsUnit,
): PrintableReportTable | null {
  const jointTypes = dynamics.jointTypes ?? []
  const materialJointTypes = dynamics.materialJointTypes ?? []
  if (jointFilter !== 'all' || materialJointTypes.length === 0) return null

  return {
    title: 'Типы стыков и группы материалов за период',
    subtitle: 'Перекрестный разрез общего объема; повторные стыки относятся к типу базового стыка цепочки.',
    columns: [
      'Группа материалов',
      ...jointTypes.map((jointType) => jointType.label),
      'Всего',
      'Сварщики',
      'На сварщика в смену',
      'Доля',
    ],
    rows: [
      ...materialJointTypes.map((group) => [
        group.label,
        ...jointTypes.map((jointType) => formatStatisticValue(
          group.jointTypes.find((candidate) => candidate.key === jointType.key)?.value ?? 0,
          unit,
        )),
        formatStatisticValue(group.value, unit),
        String(group.welderCount),
        formatPerWelderShift(group.valuePerWelderShift, group.welderShiftCount, unit),
        formatPercent(dynamics.totalValue > 0 ? (group.value / dynamics.totalValue) * 100 : 0),
      ]),
      [
        'Всего',
        ...jointTypes.map((jointType) => formatStatisticValue(jointType.value, unit)),
        formatStatisticValue(dynamics.totalValue, unit),
        String(dynamics.totalWelders),
        formatPerWelderShift(dynamics.averageValuePerWelderShift, dynamics.welderShiftCount, unit),
        formatPercent(dynamics.totalValue > 0 ? 100 : 0),
      ],
    ],
  }
}

function formatPerWelderShift(value: number, welderShiftCount: number, unit: StatisticsUnit) {
  return welderShiftCount > 0
    ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} ${unit === 'wdi' ? 'WDI' : 'стыков'}`
    : '—'
}
