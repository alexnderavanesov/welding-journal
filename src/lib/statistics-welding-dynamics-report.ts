import type { PrintableReportTable } from '@/lib/printable-report'
import { formatPercent, formatStatisticValue, type StatisticsUnit } from '@/lib/statistics-summary'
import type { WelderStatisticsJointFilter } from '@/lib/welder-statistics-summary'
import type {
  WeldingDynamicsMaterialJointTypeGroup,
  WeldingDynamicsSummary,
  WeldingDynamicsTableGrouping,
} from '@/lib/welding-dynamics'

export function buildWeldingDynamicsJointTypeTable(
  dynamics: WeldingDynamicsSummary,
  jointFilter: WelderStatisticsJointFilter,
  unit: StatisticsUnit,
  grouping: WeldingDynamicsTableGrouping = 'projects',
): PrintableReportTable | null {
  const jointTypes = (dynamics.jointTypes ?? []).filter((jointType) =>
    jointFilter === 'all' || jointType.key === jointFilter,
  )
  const hierarchy = grouping === 'projects'
    ? dynamics.projectMaterialHierarchy ?? []
    : dynamics.materialProjectHierarchy ?? []
  if (hierarchy.length === 0) return null
  const primaryLabel = grouping === 'projects' ? 'Проект' : 'Группа материалов'
  const secondaryLabel = grouping === 'projects' ? 'группа материалов' : 'проект'
  const rows: PrintableReportTable['rows'] = [
    buildReportRow('Итого за период', {
      jointTypes: dynamics.jointTypes,
      value: dynamics.totalValue,
      welderCount: dynamics.totalWelders,
      welderShiftCount: dynamics.welderShiftCount,
      valuePerWelderShift: dynamics.averageValuePerWelderShift,
    }, jointTypes, unit, dynamics.totalValue),
  ]
  const rowKinds: NonNullable<PrintableReportTable['rowKinds']> = ['total']

  for (const group of hierarchy) {
    rows.push(buildReportRow(group.label, group, jointTypes, unit, dynamics.totalValue))
    rowKinds.push('group')
    for (const child of group.children) {
      rows.push(buildReportRow(child.label, child, jointTypes, unit, dynamics.totalValue))
      rowKinds.push('detail')
    }
  }

  return {
    title: grouping === 'projects'
      ? 'Проекты и группы материалов за период'
      : 'Группы материалов и проекты за период',
    subtitle: `Иерархия: ${primaryLabel.toLocaleLowerCase('ru-RU')} → ${secondaryLabel}; повторные стыки относятся к типу базового стыка цепочки.`,
    columns: [
      `${primaryLabel} / ${secondaryLabel}`,
      ...jointTypes.map((jointType) => jointType.label),
      'Всего',
      'Сварщики',
      'На сварщика в смену',
      'Доля',
    ],
    rows,
    rowKinds,
  }
}

function buildReportRow(
  label: string,
  group: Pick<
    WeldingDynamicsMaterialJointTypeGroup,
    'jointTypes' | 'value' | 'welderCount' | 'welderShiftCount' | 'valuePerWelderShift'
  >,
  jointTypes: WeldingDynamicsSummary['jointTypes'],
  unit: StatisticsUnit,
  totalValue: number,
) {
  return [
    label,
    ...jointTypes.map((jointType) => formatStatisticValue(
      group.jointTypes.find((candidate) => candidate.key === jointType.key)?.value ?? 0,
      unit,
    )),
    formatStatisticValue(group.value, unit),
    String(group.welderCount),
    formatPerWelderShift(group.valuePerWelderShift, group.welderShiftCount, unit),
    formatPercent(totalValue > 0 ? (group.value / totalValue) * 100 : 0),
  ]
}

function formatPerWelderShift(value: number, welderShiftCount: number, unit: StatisticsUnit) {
  return welderShiftCount > 0
    ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} ${unit === 'wdi' ? 'WDI' : 'стыков'}`
    : '—'
}
